import '../ui/styles.css';
import { BlockEditor, type EditorDocument } from '../ui/editor';
import { LANG_INFO, langFromFileName, type Lang } from '../core/ir';
import { generate } from '../core/generators';
import { parse } from '../core/parsers';

declare const __ARTIFACT__: boolean;

const STORE_KEY = 'visualizing-code:document';
const THEME_KEY = 'visualizing-code:theme';

const ICON = {
  new: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 11v6m-3-3h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-4-4 4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-2.5-12-3 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  theme: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
};

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage not available */
  }
}

const savedTheme = read<string>(THEME_KEY);
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.blocks,.json,' + Object.values(LANG_INFO).flatMap((i) => i.extensions.map((e) => '.' + e)).join(',');
fileInput.hidden = true;
document.body.append(fileInput);

const artifact = typeof __ARTIFACT__ !== 'undefined' && __ARTIFACT__;

const editor: BlockEditor = new BlockEditor(document.getElementById('app')!, {
  mode: 'project',
  language: read<EditorDocument>(STORE_KEY)?.language ?? 'python',
  mediaPath: './media/',
  onChange: ({ doc }) => write(STORE_KEY, doc),
  actions: [
    { id: 'new', label: 'Neu', title: 'Neues, leeres Programm', icon: ICON.new, onClick: () => newProgram() },
    { id: 'open', label: 'Öffnen', title: 'Blöcke-Datei oder Code-Datei (.py, .java, .js, .cs, .cpp, .bas) öffnen', icon: ICON.open, onClick: () => fileInput.click() },
    ...(artifact
      ? []
      : [
          { id: 'save', label: 'Speichern', title: 'Blöcke als .blocks-Datei speichern', icon: ICON.save, onClick: () => download('programm.blocks', JSON.stringify(editor.document(), null, 2)) },
          {
            id: 'export',
            label: 'Code',
            title: 'Code als Datei herunterladen',
            icon: ICON.code,
            onClick: () => {
              const lang = editor.lang;
              const name = lang === 'java' ? 'Main.java' : lang === 'csharp' ? 'Program.cs' : `programm.${LANG_INFO[lang].ext}`;
              download(name, editor.generatedCode);
            },
          },
        ]),
    { id: 'theme', label: '', title: 'Hell / Dunkel umschalten', icon: ICON.theme, onClick: () => toggleTheme() },
  ],
});

async function newProgram() {
  if (await editor.confirm('Neues Programm anlegen? Deine aktuellen Blöcke werden gelöscht.')) {
    editor.newProgram();
  }
}

function toggleTheme() {
  const next = editor.isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  write(THEME_KEY, next);
  editor.updateTheme();
}
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => editor.updateTheme());

async function openFile(file: File) {
  const text = await file.text();
  if (/\.(blocks|json)$/i.test(file.name)) {
    try {
      const doc = JSON.parse(text) as EditorDocument;
      if (doc.format !== 'visualizing-code') throw new Error('kein Blöcke-Dokument');
      editor.loadDocument(doc);
    } catch (err) {
      editor.writeConsole(`Die Datei ${file.name} konnte nicht geöffnet werden: ${(err as Error).message}\n`, 'err');
    }
    return;
  }
  const lang = langFromFileName(file.name) as Lang | null;
  if (!lang) {
    editor.writeConsole(`Unbekannter Dateityp: ${file.name}\n`, 'err');
    return;
  }
  editor.loadCode(text, lang, false);
  editor.writeConsole(`${file.name} wurde in Blöcke umgewandelt.\n`, 'info');
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) openFile(f);
  fileInput.value = '';
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) {
    e.preventDefault();
    openFile(f);
  }
});

const stored = read<EditorDocument>(STORE_KEY);
if (stored?.format === 'visualizing-code' && stored.blocks?.blocks?.blocks?.length) editor.loadDocument(stored);
else {
  const first = 'hallo';
  import('../core/examples').then(({ EXAMPLES }) => editor.loadProgram(structuredClone(EXAMPLES.find((e) => e.id === first)!.program), false));
}
(window as any).vcEditor = editor;
// for the browser checks (scripts/ui-check.mjs)
(window as any).vcCore = { parse, generate, langFromFileName };
