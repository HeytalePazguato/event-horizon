import { describe, it, expect } from 'vitest';
import {
  signJwt,
  verifyJwt,
  buildProtectedResourceMetadata,
  buildAuthorizationServerMetadata,
  handleRegister,
  handleToken,
  validateAccessToken,
  JWT_TTL_SECONDS,
} from '../mcpOAuth.js';

const SECRET = 'test-startup-token-abcdef012345';
const ISSUER = 'http://127.0.0.1:28765';

describe('mcpOAuth — JWT', () => {
  it('round-trips sign → verify with the correct secret', () => {
    const token = signJwt({ sub: 'client-1', iss: ISSUER }, SECRET);
    const result = verifyJwt(token, SECRET);
    expect(result.valid).toBe(true);
    expect(result.payload?.sub).toBe('client-1');
    expect(result.payload?.iss).toBe(ISSUER);
    expect(typeof result.payload?.exp).toBe('number');
  });

  it('rejects a token signed with a different secret', () => {
    const token = signJwt({ sub: 'client-1', iss: ISSUER }, SECRET);
    const result = verifyJwt(token, 'different-secret');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature');
  });

  it('rejects an expired token', () => {
    const token = signJwt({ sub: 'client-1', iss: ISSUER }, SECRET, -10);
    const result = verifyJwt(token, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects a tampered payload', () => {
    const token = signJwt({ sub: 'client-1', iss: ISSUER }, SECRET);
    const [h, _p, s] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'attacker', iss: ISSUER, exp: 9999999999 }))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const tampered = `${h}.${tamperedPayload}.${s}`;
    const result = verifyJwt(tampered, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature');
  });

  it('rejects a malformed token', () => {
    expect(verifyJwt('not-a-jwt', SECRET).valid).toBe(false);
    expect(verifyJwt('only.two', SECRET).valid).toBe(false);
    expect(verifyJwt('', SECRET).valid).toBe(false);
  });
});

describe('mcpOAuth — metadata documents', () => {
  it('protected-resource doc declares header-only bearer and self as auth server', () => {
    const doc = buildProtectedResourceMetadata(ISSUER) as Record<string, unknown>;
    expect(doc.resource).toBe(ISSUER);
    expect(doc.resource_name).toBe('Event Horizon');
    expect(doc.authorization_servers).toEqual([ISSUER]);
    expect(doc.bearer_methods_supported).toEqual(['header']);
    expect((doc.bearer_methods_supported as string[]).includes('query')).toBe(false);
    expect(doc.logo_uri).toBe(`${ISSUER}/logo.png`);
  });

  it('authorization-server doc advertises all grants + endpoints + PKCE methods', () => {
    const doc = buildAuthorizationServerMetadata(ISSUER) as Record<string, unknown>;
    expect(doc.issuer).toBe(ISSUER);
    expect(doc.authorization_endpoint).toBe(`${ISSUER}/oauth/authorize`);
    expect(doc.token_endpoint).toBe(`${ISSUER}/oauth/token`);
    expect(doc.registration_endpoint).toBe(`${ISSUER}/oauth/register`);
    expect(doc.grant_types_supported).toEqual(['authorization_code', 'refresh_token', 'client_credentials']);
    expect(doc.response_types_supported).toEqual(['code']);
    expect(doc.code_challenge_methods_supported).toEqual(['S256', 'plain']);
  });
});

describe('mcpOAuth — Dynamic Client Registration', () => {
  it('returns a client_id and the startup token as client_secret', () => {
    const result = handleRegister({}, SECRET);
    expect(result.status).toBe(201);
    const r = result.response as Record<string, unknown>;
    expect(typeof r.client_id).toBe('string');
    expect((r.client_id as string).startsWith('eh-mcp-')).toBe(true);
    expect(r.client_secret).toBe(SECRET);
    expect(r.client_secret_expires_at).toBe(0);
    // Defaults target the authorization_code flow (what Claude Code uses).
    expect(r.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(r.response_types).toEqual(['code']);
    expect(r.redirect_uris).toEqual([]);
  });

  it('echoes back redirect_uris and metadata the client sent in DCR request', () => {
    const result = handleRegister({
      redirect_uris: ['http://localhost:7777/callback'],
      client_name: 'My MCP Client',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp',
    }, SECRET);
    expect(result.status).toBe(201);
    const r = result.response as Record<string, unknown>;
    expect(r.redirect_uris).toEqual(['http://localhost:7777/callback']);
    expect(r.client_name).toBe('My MCP Client');
    expect(r.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(r.token_endpoint_auth_method).toBe('none');
  });
});

describe('mcpOAuth — token endpoint', () => {
  it('mints a JWT on client_credentials grant with correct secret', () => {
    const result = handleToken(
      { grant_type: 'client_credentials', client_id: 'client-1', client_secret: SECRET },
      SECRET,
      ISSUER,
    );
    expect(result.status).toBe(200);
    const r = result.response as Record<string, unknown>;
    expect(typeof r.access_token).toBe('string');
    expect(r.token_type).toBe('Bearer');
    expect(r.expires_in).toBe(JWT_TTL_SECONDS);

    const verified = verifyJwt(r.access_token as string, SECRET);
    expect(verified.valid).toBe(true);
    expect(verified.payload?.sub).toBe('client-1');
  });

  it('rejects an incorrect client_secret with invalid_client', () => {
    const result = handleToken(
      { grant_type: 'client_credentials', client_id: 'client-1', client_secret: 'wrong' },
      SECRET,
      ISSUER,
    );
    expect(result.status).toBe(401);
    expect((result.response as { error: string }).error).toBe('invalid_client');
  });

  it('rejects an unsupported grant type', () => {
    const result = handleToken(
      { grant_type: 'password', username: 'a', password: 'b' },
      SECRET,
      ISSUER,
    );
    expect(result.status).toBe(400);
    expect((result.response as { error: string }).error).toBe('unsupported_grant_type');
  });

  it('rejects a client_credentials request missing client_id', () => {
    const result = handleToken(
      { grant_type: 'client_credentials', client_secret: SECRET },
      SECRET,
      ISSUER,
    );
    expect(result.status).toBe(400);
    expect((result.response as { error: string }).error).toBe('invalid_request');
  });
});

describe('mcpOAuth — authorization_code + PKCE flow (S256)', () => {
  it('issues an auth code on /authorize and exchanges it for tokens', async () => {
    const { handleAuthorize, _clearAuthCodes } = await import('../mcpOAuth.js');
    _clearAuthCodes();
    // S256: challenge = base64url(sha256(verifier))
    const crypto = await import('crypto');
    const verifier = 'test-verifier-0123456789abcdef0123456789abcdef0123456789';
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64')
      .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'test-client',
      redirect_uri: 'http://localhost:1234/cb',
      state: 'xyz',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'mcp',
    });
    const authResult = handleAuthorize(query);
    expect(authResult.status).toBe(302);
    expect(authResult.headers?.Location).toBeTruthy();
    const location = new URL(authResult.headers!.Location);
    expect(location.searchParams.get('state')).toBe('xyz');
    const code = location.searchParams.get('code');
    expect(typeof code).toBe('string');

    // Exchange the code for tokens
    const tokenResult = handleToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://localhost:1234/cb',
      client_id: 'test-client',
      code_verifier: verifier,
    }, SECRET, ISSUER);
    expect(tokenResult.status).toBe(200);
    const r = tokenResult.response as Record<string, unknown>;
    expect(typeof r.access_token).toBe('string');
    expect(typeof r.refresh_token).toBe('string');
    expect(r.token_type).toBe('Bearer');
  });

  it('rejects PKCE verification failure', async () => {
    const { handleAuthorize, _clearAuthCodes } = await import('../mcpOAuth.js');
    _clearAuthCodes();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'c',
      redirect_uri: 'http://localhost:1/cb',
      code_challenge: 'correct-challenge-value',
      code_challenge_method: 'plain',
    });
    const authResult = handleAuthorize(query);
    const code = new URL(authResult.headers!.Location).searchParams.get('code')!;

    const tokenResult = handleToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://localhost:1/cb',
      client_id: 'c',
      code_verifier: 'wrong-value',
    }, SECRET, ISSUER);
    expect(tokenResult.status).toBe(400);
    expect((tokenResult.response as { error: string }).error).toBe('invalid_grant');
  });

  it('rejects reuse of a consumed auth code', async () => {
    const { handleAuthorize, _clearAuthCodes } = await import('../mcpOAuth.js');
    _clearAuthCodes();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'c',
      redirect_uri: 'http://localhost:1/cb',
      code_challenge: 'v',
      code_challenge_method: 'plain',
    });
    const code = new URL(handleAuthorize(query).headers!.Location).searchParams.get('code')!;

    const good = handleToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://localhost:1/cb',
      client_id: 'c',
      code_verifier: 'v',
    }, SECRET, ISSUER);
    expect(good.status).toBe(200);

    const replay = handleToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://localhost:1/cb',
      client_id: 'c',
      code_verifier: 'v',
    }, SECRET, ISSUER);
    expect(replay.status).toBe(400);
    expect((replay.response as { error: string }).error).toBe('invalid_grant');
  });

  it('redirects with error on unsupported response_type (not code)', async () => {
    const { handleAuthorize, _clearAuthCodes } = await import('../mcpOAuth.js');
    _clearAuthCodes();
    const query = new URLSearchParams({
      response_type: 'token',
      client_id: 'c',
      redirect_uri: 'http://localhost:1/cb',
      state: 'abc',
      code_challenge: 'v',
      code_challenge_method: 'plain',
    });
    const result = handleAuthorize(query);
    expect(result.status).toBe(302);
    const u = new URL(result.headers!.Location);
    expect(u.searchParams.get('error')).toBe('unsupported_response_type');
    expect(u.searchParams.get('state')).toBe('abc');
  });

  it('rejects /authorize without PKCE code_challenge', async () => {
    const { handleAuthorize, _clearAuthCodes } = await import('../mcpOAuth.js');
    _clearAuthCodes();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'c',
      redirect_uri: 'http://localhost:1/cb',
    });
    const result = handleAuthorize(query);
    expect(result.status).toBe(302);
    expect(new URL(result.headers!.Location).searchParams.get('error')).toBe('invalid_request');
  });
});

describe('mcpOAuth — refresh_token flow', () => {
  it('refreshes an access token using a valid refresh_token', async () => {
    const { handleAuthorize, _clearAuthCodes } = await import('../mcpOAuth.js');
    _clearAuthCodes();
    // First run the auth flow to get a refresh token.
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'c',
      redirect_uri: 'http://localhost:1/cb',
      code_challenge: 'v',
      code_challenge_method: 'plain',
    });
    const code = new URL(handleAuthorize(query).headers!.Location).searchParams.get('code')!;
    const tok = handleToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'http://localhost:1/cb',
      client_id: 'c',
      code_verifier: 'v',
    }, SECRET, ISSUER);
    const refreshToken = (tok.response as { refresh_token: string }).refresh_token;

    // Now exchange the refresh token for a new access token.
    const refreshed = handleToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }, SECRET, ISSUER);
    expect(refreshed.status).toBe(200);
    expect(typeof (refreshed.response as { access_token: string }).access_token).toBe('string');
  });

  it('rejects an access token presented as a refresh_token', async () => {
    const accessToken = signJwt({ sub: 'c', iss: ISSUER, token_use: 'access' }, SECRET);
    const result = handleToken({
      grant_type: 'refresh_token',
      refresh_token: accessToken,
    }, SECRET, ISSUER);
    expect(result.status).toBe(400);
    expect((result.response as { error: string }).error).toBe('invalid_grant');
  });
});

describe('mcpOAuth — validateAccessToken', () => {
  it('accepts a valid Bearer header', () => {
    const token = signJwt({ sub: 'client-1', iss: ISSUER }, SECRET);
    const result = validateAccessToken(`Bearer ${token}`, SECRET);
    expect(result.valid).toBe(true);
    expect(result.payload?.sub).toBe('client-1');
  });

  it('rejects a missing header', () => {
    const result = validateAccessToken(undefined, SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing_bearer');
  });

  it('rejects a non-Bearer scheme', () => {
    const result = validateAccessToken('Basic dXNlcjpwYXNz', SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing_bearer');
  });

  it('rejects an empty Bearer value', () => {
    const result = validateAccessToken('Bearer ', SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('empty_token');
  });
});
