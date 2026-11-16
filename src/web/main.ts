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
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1m2 3.7a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
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

/** Saves a text file: in the browser as a download, on claude.ai through the viewer's save dialog. */
async function saveFile(name: string, text: string) {
  if (__ARTIFACT__) {
    // claude.ai only hands over a few file types (e.g. .json, .txt)
    const downloads = await (window as any).claude?.use?.('downloads');
    if (!downloads) {
      editor.writeConsole('Speichern ist in dieser Ansicht nicht möglich. Kopiere den Code mit dem Kopier-Knopf über dem Code.\n', 'warn');
      return;
    }
    try {
      await downloads.save({ filename: name, data: text });
    } catch (err: any) {
      if (err?.code !== 'declined') editor.writeConsole(`Die Datei konnte nicht gespeichert werden (${err?.code ?? err}).\n`, 'warn');
    }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

// ---- sharing: the program travels in the link (#p=…, compressed) ----------------------------

const toBase64Url = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (text: string) => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** "z" + deflated JSON, or "j" + plain JSON where the browser cannot compress. */
async function encodeShare(doc: EditorDocument): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  if (typeof CompressionStream === 'undefined') return 'j' + toBase64Url(json);
  return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

async function decodeShare(data: string): Promise<EditorDocument> {
  const bytes = fromBase64Url(data.slice(1));
  const json = data[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return JSON.parse(new TextDecoder().decode(json)) as EditorDocument;
}

async function shareLink() {
  const doc = editor.document();
  const url = `${location.origin}${location.pathname}#p=${await encodeShare(doc)}`;
  try {
    await navigator.clipboard.writeText(url);
    editor.writeConsole(`Link zum Programm kopiert (${Math.round(url.length / 1024)} KB). Wer ihn öffnet, sieht genau diese Blöcke.\n`, 'info');
  } catch {
    // clipboard not allowed: show the link in a dialog to copy by hand
    await editor.showText('Link zum Programm (zum Kopieren markieren):', url);
  }
}

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.blocks,.json,.txt,' + Object.values(LANG_INFO).flatMap((i) => i.extensions.map((e) => '.' + e)).join(',');
fileInput.hidden = true;
document.body.append(fileInput);


const editor: BlockEditor = new BlockEditor(document.getElementById('app')!, {
  mode: 'project',
  language: read<EditorDocument>(STORE_KEY)?.language ?? 'python',
  mediaPath: './media/',
  onChange: ({ doc }) => write(STORE_KEY, doc),
  actions: [
    { id: 'new', label: 'Neu', title: 'Neues, leeres Programm', icon: ICON.new, onClick: () => newProgram() },
    { id: 'open', label: 'Öffnen', title: 'Blöcke-Datei oder Code-Datei (.py, .java, .js, .cs, .cpp, .bas) öffnen', icon: ICON.open, onClick: () => fileInput.click() },
    {
      id: 'save',
      label: 'Speichern',
      title: __ARTIFACT__ ? 'Blöcke als .json-Datei speichern (lässt sich mit „Öffnen“ wieder laden)' : 'Blöcke als .blocks-Datei speichern',
      icon: ICON.save,
      onClick: () => saveFile(__ARTIFACT__ ? 'programm.blocks.json' : 'programm.blocks', JSON.stringify(editor.document(), null, 2)),
    },
    {
      id: 'export',
      label: 'Code',
      title: __ARTIFACT__ ? 'Code als Textdatei speichern' : 'Code als Datei herunterladen',
      icon: ICON.code,
      onClick: () => {
        const lang = editor.lang;
        const name = lang === 'java' ? 'Main.java' : lang === 'csharp' ? 'Program.cs' : `programm.${LANG_INFO[lang].ext}`;
        // claude.ai saves only known file types: Main.java -> Main.java.txt
        saveFile(__ARTIFACT__ ? `${name}.txt` : name, editor.generatedCode);
      },
    },
    // in claude.ai the page runs inside a frame: a link to it cannot carry the program
    ...(__ARTIFACT__ ? [] : [{ id: 'share', label: 'Teilen', title: 'Link zu diesem Programm kopieren', icon: ICON.share, onClick: () => shareLink() }]),
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
  // "Main.java.txt" (saved from claude.ai) is Java code
  const lang = (langFromFileName(file.name) ?? langFromFileName(file.name.replace(/\.txt$/i, ''))) as Lang | null;
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

async function openSharedLink(): Promise<boolean> {
  const m = /^#p=([\w-]+)$/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const doc = await decodeShare(m[1]);
    if (doc.format !== 'visualizing-code') throw new Error('kein Blöcke-Programm');
    // the own program (kept in the browser) is only replaced after asking
    const own = read<EditorDocument>(STORE_KEY);
    const hasOwn = (own?.blocks?.blocks?.blocks?.length ?? 0) > 1 || (editor.program.main?.length ?? 0) > 0;
    if (hasOwn && JSON.stringify(own?.blocks) !== JSON.stringify(doc.blocks) && !(await editor.confirm('Geteiltes Programm öffnen? Dein bisheriges Programm wird dabei ersetzt.'))) return false;
    editor.loadDocument(doc);
    editor.writeConsole('Geteiltes Programm geladen.\n', 'info');
    return true;
  } catch (err) {
    editor.writeConsole(`Der Link enthält kein lesbares Programm (${(err as Error).message}).\n`, 'err');
    return false;
  }
}

// a shared link pasted into this tab
if (!__ARTIFACT__) window.addEventListener('hashchange', () => openSharedLink());

const stored = read<EditorDocument>(STORE_KEY);
if (!__ARTIFACT__ && /^#p=/.test(location.hash)) {
  if (stored?.format === 'visualizing-code' && stored.blocks?.blocks?.blocks?.length) editor.loadDocument(stored);
  openSharedLink();
} else if (stored?.format === 'visualizing-code' && stored.blocks?.blocks?.blocks?.length) editor.loadDocument(stored);
else {
  const first = 'hallo';
  import('../core/examples').then(({ EXAMPLES }) => editor.loadProgram(structuredClone(EXAMPLES.find((e) => e.id === first)!.program), false));
}
(window as any).vcEditor = editor;
// for the browser checks (scripts/ui-check.mjs)
(window as any).vcCore = { parse, generate, langFromFileName };
