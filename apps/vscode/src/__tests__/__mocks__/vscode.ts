/** Minimal vscode module mock for unit tests. */

type Listener<T> = (value: T) => void;

export class EventEmitter<T> {
  private listeners: Array<Listener<T>> = [];
  readonly event = (listener: Listener<T>): { dispose: () => void } => {
    this.listeners.push(listener);
    return { dispose: () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    } };
  };
  fire(value: T): void {
    for (const l of [...this.listeners]) { try { l(value); } catch { /* ignore */ } }
  }
  dispose(): void { this.listeners = []; }
}

let terminalIdCounter = 0;

export const window = {
  showErrorMessage: () => Promise.resolve(undefined),
  showInformationMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  onDidCloseTerminal: () => ({ dispose: () => {} }),
  createTerminal: (opts?: { name?: string; pty?: unknown }) => ({
    sendText: () => {},
    show: () => {},
    dispose: () => {},
    name: opts?.name ?? `mock-${++terminalIdCounter}`,
  }),
  terminals: [],
};

export const workspace = {
  workspaceFolders: [],
  getConfiguration: () => ({
    get: (_key: string, defaultValue?: unknown) => defaultValue,
  }),
};

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file' }),
  parse: (str: string) => ({ fsPath: str, scheme: 'file' }),
};
