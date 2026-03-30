/**
 * Shared formatting utilities for metrics display.
 * Used by MetricsPanel, OverviewPanel, and other components.
 * @event-horizon/ui
 */

export function formatTokens(n: number): string {
  if (n < 0) return '-';
  if (n === 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatCost(usd: number): string {
  if (usd < 0) return '-';
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 10) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(1)}`;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function topTool(breakdown: Record<string, number>): string {
  let best = '';
  let max = 0;
  for (const [name, count] of Object.entries(breakdown)) {
    if (count > max) { max = count; best = name; }
  }
  return best || '-';
}
