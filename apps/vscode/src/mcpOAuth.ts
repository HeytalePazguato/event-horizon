/**
 * MCP OAuth 2.1 module — implements the auth flows required by the MCP spec
 * (2025-06-18 revision): RFC 6749 token endpoint, RFC 8414 authorization
 * server metadata, RFC 7591 Dynamic Client Registration, RFC 9728 Protected
 * Resource metadata, RFC 7636 PKCE.
 *
 * Design: Event Horizon's server plays all three roles (resource server,
 * authorization server, DCR endpoint). It supports two grant flows:
 *
 *   - `authorization_code` (+ PKCE + refresh_token) — the default flow used
 *     by Claude Code, Cursor, VS Code, and every other standard MCP client.
 *     Since EH is localhost-only and has no human user to prompt, the
 *     authorization endpoint auto-approves every request and redirects
 *     immediately with an auth code.
 *
 *   - `client_credentials` — for automation and CLI callers (curl, scripts)
 *     that already know the startup token and don't want to run a browser
 *     redirect dance.
 *
 * JWTs are HS256, signed with the startup token as HMAC key. Access tokens
 * live 1 hour, refresh tokens 30 days. All tokens are invalidated
 * automatically on extension restart (new startup token → HMAC mismatch).
 *
 * PKCE challenges and auth codes are held in-memory with short TTLs.
 */

import * as crypto from 'crypto';

export const JWT_TTL_SECONDS = 3600;
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const AUTH_CODE_TTL_SECONDS = 60;
const AUTH_CODE_STORE_LIMIT = 256;
const JWT_HEADER = { alg: 'HS256', typ: 'JWT' };
const JWT_HEADER_B64 = base64UrlEncode(Buffer.from(JSON.stringify(JWT_HEADER)));

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
  iss: string;
  [key: string]: unknown;
}

export function signJwt(
  claims: { sub: string; iss: string; [key: string]: unknown },
  secret: string,
  ttlSeconds: number = JWT_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    ...claims,
    sub: claims.sub,
    iss: claims.iss,
    iat: now,
    exp: now + ttlSeconds,
  };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${JWT_HEADER_B64}.${payloadB64}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest();
  const signatureB64 = base64UrlEncode(signature);
  return `${signingInput}.${signatureB64}`;
}

export interface JwtVerifyResult {
  valid: boolean;
  payload?: JwtPayload;
  reason?: string;
}

export function verifyJwt(token: string, secret: string): JwtVerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed' };
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed_header' };
  }
  if (header.alg !== 'HS256') {
    return { valid: false, reason: 'unsupported_alg' };
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = crypto.createHmac('sha256', secret).update(signingInput).digest();
  let provided: Buffer;
  try {
    provided = base64UrlDecode(signatureB64);
  } catch {
    return { valid: false, reason: 'malformed_signature' };
  }
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return { valid: false, reason: 'signature' };
  }

  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed_payload' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, payload };
}

/**
 * RFC 9728 Protected Resource Metadata document.
 * Served from `/.well-known/oauth-protected-resource`. Tells MCP clients where
 * to obtain access tokens and what bearer-presentation methods are accepted.
 */
export function buildProtectedResourceMetadata(issuer: string): object {
  return {
    resource: issuer,
    resource_name: 'Event Horizon',
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
    resource_documentation: 'https://github.com/HeytalePazguato/event-horizon',
    logo_uri: `${issuer}/logo.png`,
  };
}

/**
 * RFC 8414 Authorization Server Metadata document.
 * Served from `/.well-known/oauth-authorization-server`. Advertises all the
 * flow-relevant endpoints and supported grants.
 */
export function buildAuthorizationServerMetadata(issuer: string): object {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256', 'plain'],
    scopes_supported: ['mcp'],
    service_documentation: 'https://github.com/HeytalePazguato/event-horizon/blob/master/docs/MCP_AUTH.md',
  };
}

export interface HandlerResult {
  status: number;
  response: object;
  headers?: Record<string, string>;
}

// ── In-memory auth-code store ──────────────────────────────────────────────
// Holds one-time codes issued by /oauth/authorize until the client exchanges
// them at /oauth/token. Short TTL, bounded size.

interface AuthCodeEntry {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256' | 'plain';
  scope: string;
  createdAt: number;
}

const authCodeStore = new Map<string, AuthCodeEntry>();

function sweepAuthCodes(): void {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [code, entry] of authCodeStore) {
    if (nowSec - entry.createdAt > AUTH_CODE_TTL_SECONDS) {
      authCodeStore.delete(code);
    }
  }
  // Cap size defensively
  while (authCodeStore.size > AUTH_CODE_STORE_LIMIT) {
    const firstKey = authCodeStore.keys().next().value;
    if (!firstKey) break;
    authCodeStore.delete(firstKey);
  }
}

function issueAuthCode(entry: Omit<AuthCodeEntry, 'createdAt'>): string {
  sweepAuthCodes();
  const code = base64UrlEncode(crypto.randomBytes(32));
  authCodeStore.set(code, { ...entry, createdAt: Math.floor(Date.now() / 1000) });
  return code;
}

function consumeAuthCode(code: string): AuthCodeEntry | null {
  sweepAuthCodes();
  const entry = authCodeStore.get(code);
  if (!entry) return null;
  authCodeStore.delete(code);
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - entry.createdAt > AUTH_CODE_TTL_SECONDS) return null;
  return entry;
}

/** @internal for tests only */
export function _clearAuthCodes(): void {
  authCodeStore.clear();
}

// ── PKCE (RFC 7636) ────────────────────────────────────────────────────────

function verifyPkce(
  verifier: string,
  challenge: string,
  method: 'S256' | 'plain',
): boolean {
  if (!verifier || !challenge) return false;
  if (method === 'plain') {
    const a = Buffer.from(verifier);
    const b = Buffer.from(challenge);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  // S256
  const hashed = base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
  const a = Buffer.from(hashed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── DCR (RFC 7591) ─────────────────────────────────────────────────────────

/**
 * Dynamic Client Registration. Open per RFC 7591 §1.5 — the localhost socket
 * binding is the security boundary. Echoes back client metadata from the
 * request so the strict Zod validator in the MCP SDK accepts the response.
 */
export function handleRegister(body: unknown, startupToken: string): HandlerResult {
  const b = (body as Record<string, unknown>) ?? {};
  const rawRedirects = Array.isArray(b.redirect_uris) ? (b.redirect_uris as unknown[]) : [];
  const redirectUris = rawRedirects.filter((u): u is string => typeof u === 'string');
  const grantTypes = Array.isArray(b.grant_types)
    ? (b.grant_types as unknown[]).filter((g): g is string => typeof g === 'string')
    : ['authorization_code', 'refresh_token'];
  const responseTypes = Array.isArray(b.response_types)
    ? (b.response_types as unknown[]).filter((r): r is string => typeof r === 'string')
    : ['code'];
  const tokenEndpointAuthMethod =
    typeof b.token_endpoint_auth_method === 'string' ? b.token_endpoint_auth_method : 'none';
  const clientName =
    typeof b.client_name === 'string' ? b.client_name : 'Event Horizon MCP Client';
  const scope = typeof b.scope === 'string' ? b.scope : 'mcp';

  const clientId = `eh-mcp-${crypto.randomBytes(8).toString('hex')}`;
  const now = Math.floor(Date.now() / 1000);

  return {
    status: 201,
    response: {
      client_id: clientId,
      client_secret: startupToken,
      client_id_issued_at: now,
      client_secret_expires_at: 0,
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      client_name: clientName,
      scope,
    },
  };
}

// ── Authorization Endpoint ─────────────────────────────────────────────────

/**
 * RFC 6749 §3.1 Authorization Endpoint.
 * Because EH is localhost-only with no human user to prompt, every valid
 * request is auto-approved. We immediately redirect to `redirect_uri` with a
 * one-time auth code and the `state` value echoed back.
 *
 * PKCE (RFC 7636) is required — clients MUST send `code_challenge` and
 * `code_challenge_method`. We honor S256 and plain.
 */
export function handleAuthorize(query: URLSearchParams): HandlerResult {
  const responseType = query.get('response_type') ?? '';
  const clientId = query.get('client_id') ?? '';
  const redirectUri = query.get('redirect_uri') ?? '';
  const state = query.get('state') ?? '';
  const codeChallenge = query.get('code_challenge') ?? '';
  const codeChallengeMethodRaw = query.get('code_challenge_method') ?? 'plain';
  const scope = query.get('scope') ?? 'mcp';

  const errorRedirect = (error: string, description: string): HandlerResult => {
    if (redirectUri) {
      const u = new URL(redirectUri);
      u.searchParams.set('error', error);
      u.searchParams.set('error_description', description);
      if (state) u.searchParams.set('state', state);
      return { status: 302, response: {}, headers: { Location: u.toString() } };
    }
    return { status: 400, response: { error, error_description: description } };
  };

  if (responseType !== 'code') {
    return errorRedirect('unsupported_response_type', 'Only response_type=code is supported');
  }
  if (!clientId) {
    return { status: 400, response: { error: 'invalid_request', error_description: 'Missing client_id' } };
  }
  if (!redirectUri) {
    return { status: 400, response: { error: 'invalid_request', error_description: 'Missing redirect_uri' } };
  }
  try {
    const u = new URL(redirectUri);
    if (u.protocol === 'javascript:' || u.protocol === 'data:' || u.protocol === 'vbscript:') {
      return { status: 400, response: { error: 'invalid_request', error_description: 'Unsafe redirect_uri scheme' } };
    }
  } catch {
    return { status: 400, response: { error: 'invalid_request', error_description: 'Malformed redirect_uri' } };
  }
  if (!codeChallenge) {
    return errorRedirect('invalid_request', 'PKCE code_challenge is required');
  }
  if (codeChallengeMethodRaw !== 'S256' && codeChallengeMethodRaw !== 'plain') {
    return errorRedirect('invalid_request', 'Unsupported code_challenge_method');
  }

  const code = issueAuthCode({
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod: codeChallengeMethodRaw,
    scope,
  });

  const u = new URL(redirectUri);
  u.searchParams.set('code', code);
  if (state) u.searchParams.set('state', state);
  return { status: 302, response: {}, headers: { Location: u.toString() } };
}

// ── Token Endpoint ─────────────────────────────────────────────────────────

/**
 * RFC 6749 §3.2 Token Endpoint.
 * Supports three grant types:
 *   - authorization_code (+ PKCE) — the default for Claude Code / Cursor / VS Code
 *   - refresh_token                — refresh a previously-issued access token
 *   - client_credentials           — CLI/automation flow bypassing the browser dance
 */
export function handleToken(
  body: unknown,
  startupToken: string,
  issuer: string,
): HandlerResult {
  const b = (body as Record<string, unknown>) ?? {};
  const grantType = typeof b.grant_type === 'string' ? b.grant_type : '';

  if (grantType === 'authorization_code') {
    return handleAuthorizationCodeGrant(b, startupToken, issuer);
  }
  if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(b, startupToken, issuer);
  }
  if (grantType === 'client_credentials') {
    return handleClientCredentialsGrant(b, startupToken, issuer);
  }
  return {
    status: 400,
    response: {
      error: 'unsupported_grant_type',
      error_description: 'Supported grants: authorization_code, refresh_token, client_credentials',
    },
  };
}

function handleAuthorizationCodeGrant(
  b: Record<string, unknown>,
  startupToken: string,
  issuer: string,
): HandlerResult {
  const code = typeof b.code === 'string' ? b.code : '';
  const redirectUri = typeof b.redirect_uri === 'string' ? b.redirect_uri : '';
  const clientId = typeof b.client_id === 'string' ? b.client_id : '';
  const codeVerifier = typeof b.code_verifier === 'string' ? b.code_verifier : '';

  if (!code || !redirectUri || !clientId) {
    return {
      status: 400,
      response: { error: 'invalid_request', error_description: 'Missing code, redirect_uri, or client_id' },
    };
  }

  const entry = consumeAuthCode(code);
  if (!entry) {
    return { status: 400, response: { error: 'invalid_grant', error_description: 'Invalid or expired code' } };
  }
  if (entry.clientId !== clientId) {
    return { status: 400, response: { error: 'invalid_grant', error_description: 'client_id mismatch' } };
  }
  if (entry.redirectUri !== redirectUri) {
    return { status: 400, response: { error: 'invalid_grant', error_description: 'redirect_uri mismatch' } };
  }
  if (!verifyPkce(codeVerifier, entry.codeChallenge, entry.codeChallengeMethod)) {
    return { status: 400, response: { error: 'invalid_grant', error_description: 'PKCE verification failed' } };
  }

  return issueTokenPair(clientId, entry.scope, startupToken, issuer);
}

function handleRefreshTokenGrant(
  b: Record<string, unknown>,
  startupToken: string,
  issuer: string,
): HandlerResult {
  const refreshToken = typeof b.refresh_token === 'string' ? b.refresh_token : '';
  if (!refreshToken) {
    return { status: 400, response: { error: 'invalid_request', error_description: 'Missing refresh_token' } };
  }
  const verified = verifyJwt(refreshToken, startupToken);
  if (!verified.valid || !verified.payload) {
    return { status: 400, response: { error: 'invalid_grant', error_description: 'Invalid or expired refresh_token' } };
  }
  if (verified.payload.token_use !== 'refresh') {
    return { status: 400, response: { error: 'invalid_grant', error_description: 'Not a refresh token' } };
  }
  const clientId = typeof verified.payload.sub === 'string' ? verified.payload.sub : '';
  const scope = typeof verified.payload.scope === 'string' ? verified.payload.scope : 'mcp';
  return issueTokenPair(clientId, scope, startupToken, issuer);
}

function handleClientCredentialsGrant(
  b: Record<string, unknown>,
  startupToken: string,
  issuer: string,
): HandlerResult {
  const clientId = typeof b.client_id === 'string' ? b.client_id : '';
  const clientSecret = typeof b.client_secret === 'string' ? b.client_secret : '';

  if (!clientId) {
    return { status: 400, response: { error: 'invalid_request', error_description: 'Missing client_id' } };
  }

  const secretBuf = Buffer.from(clientSecret);
  const expectedBuf = Buffer.from(startupToken);
  const matches =
    secretBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(secretBuf, expectedBuf);
  if (!matches) {
    return { status: 401, response: { error: 'invalid_client', error_description: 'Invalid client_secret' } };
  }

  const accessToken = signJwt(
    { sub: clientId, iss: issuer, scope: 'mcp' },
    startupToken,
    JWT_TTL_SECONDS,
  );
  return {
    status: 200,
    response: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: JWT_TTL_SECONDS,
      scope: 'mcp',
    },
  };
}

function issueTokenPair(
  clientId: string,
  scope: string,
  startupToken: string,
  issuer: string,
): HandlerResult {
  const accessToken = signJwt(
    { sub: clientId, iss: issuer, scope, token_use: 'access' },
    startupToken,
    JWT_TTL_SECONDS,
  );
  const refreshToken = signJwt(
    { sub: clientId, iss: issuer, scope, token_use: 'refresh' },
    startupToken,
    REFRESH_TTL_SECONDS,
  );
  return {
    status: 200,
    response: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: JWT_TTL_SECONDS,
      refresh_token: refreshToken,
      scope,
    },
  };
}

/**
 * Validate an `Authorization: Bearer <jwt>` header for MCP requests.
 * Called by the `/mcp` route handler.
 */
export function validateAccessToken(
  authorizationHeader: string | undefined,
  startupToken: string,
): { valid: boolean; reason?: string; payload?: JwtPayload } {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return { valid: false, reason: 'missing_bearer' };
  }
  const token = authorizationHeader.slice(7).trim();
  if (!token) {
    return { valid: false, reason: 'empty_token' };
  }
  return verifyJwt(token, startupToken);
}
