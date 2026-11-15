// Smoke test of the VS Code extension host with a minimal fake "vscode" module.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { describe, expect, it } from 'vitest';

const bundle = new URL('../extension/dist/extension.js', import.meta.url).pathname;
const require = createRequire(import.meta.url);

function fakeVscode() {
  const providers: Record<string, any> = {};
  const commands: Record<string, any> = {};
  const changeListeners: any[] = [];
  const applied: string[] = [];
  const Uri = {
    joinPath: (u: any, ...p: string[]) => ({ ...u, fsPath: [u.fsPath, ...p].join('/'), toString: () => [u.fsPath, ...p].join('/') }),
    file: (f: string) => ({ fsPath: f, toString: () => f }),
  };
  const vscode = {
    Uri,
    ViewColumn: { Beside: 2 },
    Range: class {
      args: any[];
      constructor(...a: any[]) {
        this.args = a;
      }
    },
    WorkspaceEdit: class {
      text = '';
      replace(_u: any, r: any, text: string) {
        this.text = JSON.stringify([r.args[0], r.args[1], text]);
      }
    },
    window: {
      registerCustomEditorProvider: (id: string, p: any) => ((providers[id] = p), { dispose() {} }),
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
      terminals: [],
      createTerminal: () => ({ show() {}, sendText() {} }),
    },
    commands: { registerCommand: (id: string, f: any) => ((commands[id] = f), { dispose() {} }), executeCommand: async () => undefined },
    workspace: {
      onDidChangeTextDocument: (f: any) => (changeListeners.push(f), { dispose() {} }),
      applyEdit: async (e: any) => (applied.push(e.text), true),
      getConfiguration: () => ({ get: () => 'python' }),
      fs: { readFile: async () => Buffer.from(''), writeFile: async () => undefined },
    },
  };
  return { vscode, providers, commands, applied };
}

describe.skipIf(!existsSync(bundle))('VS Code extension host', () => {
  it('registers editors and commands and talks to the webview', async () => {
    const fake = fakeVscode();
    const origLoad = (Module as any)._load;
    (Module as any)._load = function (request: string, ...rest: any[]) {
      if (request === 'vscode') return fake.vscode;
      return origLoad.call(this, request, ...rest);
    };
    try {
      delete require.cache[bundle];
      const ext = require(bundle);
      const ctx = { subscriptions: [] as any[], extensionUri: { fsPath: '/ext', toString: () => '/ext' } };
      ext.activate(ctx);
      expect(Object.keys(fake.providers).sort()).toEqual(['visualizingCode.blocks', 'visualizingCode.source']);
      expect(Object.keys(fake.commands)).toContain('visualizingCode.openAsBlocks');

      // open a Python file in the "as blocks" editor
      let text = 'print("Hallo")\n';
      const document = { uri: { toString: () => 'file:///a.py' }, fileName: '/tmp/a.py', lineCount: 1, isUntitled: false, getText: () => text, save: async () => true, positionAt: (o: number) => o };
      const posted: any[] = [];
      let onMessage: any;
      const panel = {
        webview: {
          options: {},
          html: '',
          cspSource: 'vscode-resource:',
          asWebviewUri: (u: any) => ({ toString: () => 'vscode-resource:' + u.fsPath }),
          postMessage: (m: any) => posted.push(m),
          onDidReceiveMessage: (f: any) => (onMessage = f),
        },
        onDidDispose: () => undefined,
      };
      await fake.providers['visualizingCode.source'].resolveCustomTextEditor(document, panel);
      expect(panel.webview.html).toContain('Content-Security-Policy');
      await onMessage({ type: 'ready' });
      expect(posted[0]).toMatchObject({ type: 'init', mode: 'source', lang: 'python', text });
      await onMessage({ type: 'edit', text: 'print("Hallo Welt")\n' });
      // only the changed part is replaced: offsets 12..12 get " Welt"
      expect(fake.applied).toEqual([JSON.stringify([12, 12, ' Welt'])]);
    } finally {
      (Module as any)._load = origLoad;
    }
  });
});
