/**
 * Lightweight PixiJS 8 setup — imports only the modules we actually use.
 * Replaces the barrel `import ... from 'pixi.js'` which pulls in everything
 * (accessibility, compressed-textures, spritesheet, filters, mesh, etc.).
 *
 * We only need: Application, Container, Graphics, Text + WebGL rendering.
 *
 * This file is used via the pixi-lite esbuild plugin in the webview build.
 * The `pixi.js/internal/*` paths are resolved by the plugin to pixi.js/lib/*.
 */

// ── Side-effect init modules (register PixiJS extensions) ───────────────
// Minimal set required for our rendering pipeline — no accessibility,
// spritesheet, filters, compressed-textures, or advanced-blend-modes.
import 'pixi.js/internal/app/init.mjs';              // ResizePlugin, TickerPlugin
import 'pixi.js/internal/rendering/init.mjs';         // texture sources, masks
import 'pixi.js/internal/scene/graphics/init.mjs';    // GraphicsPipe
import 'pixi.js/internal/scene/text/init.mjs';        // CanvasTextPipe
import 'pixi.js/internal/events/init.mjs';             // EventSystem (pointer)
import 'pixi.js/internal/dom/init.mjs';                // DOMPipe, CanvasObserver

// ── Class re-exports (resolved by pixi-lite plugin) ─────────────────────
export { Application } from 'pixi.js/internal/app/Application.mjs';
export { Container } from 'pixi.js/internal/scene/container/Container.mjs';
export { Graphics } from 'pixi.js/internal/scene/graphics/shared/Graphics.mjs';
export { Text } from 'pixi.js/internal/scene/text/Text.mjs';
