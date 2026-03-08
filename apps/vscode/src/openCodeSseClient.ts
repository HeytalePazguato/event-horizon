/**
 * SSE client that connects to OpenCode's running server and streams events.
 * OpenCode exposes an SSE endpoint at /event on its local server (default port 4096).
 */

import * as http from 'http';
import type { AgentEvent } from '@event-horizon/core';
import { mapOpenCodeToEvent } from '@event-horizon/connectors';

const DEFAULT_OPENCODE_PORT = 4096;
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

interface OpenCodeSseOptions {
  onEvent: (event: AgentEvent) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  log?: (msg: string) => void;
}

let request: http.ClientRequest | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = RECONNECT_DELAY_MS;
let stopped = false;
let options: OpenCodeSseOptions | null = null;
let connected = false;

function log(msg: string): void {
  options?.log?.(`[OpenCode SSE] ${msg}`);
}

/**
 * Parse an SSE stream chunk. SSE format:
 *   event: <type>\n
 *   data: <json>\n
 *   \n
 */
function createSseParser(onMessage: (eventType: string, data: string) => void) {
  let buffer = '';
  let currentEvent = '';
  let currentData = '';

  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    // Keep last partial line in buffer
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        currentData += (currentData ? '\n' : '') + line.slice(5).trim();
      } else if (line.trim() === '' && (currentEvent || currentData)) {
        // Empty line = end of message
        onMessage(currentEvent || 'message', currentData);
        currentEvent = '';
        currentData = '';
      }
    }
  };
}

function connect(port: number): void {
  if (stopped) return;

  const url = `http://127.0.0.1:${port}/event`;
  log(`Connecting to ${url}...`);

  const parse = createSseParser((eventType, data) => {
    if (!options) return;
    try {
      const parsed = JSON.parse(data);
      // Wrap the SSE event so the connector can map it
      const raw = {
        event: eventType,
        ...(typeof parsed === 'object' && parsed !== null ? parsed : { data: parsed }),
      };
      const agentEvent = mapOpenCodeToEvent(raw);
      if (agentEvent) {
        options.onEvent(agentEvent);
      }
    } catch {
      // Skip malformed SSE data
    }
  });

  request = http.get(url, {
    headers: { 'Accept': 'text/event-stream' },
  }, (res) => {
    if (res.statusCode !== 200) {
      log(`Unexpected status ${res.statusCode}, will retry...`);
      res.destroy();
      scheduleReconnect(port);
      return;
    }

    log('Connected');
    connected = true;
    reconnectDelay = RECONNECT_DELAY_MS; // Reset backoff on successful connect
    options?.onConnected?.();

    res.setEncoding('utf8');
    res.on('data', (chunk: string) => parse(chunk));

    res.on('end', () => {
      log('Stream ended');
      handleDisconnect(port);
    });

    res.on('error', (err) => {
      log(`Stream error: ${err.message}`);
      handleDisconnect(port);
    });
  });

  request.on('error', (err) => {
    // Connection refused = OpenCode not running (expected, don't spam logs)
    if ((err as NodeJS.ErrnoException).code !== 'ECONNREFUSED') {
      log(`Connection error: ${err.message}`);
    }
    handleDisconnect(port);
  });

  request.end();
}

function handleDisconnect(port: number): void {
  if (connected) {
    connected = false;
    options?.onDisconnected?.();
  }
  scheduleReconnect(port);
}

function scheduleReconnect(port: number): void {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(port);
  }, reconnectDelay);
  // Exponential backoff capped at MAX_RECONNECT_DELAY_MS
  reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
}

export function startOpenCodeSseClient(opts: OpenCodeSseOptions, port = DEFAULT_OPENCODE_PORT): void {
  stopped = false;
  options = opts;
  reconnectDelay = RECONNECT_DELAY_MS;
  connect(port);
}

export function stopOpenCodeSseClient(): void {
  stopped = true;
  options = null;
  connected = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (request) {
    request.destroy();
    request = null;
  }
}

export function isOpenCodeSseConnected(): boolean {
  return connected;
}
