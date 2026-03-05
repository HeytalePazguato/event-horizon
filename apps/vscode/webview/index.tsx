/**
 * Webview entry — mounts renderer + UI (placeholder until bundled).
 */

export function mount(): void {
  const root = document.getElementById('root');
  if (root) root.innerHTML = '<p>Universe + Command Center (mount placeholder)</p>';
}
