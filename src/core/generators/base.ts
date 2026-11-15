import { type Analysis, MAIN, type Ty, isNumeric } from '../analysis';
import type { Ex, Expr, Lang, Program, Stmt } from '../ir';
import { HELPERS, externalModule, findLibFn, implFor, isExternalLib } from '../library';
import { freshName, ident } from '../names';

export interface GenOptions {
  /** Java / C# class name (defaults to Main / Program). */
  className?: string;
}

export interface GenResult {
  code: string;
  warnings: string[];
}

/** Precedence of an atom / postfix expression. */
export const ATOM = 20;

export type Code = [string, number];

/** e + k with constant folding (used for loop bounds and random ranges). */
export function foldPlus(e: Ex, k: number): Ex {
  if (k === 0 || !e) return e;
  if (e.k === 'num') return { k: 'num', v: e.v + k, ...(e.float ? { float: true } : {}) };
  if (e.k === 'bin' && e.op === 'ADD' && e.b?.k === 'num') return foldPlus(e.a, e.b.v + k);
  if (e.k === 'bin' && e.op === 'SUB' && e.b?.k === 'num') return foldPlus(e.a, k - e.b.v);
  return k > 0 ? { k: 'bin', op: 'ADD', a: e, b: { k: 'num', v: k } } : { k: 'bin', op: 'SUB', a: e, b: { k: 'num', v: -k } };
}

export abstract class BaseGen {
  protected lines: string[] = [];
  protected depth = 0;
  protected place = MAIN;
  readonly imports = new Set<string>();
  readonly helpers = new Set<string>();
  protected usesRandom = false;
  protected usesInput = false;
  protected warnings = new Set<string>();
  protected taken: Set<string>;

  abstract readonly lang: Lang;
  protected abstract readonly indentUnit: string;
  protected abstract readonly commentPrefix: string;

  constructor(
    protected a: Analysis,
    protected opts: GenOptions = {},
  ) {
    this.taken = new Set([...a.allNames].map((n) => n));
  }

  get program(): Program {
    return this.a.program;
  }

  // ---- output ---------------------------------------------------------------

  protected emit(text: string) {
    for (const line of text.split('\n')) this.lines.push(line === '' ? '' : this.indentUnit.repeat(this.depth) + line);
  }

  protected blank() {
    if (this.lines.length && this.lines[this.lines.length - 1] !== '') this.lines.push('');
  }

  /** Runs fn with a fresh line buffer and returns the produced lines. */
  protected capture(fn: () => void): string[] {
    const saved = this.lines;
    this.lines = [];
    try {
      fn();
      return this.lines;
    } finally {
      this.lines = saved;
    }
  }

  protected indented(fn: () => void) {
    this.depth++;
    try {
      fn();
    } finally {
      this.depth--;
    }
  }

  protected warn(msg: string) {
    this.warnings.add(msg);
  }

  // ---- naming ---------------------------------------------------------------

  id(name: string): string {
    return ident(name, this.lang);
  }

  protected fresh(base: string): string {
    return freshName(base, this.taken);
  }

  // ---- types ----------------------------------------------------------------

  protected typeOf(e: Ex): Ty {
    return this.a.typeOf(e, this.place);
  }

  protected varType(name: string): Ty {
    return this.a.varType(name, this.place);
  }

  protected bothInt(a: Ex, b: Ex): boolean {
    return this.typeOf(a) === 'int' && this.typeOf(b) === 'int';
  }

  protected isStringy(e: Ex): boolean {
    return this.typeOf(e) === 'string';
  }

  protected isNum(e: Ex): boolean {
    return isNumeric(this.typeOf(e));
  }

  // ---- expressions ------------------------------------------------------------

  protected abstract expr(e: Expr): Code;

  /** Code of e, wrapped in parentheses if its precedence is below minPrec. */
  sub(e: Ex, minPrec = 0, placeholder?: Expr): string {
    if (!e) {
      if (!placeholder) return this.missing();
      e = placeholder;
    }
    const [code, prec] = this.expr(e);
    return prec < minPrec ? `(${code})` : code;
  }

  /** Code for an empty input. */
  protected missing(): string {
    this.warn('Ein Block hat ein leeres Feld (es wird 0 eingesetzt).');
    return '0';
  }

  protected args(list: Ex[]): string {
    return list.map((x) => this.sub(x, 0)).join(', ');
  }

  protected abstract stringLiteral(s: string): string;

  protected numberLiteral(v: number, float = false): string {
    if (!Number.isFinite(v)) return '0';
    let s = String(v);
    if (s.includes('e')) s = v.toFixed(20).replace(/0+$/, '').replace(/\.$/, '.0');
    if (float && !s.includes('.')) s += '.0';
    return s;
  }

  /** Expands a library template like "{0}.upper()". */
  protected template(tpl: string, args: Ex[], defaults: (i: number) => Expr): Code {
    const code = tpl.replace(/\{(\d)\}/g, (m, n: string, offset: number) => {
      const i = Number(n);
      const before = tpl.slice(0, offset).trimEnd().slice(-1);
      const after = tpl.slice(offset + m.length).trimStart()[0] ?? '';
      const free = (before === '' || '(,[:'.includes(before)) && (after === '' || '),]:'.includes(after));
      const postfix = after === '.' || after === '[';
      const minPrec = postfix ? ATOM : free ? 0 : ATOM - 1;
      return this.sub(args[i] ?? null, minPrec, defaults(i));
    });
    return [code, isAtomicTemplate(tpl) ? ATOM : 0];
  }

  protected libDefault(lib: string, fn: string, i: number): Expr {
    const p = findLibFn(lib, fn)?.params[i];
    if (!p) return { k: 'num', v: 0 };
    if (p.kind === 'text') return { k: 'str', v: '' };
    if (p.kind === 'list') return { k: 'list', items: [] };
    return { k: 'num', v: 0 };
  }

  protected libCode(lib: string, fn: string, args: Ex[]): Code {
    if (isExternalLib(lib)) return this.externalCall(lib, fn, args);
    const def = findLibFn(lib, fn);
    if (!def) {
      this.warn(`Unbekannte Bibliotheksfunktion ${lib}.${fn}.`);
      return [`${fn}(${this.args(args)})`, ATOM];
    }
    const impl = implFor(def, this.lang);
    for (const imp of impl.imports ?? []) this.imports.add(imp);
    for (const h of impl.helpers ?? []) this.useHelper(h);
    if (impl.random) this.usesRandom = true;
    return this.template(impl.code, args, (i) => this.libDefault(lib, fn, i));
  }

  protected useHelper(name: string) {
    const h = HELPERS[this.lang]?.[name];
    if (!h) return;
    this.helpers.add(name);
    for (const imp of h.imports ?? []) this.imports.add(imp);
    if (h.random) this.usesRandom = true;
  }

  protected helperCode(): string[] {
    return [...this.helpers].map((h) => HELPERS[this.lang]![h].code);
  }

  protected externalCall(lib: string, fn: string, args: Ex[]): Code {
    const module = externalModule(lib);
    const imp = this.program.meta?.imports?.find((i) => i.module === module || i.alias === module);
    if (imp && imp.lang !== this.lang) this.warn(`Die Bibliothek "${module}" gibt es nur in ${langLabel(imp.lang)}.`);
    const prefix = module ? `${imp?.lang === this.lang ? imp.alias : module}.` : '';
    return [`${prefix}${fn}(${this.args(args)})`, ATOM];
  }

  protected rawCode(code: string, lang: Lang): Code {
    if (lang !== this.lang) this.warn(`Ein Code-Block enthält ${langLabel(lang)}-Code; er wird unverändert übernommen.`);
    return [code, 0];
  }

  /** Emits a raw statement block. */
  protected rawStmt(code: string, lang: Lang) {
    const text = dedent(code);
    if (lang === this.lang) {
      this.emit(text);
    } else {
      this.warn(`Ein Code-Block enthält ${langLabel(lang)}-Code und wurde als Kommentar übernommen.`);
      for (const l of text.split('\n')) this.emit(`${this.commentPrefix} [${langLabel(lang)}] ${l}`);
    }
  }

  protected comment(text: string) {
    for (const l of text.split('\n')) this.emit(l.trim() ? `${this.commentPrefix} ${l}` : this.commentPrefix);
  }

  // ---- program ------------------------------------------------------------------

  abstract generate(): GenResult;

  protected result(code: string): GenResult {
    for (const w of this.a.warnings) this.warnings.add(w);
    if (!this.program.main) this.warnings.add('Es gibt keinen Block "Wenn Programm startet" - das Hauptprogramm ist leer.');
    return { code: code.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', warnings: [...this.warnings] };
  }

  protected abstract stmt(s: Stmt): void;

  protected body(stmts: Stmt[]) {
    for (const s of stmts) this.stmt(s);
  }

  /** for-loop analysis shared by several languages. */
  protected loopStep(by: Ex): { step: number | null; positive: boolean } {
    if (!by) return { step: 1, positive: true };
    if (by.k === 'num') return { step: by.v, positive: by.v >= 0 };
    return { step: null, positive: true };
  }
}

export function langLabel(lang: Lang): string {
  return { python: 'Python', java: 'Java', javascript: 'JavaScript', csharp: 'C#', cpp: 'C++', vba: 'VBA' }[lang];
}

export function dedent(code: string): string {
  const lines = code.replace(/\s+$/, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}

/** A template is atomic if it has no operator outside of brackets. */
export function isAtomicTemplate(tpl: string): boolean {
  let depth = 0;
  let inStr = false;
  const t = tpl.trim();
  if (t.startsWith('new ')) return false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if ('([{'.includes(c) && !(c === '{' && /^\{\d\}/.test(t.slice(i)))) depth++;
    else if (')]}'.includes(c) && !(c === '}' && /\{\d$/.test(t.slice(0, i)))) depth--;
    else if (depth === 0 && ' +-*/%<>=!&|?'.includes(c)) return false;
    else if (depth === 0 && c === ':' && t[i + 1] !== ':' && t[i - 1] !== ':') return false;
  }
  return true;
}
