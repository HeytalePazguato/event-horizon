/** Minimal vscode module mock for unit tests. */
export const window = {
  showErrorMessage: () => Promise.resolve(undefined),
  showInformationMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  onDidCloseTerminal: () => ({ dispose: () => {} }),
  createTerminal: () => ({ sendText: () => {}, show: () => {}, dispose: () => {}, name: 'mock' }),
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
