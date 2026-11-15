// Runs inside the VS Code webview.
import '../ui/styles.css';
import { BlockEditor, type EditorDocument } from '../ui/editor';
import type { Lang } from '../core/ir';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void; getState(): any; setState(s: any): void };
const vscode = acquireVsCodeApi();

const ICON = {
  term: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m7 9 3 3-3 3m5 1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  export: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m-4 4 4-4 4 4M5 14v5h14v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function applyVsCodeTheme() {
  const b = document.body.classList;
  const dark = b.contains('vscode-dark') || b.contains('vscode-high-contrast');
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}
applyVsCodeTheme();

let editor: BlockEditor | null = null;
let mode: 'project' | 'source' = 'project';
let lastText = '';

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    mode = msg.mode;
    editor = new BlockEditor(document.getElementById('app')!, {
      mode,
      language: msg.lang as Lang,
      mediaPath: msg.mediaUri,
      fileName: msg.fileName,
      onChange: ({ doc, code }) => {
        const text = mode === 'source' ? code : JSON.stringify(doc, null, 2) + '\n';
        if (text === lastText) return;
        lastText = text;
        vscode.postMessage({ type: 'edit', text });
      },
      actions: [
        { id: 'terminal', label: 'Im Terminal', title: 'Den echten Code im Terminal von VS Code ausführen', icon: ICON.term, onClick: () => vscode.postMessage({ type: 'runInTerminal', code: editor!.generatedCode, lang: editor!.lang }) },
        { id: 'export', label: 'Code exportieren', title: 'Code in einer beliebigen Sprache als Datei speichern', icon: ICON.export, onClick: () => vscode.postMessage({ type: 'export', doc: editor!.document() }) },
      ],
    });
    load(msg.text, false);
    new MutationObserver(() => {
      applyVsCodeTheme();
      editor?.updateTheme();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  } else if (msg.type === 'update') {
    if (msg.text !== lastText) load(msg.text, true);
  }
});

function load(text: string, keepLayout: boolean) {
  if (!editor) return;
  lastText = text;
  if (mode === 'source') {
    editor.loadCode(text, editor.lang, keepLayout, false);
    return;
  }
  if (!text.trim()) {
    editor.newProgram();
    return;
  }
  try {
    const doc = JSON.parse(text) as EditorDocument;
    editor.loadDocument(doc);
  } catch (err) {
    editor.writeConsole(`Die Datei ist kein gültiges Blöcke-Dokument: ${(err as Error).message}\n`, 'err');
  }
}

vscode.postMessage({ type: 'ready' });
