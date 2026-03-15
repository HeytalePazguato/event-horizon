// Stub browser globals that PixiJS accesses at import time.
// Required for CI (Node.js) where navigator/document don't exist.
if (typeof globalThis.navigator === 'undefined') {
  (globalThis as Record<string, unknown>).navigator = { userAgent: 'node', gpu: undefined };
}
