// The block editor application (used by the web app and the VS Code extension).

import * as Blockly from 'blockly/core';
import { registerContinuousToolbox } from '@blockly/continuous-toolbox';
import { type Layout, type WorkspaceState, fromBlockly, toBlockly } from '../core/blockly';
import { EXAMPLES } from '../core/examples';
import { generate } from '../core/generators';
import { LANGS, LANG_INFO, type Lang, type Program, type ProgramMeta, walkAllExprs, walkStmts } from '../core/ir';
import { RunError, runProgram } from '../core/interpreter';
import { isExternalLib } from '../core/library';
import { parse } from '../core/parsers';
import { TOOLBOX, externalLibs, installAll, makeTheme, registerExternal, registerFunctionCategory } from './blocks';
import { CodeView } from './codeview';

export interface EditorDocument {
  format: 'visualizing-code';
  version: 1;
  language: Lang;
  blocks: WorkspaceState;
  meta?: ProgramMeta;
}

export interface EditorOptions {
  /** "project": blocks are the document; "source": a source file is the document (language fixed). */
  mode: 'project' | 'source';
  language: Lang;
  mediaPath: string;
  /** Called (debounced) whenever the program changes. */
  onChange?: (state: { doc: EditorDocument; code: string; program: Program }) => void;
  /** Extra buttons for the top bar. */
  actions?: { id: string; label: string; title?: string; icon?: string; onClick: () => void }[];
  /** File name shown in the header (VS Code). */
  fileName?: string;
}

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  apply: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h11m-4-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="17" y="5" width="4" height="14" rx="1.5" fill="currentColor"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -4)"/></svg>',
  clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M10 7V5h4v2m-7 0 1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export const LOGO =
  '<svg class="vc-logo" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 5a2 2 0 0 1 2-2h5l2 2h4l2-2h9a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H18l-2 2h-4l-2-2H5a2 2 0 0 1-2-2z" fill="#E8A800"/><path d="M7 14a2 2 0 0 1 2-2h1l2 2h4l2-2h9a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H18l-2 2h-4l-2-2H9a2 2 0 0 1-2-2z" fill="#F28C1A"/><path d="M7 23a2 2 0 0 1 2-2h1l2 2h4l2-2h5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" fill="#2FAE63"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

export class BlockEditor {
  ws!: Blockly.WorkspaceSvg;
  code!: CodeView;
  lang: Lang;
  meta: ProgramMeta = {};
  private codeDirty = false;
  private suppressChange = 0;
  private changeTimer = 0;
  private running = false;
  private stopRequested = false;
  private inputResolve: ((s: string) => void) | null = null;
  private lastCode = '';
  private lastProgram: Program = { main: [], functions: [] };
  private dom!: Record<string, HTMLElement>;
  /** Last state reported to the host (avoids reporting a change that is none). */
  private reported: string | null = null;
  /** Which code lines / code belong to which block (from the last generation). */
  private lineMap: Record<string, [number, number]> = {};
  private exprMap: Record<string, string> = {};
  private linkedBlock: string | null = null;

  constructor(
    public root: HTMLElement,
    public opts: EditorOptions,
  ) {
    this.lang = opts.language;
    installAll();
    this.buildDom();
    this.installDialogs();
    this.injectBlockly();
    this.code = new CodeView(this.dom.cm, () => this.onCodeEdited());
    this.code.setLanguage(this.lang);
    this.code.onCursorLine = (line) => this.showBlockForLine(line);
    this.updateLanguageUi();
  }

  // ---- DOM -----------------------------------------------------------------------

  private buildDom() {
    const r = this.root;
    r.classList.add('vc-app');
    r.innerHTML = '';
    const bar = el('header', { class: 'vc-bar' });
    bar.innerHTML = `
      <div class="vc-brand">${LOGO}<div class="vc-brand-text"><span class="vc-name">Visualizing Code</span><span class="vc-file"></span></div></div>
      <nav class="vc-langs" aria-label="Programmiersprache"></nav>
      <div class="vc-actions">
        <label class="vc-select"><span class="vc-sr">Beispiel laden</span>
          <select class="vc-examples" id="vc-examples"><option value="">Beispiele …</option>${EXAMPLES.map((e) => `<option value="${e.id}">${e.title}</option>`).join('')}</select>
        </label>
        <span class="vc-host-actions"></span>
        <button type="button" class="vc-btn vc-go" id="vc-run" title="Programm in der Konsole ausführen (F5)">${ICONS.play}<span>Start</span></button>
        <button type="button" class="vc-btn vc-stop" id="vc-stop" title="Programm anhalten" disabled>${ICONS.stop}<span>Stopp</span></button>
      </div>`;
    const main = el('main', { class: 'vc-main' });
    main.innerHTML = `
      <section class="vc-blocks" aria-label="Blöcke"><div class="vc-blockly"></div></section>
      <div class="vc-split" role="separator" aria-orientation="vertical" aria-label="Breite der Code-Spalte ändern" tabindex="0"></div>
      <aside class="vc-side">
        <section class="vc-code">
          <div class="vc-head">
            <h2 class="vc-code-title">Code</h2>
            <div class="vc-head-tools">
              <button type="button" class="vc-icon-btn" id="vc-copy" title="Code kopieren">${ICONS.copy}<span class="vc-sr">Code kopieren</span></button>
            </div>
          </div>
          <div class="vc-pending" hidden>
            <span>Du hast den Code geändert.</span>
            <button type="button" class="vc-btn vc-small vc-primary" id="vc-apply">${ICONS.apply}<span>In Blöcke umwandeln</span></button>
            <button type="button" class="vc-btn vc-small" id="vc-revert">${ICONS.undo}<span>Verwerfen</span></button>
          </div>
          <div class="vc-cm"></div>
          <ul class="vc-notes" aria-label="Hinweise"></ul>
        </section>
        <section class="vc-console" aria-label="Konsole">
          <div class="vc-head">
            <h2>Konsole</h2>
            <div class="vc-head-tools">
              <label class="vc-check" title="Führt das Programm langsam aus und zeigt den aktiven Block"><input type="checkbox" id="vc-slow"> Zeitlupe</label>
              <button type="button" class="vc-icon-btn" id="vc-clear" title="Konsole leeren">${ICONS.clear}<span class="vc-sr">Konsole leeren</span></button>
            </div>
          </div>
          <div class="vc-out" role="log" aria-live="polite"><span class="vc-hint">Klicke auf „Start“, um dein Programm auszuführen.</span></div>
          <form class="vc-input" hidden>
            <label for="vc-answer" class="vc-ask"></label>
            <div class="vc-input-row"><input id="vc-answer" autocomplete="off" spellcheck="false"><button type="submit" class="vc-btn vc-small vc-primary">Senden</button></div>
          </form>
        </section>
      </aside>`;
    const dialog = el('div', { class: 'vc-dialog', hidden: '' });
    dialog.innerHTML = `<form class="vc-dialog-box" role="dialog" aria-modal="true"><p class="vc-dialog-msg"></p><input class="vc-dialog-input" id="vc-dialog-input"><div class="vc-dialog-buttons"><button type="button" class="vc-btn vc-small" data-v="cancel">Abbrechen</button><button type="submit" class="vc-btn vc-small vc-primary" data-v="ok">OK</button></div></form>`;
    r.append(bar, main, dialog);
    const q = (s: string) => r.querySelector(s) as HTMLElement;
    this.dom = {
      langs: q('.vc-langs'),
      examples: q('.vc-examples'),
      hostActions: q('.vc-host-actions'),
      run: q('#vc-run'),
      stop: q('#vc-stop'),
      blockly: q('.vc-blockly'),
      split: q('.vc-split'),
      side: q('.vc-side'),
      codeTitle: q('.vc-code-title'),
      pending: q('.vc-pending'),
      cm: q('.vc-cm'),
      notes: q('.vc-notes'),
      out: q('.vc-out'),
      input: q('.vc-input'),
      ask: q('.vc-ask'),
      answer: q('#vc-answer'),
      slow: q('#vc-slow'),
      dialog,
      file: q('.vc-file'),
    };
    if (this.opts.fileName) this.dom.file.textContent = this.opts.fileName;

    for (const lang of LANGS) {
      const b = el('button', { type: 'button', class: 'vc-lang', 'data-lang': lang }, LANG_INFO[lang].label);
      b.addEventListener('click', () => this.setLanguage(lang));
      this.dom.langs.append(b);
    }
    for (const a of this.opts.actions ?? []) {
      const b = el('button', { type: 'button', class: 'vc-btn', id: `vc-act-${a.id}`, title: a.title ?? a.label }, `${a.icon ?? ''}<span>${a.label}</span>`);
      b.addEventListener('click', a.onClick);
      this.dom.hostActions.append(b);
    }
    this.dom.examples.addEventListener('change', () => {
      const id = (this.dom.examples as HTMLSelectElement).value;
      (this.dom.examples as HTMLSelectElement).value = '';
      if (id) this.loadExample(id);
    });
    this.dom.run.addEventListener('click', () => this.run());
    this.dom.stop.addEventListener('click', () => this.stop());
    q('#vc-copy').addEventListener('click', () => this.copyCode());
    q('#vc-apply').addEventListener('click', () => this.applyCode());
    q('#vc-revert').addEventListener('click', () => {
      this.codeDirty = false;
      this.dom.pending.hidden = true;
      this.code.text = this.lastCode;
    });
    q('#vc-clear').addEventListener('click', () => (this.dom.out.innerHTML = ''));
    this.dom.input.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = (this.dom.answer as HTMLInputElement).value;
      this.writeConsole(value + '\n', 'echo');
      (this.dom.answer as HTMLInputElement).value = '';
      this.dom.input.hidden = true;
      const res = this.inputResolve;
      this.inputResolve = null;
      res?.(value);
    });
    r.addEventListener('keydown', (e) => {
      if (e.key === 'F5') {
        e.preventDefault();
        this.run();
      }
    });
    this.installSplitter();
  }

  private installSplitter() {
    const split = this.dom.split;
    const main = this.root.querySelector('.vc-main') as HTMLElement;
    let dragging = false;
    const setWidth = (px: number) => {
      const w = Math.max(280, Math.min(main.clientWidth - 320, px));
      main.style.setProperty('--side-width', `${w}px`);
      Blockly.svgResize(this.ws);
    };
    split.addEventListener('pointerdown', (e) => {
      dragging = true;
      split.setPointerCapture(e.pointerId);
    });
    split.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = main.getBoundingClientRect();
      setWidth(rect.right - e.clientX);
    });
    split.addEventListener('pointerup', () => (dragging = false));
    split.addEventListener('keydown', (e) => {
      const cur = this.dom.side.getBoundingClientRect().width;
      if (e.key === 'ArrowLeft') setWidth(cur + 40);
      if (e.key === 'ArrowRight') setWidth(cur - 40);
    });
  }

  // ---- dialogs (VS Code webviews do not support window.prompt) -----------------------

  private dialog(message: string, opts: { input?: string; cancel?: boolean }): Promise<string | null> {
    const d = this.dom.dialog;
    const form = d.querySelector('form') as HTMLFormElement;
    const input = d.querySelector('.vc-dialog-input') as HTMLInputElement;
    const cancel = d.querySelector('[data-v="cancel"]') as HTMLButtonElement;
    (d.querySelector('.vc-dialog-msg') as HTMLElement).textContent = message;
    input.hidden = opts.input === undefined;
    input.value = opts.input ?? '';
    cancel.hidden = !opts.cancel;
    d.hidden = false;
    setTimeout(() => (opts.input !== undefined ? input.select() : (d.querySelector('[data-v="ok"]') as HTMLElement).focus()), 0);
    return new Promise((resolve) => {
      const done = (v: string | null) => {
        d.hidden = true;
        form.onsubmit = null;
        cancel.onclick = null;
        d.onkeydown = null;
        resolve(v);
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        done(opts.input !== undefined ? input.value : 'ok');
      };
      cancel.onclick = () => done(null);
      d.onkeydown = (e) => {
        if (e.key === 'Escape') done(null);
      };
    });
  }

  confirm(message: string): Promise<boolean> {
    return this.dialog(message, { cancel: true }).then((v) => v !== null);
  }

  private installDialogs() {
    Blockly.dialog.setPrompt((message, def, cb) => {
      this.dialog(message, { input: def, cancel: true }).then(cb);
    });
    Blockly.dialog.setConfirm((message, cb) => {
      this.confirm(message).then(cb);
    });
    Blockly.dialog.setAlert((message, cb) => {
      this.dialog(message, {}).then(() => cb?.());
    });
  }

  // ---- Blockly ------------------------------------------------------------------------

  private injectBlockly() {
    registerContinuousToolbox();
    // The function category needs a callback that can only be registered after inject.
    const initialToolbox = { ...TOOLBOX, contents: TOOLBOX.contents.filter((c: any) => c.custom !== 'FUNKTIONEN') };
    this.ws = Blockly.inject(this.dom.blockly, {
      toolbox: initialToolbox as any,
      renderer: 'zelos',
      theme: makeTheme(this.isDark()),
      media: this.opts.mediaPath,
      sounds: false,
      trashcan: true,
      zoom: { controls: true, wheel: true, startScale: window.innerWidth < 700 ? 0.5 : 0.72, maxScale: 2, minScale: 0.35, scaleSpeed: 1.15 },
      move: { scrollbars: true, drag: true, wheel: false },
      grid: { spacing: 24, length: 2, colour: 'rgba(120,130,160,0.25)', snap: false },
      plugins: { flyoutsVerticalToolbox: 'ContinuousFlyout', metricsManager: 'ContinuousMetrics', toolbox: 'ContinuousToolbox' },
    });
    registerFunctionCategory(this.ws);
    // Recycled flyout blocks keep stale state for blocks with dropdowns/mutations.
    (this.ws.getFlyout() as any)?.setRecyclingEnabled?.(false);
    this.ws.updateToolbox(TOOLBOX as any);
    this.ws.addChangeListener(Blockly.Events.disableOrphans);
    this.ws.addChangeListener((e: Blockly.Events.Abstract) => {
      // (deselecting, e.g. by clicking into the code, keeps the marked lines)
      if (e.type === Blockly.Events.SELECTED && (e as any).newElementId) this.showLinesForSelection(true);
      if (e.isUiEvent || this.suppressChange) return;
      if (e.type === Blockly.Events.FINISHED_LOADING) return;
      this.scheduleChange();
    });
    new ResizeObserver(() => Blockly.svgResize(this.ws)).observe(this.dom.blockly);
  }

  // ---- block <-> code -------------------------------------------------------------------

  /** Nearest block (itself or a surrounding one) that produced code lines. */
  private mappedBlock(b: Blockly.Block | null): Blockly.Block | null {
    while (b && !this.lineMap[b.id]) b = b.getParent();
    return b;
  }

  /** Marks the code lines of the selected block. */
  private showLinesForSelection(scroll: boolean) {
    if (this.codeDirty) return;
    const selected = Blockly.getSelected() as Blockly.BlockSvg | null;
    const b = selected && 'type' in selected && selected.workspace === this.ws ? this.mappedBlock(selected) : null;
    this.code.showLinked(b ? this.lineMap[b.id] : null, scroll);
  }

  /** Cursor in the code: highlight the block that produced this line. */
  private showBlockForLine(line: number) {
    if (this.codeDirty || this.running) return;
    let best: string | null = null;
    let size = Infinity;
    for (const [id, [from, to]] of Object.entries(this.lineMap)) {
      if (line >= from && line <= to && to - from < size && this.ws.getBlockById(id)) {
        best = id;
        size = to - from;
      }
    }
    if (this.linkedBlock && this.linkedBlock !== best) this.ws.highlightBlock(this.linkedBlock, false);
    this.linkedBlock = best;
    if (!best) return;
    this.ws.highlightBlock(best, true);
    const block = this.ws.getBlockById(best)!;
    const view = this.ws.getMetricsManager().getViewMetrics(true);
    const pos = block.getRelativeToSurfaceXY();
    if (pos.y < view.top || pos.y > view.top + view.height - 40 || pos.x < view.left || pos.x > view.left + view.width - 40) this.ws.centerOnBlock(best);
    this.code.showLinked(this.lineMap[best], false);
  }

  /** Tooltips show the code a block produces in the current language. */
  private updateTooltips() {
    const label = LANG_INFO[this.lang].label;
    for (const b of this.ws.getAllBlocks(false)) {
      const any = b as any;
      if (any.__vcTip === undefined) any.__vcTip = b.tooltip ?? '';
      b.setTooltip(() => {
        const orig = typeof any.__vcTip === 'function' ? any.__vcTip() : any.__vcTip;
        const code = this.codeOfBlock(b.id);
        return code ? `${label}:  ${code}${orig ? '\n\n' + orig : ''}` : orig;
      });
    }
  }

  private codeOfBlock(id: string): string {
    if (this.exprMap[id]) return this.exprMap[id];
    const r = this.lineMap[id];
    if (!r) return '';
    const lines = this.lastCode.split('\n').slice(r[0] - 1, Math.min(r[1], r[0] + 2));
    const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length));
    return lines.map((l) => l.slice(indent)).join('\n') + (r[1] > r[0] + 2 ? '\n…' : '');
  }

  isDark(): boolean {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }

  /** Re-reads the theme (call after data-theme changed). */
  updateTheme() {
    this.ws.setTheme(makeTheme(this.isDark()));
  }

  private scheduleChange() {
    clearTimeout(this.changeTimer);
    this.changeTimer = window.setTimeout(() => this.refresh(), 120);
  }

  /** Reads the blocks, regenerates the code and notifies the host. */
  refresh(notify = true) {
    const state = Blockly.serialization.workspaces.save(this.ws) as WorkspaceState;
    const { program } = fromBlockly(state);
    program.meta = this.meta;
    this.lastProgram = program;
    const res = generate(program, this.lang);
    this.lastCode = res.code;
    this.lineMap = res.lines;
    this.exprMap = res.exprs;
    if (!this.codeDirty) this.code.text = res.code;
    this.showNotes(res.warnings);
    this.updateTooltips();
    this.showLinesForSelection(false);
    const doc = this.document(state);
    const key = this.opts.mode === 'source' ? res.code : JSON.stringify({ l: doc.language, p: program.main, f: program.functions, b: doc.blocks });
    if (!notify) {
      this.reported = key;
      return;
    }
    if (key === this.reported) return;
    this.reported = key;
    this.opts.onChange?.({ doc, code: res.code, program });
  }

  document(state?: WorkspaceState): EditorDocument {
    return {
      format: 'visualizing-code',
      version: 1,
      language: this.lang,
      blocks: state ?? (Blockly.serialization.workspaces.save(this.ws) as WorkspaceState),
      meta: this.meta,
    };
  }

  get generatedCode(): string {
    return this.lastCode;
  }

  get program(): Program {
    return this.lastProgram;
  }

  private showNotes(warnings: string[]) {
    const ul = this.dom.notes;
    ul.innerHTML = '';
    for (const w of warnings) ul.append(el('li', {}, escapeHtml(w)));
  }

  /** Loads a saved document (.blocks). */
  loadDocument(doc: EditorDocument) {
    this.meta = doc.meta ?? {};
    if (doc.language && this.opts.mode === 'project') this.lang = doc.language;
    this.registerExternals(this.meta);
    this.withoutEvents(() => {
      this.ws.clear();
      Blockly.serialization.workspaces.load(doc.blocks ?? {}, this.ws);
    });
    this.codeDirty = false;
    this.dom.pending.hidden = true;
    this.updateLanguageUi();
    this.refresh(false);
    this.ws.scrollCenter();
  }

  /** Loads a program (e.g. parsed from code); keeps the position of known blocks. */
  loadProgram(program: Program, keepLayout = true, notify = true) {
    const current = fromBlockly(Blockly.serialization.workspaces.save(this.ws) as WorkspaceState).layout;
    const layout: Layout = keepLayout ? current : {};
    this.meta = program.meta ?? {};
    this.registerExternals(this.meta, program);
    const state = toBlockly(program, layout);
    this.withoutEvents(() => {
      this.ws.clear();
      Blockly.serialization.workspaces.load(state as any, this.ws);
      this.arrange(layout);
    });
    this.codeDirty = false;
    this.dom.pending.hidden = true;
    this.refresh(notify);
  }

  /** Places top blocks without a saved position below the others, using their real size. */
  private arrange(layout: Layout) {
    const tops = this.ws.getTopBlocks(false);
    const key = (b: Blockly.BlockSvg) => (b.type === 'event_start' ? 'main' : b.type.startsWith('procedures_def') ? `fn:${b.getFieldValue('NAME')}` : '');
    let bottom = 20;
    for (const b of tops) {
      const k = key(b);
      if (k && layout[k]) bottom = Math.max(bottom, layout[k].y + b.getHeightWidth().height);
    }
    const unplaced = tops.filter((b) => !layout[key(b)]);
    // main program first, then functions in source order
    unplaced.sort((a, b) => (a.type === 'event_start' ? -1 : b.type === 'event_start' ? 1 : 0));
    for (const b of unplaced) {
      const pos = b.getRelativeToSurfaceXY();
      b.moveBy(30 - pos.x, bottom + 30 - pos.y);
      bottom += 30 + b.getHeightWidth().height;
    }
  }

  private registerExternals(meta: ProgramMeta, program?: Program) {
    externalLibs.clear();
    for (const imp of meta.imports ?? []) registerExternal(`ext:${imp.alias}`, '');
    if (program) {
      const all = [...(program.main ?? []), ...program.functions.flatMap((f) => f.body)];
      walkStmts(all, (s) => {
        if (s.k === 'libstmt' && isExternalLib(s.lib)) registerExternal(s.lib, s.fn);
      });
      walkAllExprs(all, (e) => {
        if (e.k === 'lib' && isExternalLib(e.lib)) registerExternal(e.lib, e.fn);
      });
    }
    for (const set of externalLibs.values()) set.delete('');
  }

  private withoutEvents(fn: () => void) {
    this.suppressChange++;
    try {
      fn();
    } finally {
      // Blockly fires events asynchronously; release after they were delivered
      setTimeout(() => this.suppressChange--, 0);
    }
  }

  /** Parses source code and shows it as blocks. Returns the problems found. */
  loadCode(text: string, lang: Lang, keepLayout = true, notify = true): string[] {
    const res = parse(text, lang);
    if (this.opts.mode === 'project') this.lang = lang;
    this.updateLanguageUi();
    this.loadProgram(res.program, keepLayout, notify);
    const problems = res.diagnostics.map((d) => (d.line ? `Zeile ${d.line}: ${d.message}` : d.message));
    let raw = 0;
    walkStmts([...(res.program.main ?? []), ...res.program.functions.flatMap((f) => f.body)], (s) => {
      if (s.k === 'raw') raw++;
    });
    if (raw) problems.push(`${raw} Stelle(n) haben noch keinen eigenen Block und wurden als Code-Block übernommen.`);
    for (const p of problems) this.writeConsole(p + '\n', 'warn');
    return problems;
  }

  async loadExample(id: string) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    if (this.ws.getAllBlocks(false).length > 1 && !(await this.confirm(`Beispiel „${ex.title}“ laden? Deine aktuellen Blöcke werden ersetzt.`))) return;
    this.loadProgram(structuredClone(ex.program), false);
    this.ws.scrollCenter();
  }

  newProgram() {
    this.meta = {};
    this.loadProgram({ main: [], functions: [] }, false);
  }

  // ---- language & code panel ------------------------------------------------------------

  setLanguage(lang: Lang) {
    if (lang === this.lang) return;
    if (this.opts.mode === 'source') return;
    if (this.codeDirty) this.applyCode();
    this.lang = lang;
    this.updateLanguageUi();
    this.refresh(true);
  }

  private updateLanguageUi() {
    for (const b of this.dom.langs.querySelectorAll<HTMLButtonElement>('.vc-lang')) {
      const active = b.dataset.lang === this.lang;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
      b.disabled = this.opts.mode === 'source' && !active;
      if (this.opts.mode === 'source') b.title = active ? 'Sprache dieser Datei' : 'Die Sprache ist durch die Datei festgelegt. Zum Übersetzen nutze „Code exportieren“.';
    }
    this.dom.codeTitle.textContent = `${LANG_INFO[this.lang].label}-Code`;
    this.code?.setLanguage(this.lang);
  }

  private onCodeEdited() {
    this.codeDirty = true;
    this.dom.pending.hidden = false;
  }

  /** Turns the (edited) code into blocks. */
  applyCode() {
    const problems = this.loadCode(this.code.text, this.lang, true);
    if (!problems.length) this.writeConsole('Code wurde in Blöcke umgewandelt.\n', 'info');
  }

  private async copyCode() {
    const text = this.code.text;
    try {
      await navigator.clipboard.writeText(text);
      this.flash('#vc-copy', 'Kopiert');
    } catch {
      // fallback: select the code so it can be copied with Ctrl+C
      this.code.view.focus();
      this.code.view.dispatch({ selection: { anchor: 0, head: text.length } });
    }
  }

  private flash(sel: string, text: string) {
    const b = this.root.querySelector(sel) as HTMLElement;
    b.setAttribute('data-flash', text);
    setTimeout(() => b.removeAttribute('data-flash'), 1200);
  }

  // ---- console / running ---------------------------------------------------------------

  writeConsole(text: string, kind: 'out' | 'err' | 'warn' | 'info' | 'echo' | 'prompt' = 'out') {
    const out = this.dom.out;
    out.querySelector('.vc-hint')?.remove();
    const span = el('span', { class: `vc-${kind}` });
    span.textContent = text;
    out.append(span);
    out.scrollTop = out.scrollHeight;
  }

  async run() {
    if (this.running) return;
    clearTimeout(this.changeTimer);
    this.refresh(false);
    const program = this.lastProgram;
    this.running = true;
    this.stopRequested = false;
    this.setRunUi(true);
    this.dom.out.innerHTML = '';
    const slow = (this.dom.slow as HTMLInputElement).checked;
    let lastHighlighted: string | null = null;
    try {
      await runProgram(
        program,
        {
          write: (t) => this.writeConsole(t),
          input: (prompt) => {
            if (prompt) this.writeConsole(prompt, 'prompt');
            this.dom.ask.textContent = prompt || 'Eingabe:';
            this.dom.input.hidden = false;
            (this.dom.answer as HTMLInputElement).focus();
            return new Promise((resolve) => (this.inputResolve = resolve));
          },
          step: slow
            ? async (id) => {
                if (id && id !== lastHighlighted) {
                  this.ws.highlightBlock(id);
                  lastHighlighted = id;
                }
                await new Promise((r) => setTimeout(r, 350));
              }
            : undefined,
          shouldStop: () => this.stopRequested,
        },
        this.lang,
      );
      if (this.stopRequested) this.writeConsole('\nProgramm angehalten.\n', 'info');
      else this.writeConsole('\nProgramm beendet.\n', 'info');
    } catch (err) {
      if (err instanceof RunError) {
        this.writeConsole(`\nFehler: ${err.message}\n`, 'err');
        if (err.blockId && this.ws.getBlockById(err.blockId)) {
          const b = this.ws.getBlockById(err.blockId)!;
          this.ws.highlightBlock(err.blockId);
          this.ws.centerOnBlock(err.blockId);
          b.select?.();
          lastHighlighted = null;
          return;
        }
      } else {
        this.writeConsole(`\nInterner Fehler: ${(err as Error).message}\n`, 'err');
        console.error(err);
      }
    } finally {
      this.running = false;
      this.dom.input.hidden = true;
      this.inputResolve = null;
      this.setRunUi(false);
      if (lastHighlighted) this.ws.highlightBlock(null);
    }
  }

  stop() {
    this.stopRequested = true;
    const res = this.inputResolve;
    this.inputResolve = null;
    res?.('');
  }

  private setRunUi(running: boolean) {
    (this.dom.run as HTMLButtonElement).disabled = running;
    (this.dom.stop as HTMLButtonElement).disabled = !running;
    this.root.classList.toggle('is-running', running);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
