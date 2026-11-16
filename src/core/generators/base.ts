import { type Analysis, MAIN, type Ty, elemOf, isList, isNumeric } from '../analysis';
import type { ClassDef, Ex, Expr, ImportInfo, Lang, Program, Stmt } from '../ir';
import { walkStmts } from '../ir';
import { Hierarchy, superInitOf } from '../classes';
import { HELPERS, externalModule, findLibFn, implFor, isExternalLib } from '../library';
import { freshName, ident } from '../names';

export interface GenOptions {
  /** Java / C# class name (defaults to Main / Program). */
  className?: string;
}

export interface GenResult {
  code: string;
  warnings: string[];
  /** Block id -> [first line, last line] (1-based) of the code it produced. */
  lines: Record<string, [number, number]>;
  /** Block id of an expression block -> its code. */
  exprs: Record<string, string>;
}

// Invisible markers that tag generated lines with the id of their block; removed in result().
const MARK_START = '\u0001';
const MARK_END = '\u0002';
const MARK = /\u0001([^\u0002]*)\u0002/g;

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
    const id = this.idStack[this.idStack.length - 1];
    const mark = id ? MARK_START + id + MARK_END : '';
    for (const line of text.split('\n')) this.lines.push(line === '' ? '' : mark + this.indentUnit.repeat(this.depth) + line);
  }

  private idStack: string[] = [];
  private parentOf = new Map<string, string | undefined>();
  private exprCode = new Map<string, string>();

  /** Lines emitted inside fn belong to the block with this id. */
  protected withId(id: string | undefined, fn: () => void) {
    if (!id) return fn();
    this.parentOf.set(id, this.idStack[this.idStack.length - 1]);
    this.idStack.push(id);
    try {
      fn();
    } finally {
      this.idStack.pop();
    }
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

  private hierarchy?: Hierarchy;
  protected get h(): Hierarchy {
    return (this.hierarchy ??= Hierarchy.of(this.program));
  }

  /** User-defined classes, base classes before their subclasses. */
  protected get classes(): ClassDef[] {
    const out: ClassDef[] = [];
    const add = (c: ClassDef) => {
      if (out.includes(c)) return;
      const base = this.h.base(c.name);
      if (base && !out.includes(base) && !this.h.chain(base.name).includes(c)) add(base);
      out.push(c);
    };
    for (const c of this.program.classes ?? []) add(c);
    return out;
  }

  /** Properties a class declares: its own ones (those of a base class are inherited). */
  protected classFields(c: ClassDef): string[] {
    return this.h.declaredFields(c);
  }

  /**
   * Constructor of a class as it is written: its parameters, the values for the base class
   * (null: none or written later in the body) and the remaining statements.
   * A subclass without own constructor takes the values of the base class and passes them on.
   */
  protected ctorPlan(c: ClassDef): { params: string[]; superArgs: Ex[] | null; body: Stmt[]; own: boolean } {
    const own = this.h.hasOwnCtor(c);
    const base = this.h.base(c.name);
    if (!base) return { params: c.ctorParams, superArgs: null, body: c.ctor, own };
    if (!own) {
      const params = this.h.ctorParams(c.name);
      return { params, superArgs: params.map((p): Expr => ({ k: 'var', name: p })), body: [], own };
    }
    const first = superInitOf(c.ctor);
    if (first) return { params: c.ctorParams, superArgs: first.args, body: c.ctor.filter((s) => s !== first), own };
    const later = c.ctor.some((s) => s.k === 'superinit');
    return { params: c.ctorParams, superArgs: later ? null : [], body: c.ctor, own };
  }

  protected isClassType(e: Ex): string | null {
    const t = this.typeOf(e);
    return t.startsWith('obj<') ? t.slice(4, -1) : null;
  }

  /** Names of the caught errors of the surrounding "versuche" blocks (innermost last). */
  protected catchNames: string[] = [];

  protected withCatch(fn: (name: string) => void) {
    const name = this.catchNames.length ? `fehler${this.catchNames.length + 1}` : 'fehler';
    this.catchNames.push(name);
    try {
      fn(name);
    } finally {
      this.catchNames.pop();
    }
  }

  /** Name of the innermost caught error (warns outside of a "falls Fehler" part). */
  protected currentCatch(): string | null {
    const n = this.catchNames[this.catchNames.length - 1];
    if (!n) this.warn('Der Block "Fehlermeldung" steht außerhalb von "falls ein Fehler passiert".');
    return n ?? null;
  }

  /** "[" + join(list, ", ") + "]" for languages that cannot print lists directly. */
  protected listText(e: Ex): Expr {
    return { k: 'join', parts: [{ k: 'str', v: '[' }, { k: 'lib', lib: 'text', fn: 'joinList', args: [e, { k: 'str', v: ', ' }] }, { k: 'str', v: ']' }] };
  }

  /** Replaces list-typed parts of a printed / joined value by their text form. */
  protected listsAsText(e: Ex): Ex {
    if (!e) return e;
    if (isList(this.typeOf(e))) return this.listText(e);
    if (e.k === 'join') return { ...e, parts: e.parts.flatMap((p) => (isList(this.typeOf(p)) ? (this.listText(p) as any).parts : [p])) };
    return e;
  }

  // ---- integer division / remainder ------------------------------------------------

  private zeroCompared = new WeakSet<object>();
  private nonNegVars: Set<string> | null = null;

  /**
   * Can the language's own operator be used for IDIV/MOD? nativeTrunc: the operator rounds toward zero.
   * The kinds only differ for negative numbers, so the native operator is fine when that cannot happen.
   */
  protected nativeDivOk(e: Expr & { k: 'bin' }, nativeTrunc: boolean): boolean {
    if (!!e.trunc === nativeTrunc) return true;
    if (e.op === 'MOD' && this.zeroCompared.has(e)) return true;
    return e.b?.k === 'num' && e.b.v > 0 && this.isNonNegative(e.a);
  }

  protected isNonNegative(e: Ex): boolean {
    if (!e) return false;
    switch (e.k) {
      case 'num':
        return e.v >= 0;
      case 'len':
        return true;
      case 'var':
        return this.nonNegativeVars().has(e.name);
      case 'math':
        return e.fn === 'abs' || ((e.fn === 'round' || e.fn === 'floor' || e.fn === 'ceil' || e.fn === 'sqrt') && this.isNonNegative(e.a));
      case 'random':
        return this.isNonNegative(e.from);
      case 'bin':
        if (e.op === 'ADD' || e.op === 'MUL') return this.isNonNegative(e.a) && this.isNonNegative(e.b);
        if (e.op === 'IDIV' || e.op === 'MOD' || e.op === 'DIV') return this.isNonNegative(e.a) && e.b?.k === 'num' && e.b.v > 0;
        return false;
      default:
        return false;
    }
  }

  /** Variables that are only ever assigned values >= 0 (simple fixed-point analysis). */
  private nonNegativeVars(): Set<string> {
    if (this.nonNegVars) return this.nonNegVars;
    const all: Stmt[] = [...(this.program.main ?? []), ...this.program.functions.flatMap((f) => f.body)];
    const set = new Set<string>();
    walkStmts(all, (s) => {
      if (s.k === 'set' || s.k === 'change') set.add(s.name);
      if (s.k === 'for') set.add(s.var);
    });
    for (const f of this.program.functions) for (const p of f.params) set.delete(p);
    this.nonNegVars = set;
    let changed = true;
    while (changed) {
      changed = false;
      walkStmts(all, (s) => {
        let bad: string | null = null;
        if (s.k === 'set' && set.has(s.name) && !this.isNonNegative(s.value)) bad = s.name;
        if (s.k === 'change' && set.has(s.name) && !this.isNonNegative(s.by)) bad = s.name;
        if (s.k === 'for' && set.has(s.var)) {
          const step = s.by?.k === 'num' ? s.by.v : null;
          const ok = this.isNonNegative(s.from) && step !== null && (step > 0 || this.isNonNegative(s.to));
          if (!ok) bad = s.var;
        }
        if (s.k === 'foreach') set.delete(s.var);
        if (bad) {
          set.delete(bad);
          changed = true;
        }
      });
    }
    return set;
  }

  // ---- expressions ------------------------------------------------------------

  protected abstract expr(e: Expr): Code;

  /** Code of e, wrapped in parentheses if its precedence is below minPrec. */
  sub(e: Ex, minPrec = 0, placeholder?: Expr): string {
    if (!e) {
      if (!placeholder) return this.missing();
      e = placeholder;
    }
    if (e.k === 'bin' && (e.op === 'EQ' || e.op === 'NEQ')) {
      // "x % n == 0" means the same with both kinds of remainder
      if (e.a?.k === 'bin' && e.a.op === 'MOD' && e.b?.k === 'num' && e.b.v === 0) this.zeroCompared.add(e.a);
      if (e.b?.k === 'bin' && e.b.op === 'MOD' && e.a?.k === 'num' && e.a.v === 0) this.zeroCompared.add(e.b);
    }
    if (e.k === 'kwarg') return this.kwargCode(e.name, e.value);
    const [code, prec] = this.expr(e);
    if (e.id) this.exprCode.set(e.id, code);
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
    // fixed numbers are computed: Mid(s, 0 + 1, 3 - 0) -> Mid(s, 1, 3)
    const lit = (i: string) => {
      const a = args[Number(i)];
      return a?.k === 'num' && Number.isInteger(a.v) && !a.float ? a.v : null;
    };
    tpl = tpl
      .replace(/\{(\d)\} - \{(\d)\}/g, (m, a: string, b: string) => (lit(a) !== null && lit(b) !== null ? String(lit(a)! - lit(b)!) : m))
      .replace(/\{(\d)\} \+ (\d+)(?![\d.])/g, (m, a: string, k: string) => (lit(a) !== null ? String(lit(a)! + Number(k)) : m));
    const code = tpl.replace(/\{(\d)\}/g, (m, n: string, offset: number) => {
      const i = Number(n);
      const before = tpl.slice(0, offset).trimEnd().slice(-1);
      const after = tpl.slice(offset + m.length).trimStart()[0] ?? '';
      const free = (before === '' || '(,[:'.includes(before)) && (after === '' || '),]:'.includes(after));
      const postfix = after === '.' || after === '[';
      const minPrec = postfix ? ATOM : free ? 0 : ATOM - 1;
      // 2.toFixed(1) is not valid JavaScript: (2).toFixed(1)
      if (postfix && args[i]?.k === 'num') return `(${this.sub(args[i], 0)})`;
      return this.sub(args[i] ?? null, minPrec, defaults(i));
    });
    return [code, isAtomicTemplate(tpl) ? ATOM : 0];
  }

  protected libDefault(lib: string, fn: string, i: number): Expr {
    const p = findLibFn(lib, fn)?.params[i];
    if (!p) return { k: 'num', v: 0 };
    if (p.kind === 'text') return { k: 'str', v: '' };
    if (p.kind === 'list') return { k: 'list', items: [] };
    if (p.kind === 'dict') return { k: 'dict', entries: [] };
    return { k: 'num', v: 0 };
  }

  /** Named argument: Python "n=v", C# "n: v", VBA "n:=v"; the others pass the value at its place. */
  protected kwargCode(name: string, value: Ex): string {
    const v = this.sub(value);
    if (this.lang === 'python') return `${name}=${v}`;
    if (this.lang === 'csharp') return `${name}: ${v}`;
    if (this.lang === 'vba') return `${name}:=${v}`;
    this.droppedNames.add(name);
    return v;
  }

  private readonly droppedNames = new Set<string>();

  /** "Zahl mit Nachkommastellen": the number of digits is part of a text in most languages. */
  protected fixedCode(x: Ex, digits: Ex): Code | null {
    return null;
  }

  protected libCode(lib: string, fn: string, args: Ex[], get = false): Code {
    if (isExternalLib(lib)) return this.externalCall(lib, fn, args, get);
    if (lib === 'text' && fn === 'fixed') {
      const special = this.fixedCode(args[0] ?? { k: 'num', v: 0 }, args[1] ?? { k: 'num', v: 2 });
      if (special) return special;
    }
    const def = findLibFn(lib, fn);
    if (!def) {
      this.warn(`Unbekannte Bibliotheksfunktion ${lib}.${fn}.`);
      return [`${fn}(${this.args(args)})`, ATOM];
    }
    const impl = implFor(def, this.lang);
    for (const imp of impl.imports ?? []) this.imports.add(imp);
    for (const h of impl.helpers ?? []) this.useHelper(h);
    if (impl.random) this.usesRandom = true;
    const elem = elemOf(this.typeOf(args[0] ?? null));
    const code = impl.byType?.[elem] ?? impl.code;
    return this.template(code, args, (i) => this.libDefault(lib, fn, i));
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

  /** Functions of external packages used in the code: module -> names. */
  readonly usedExternal = new Map<string, Set<string>>();

  protected findImport(module: string): ImportInfo | undefined {
    const imports = this.program.meta?.imports ?? [];
    return imports.find((i) => i.alias === module) ?? imports.find((i) => i.module === module);
  }

  /** Name of an external function as written in the code (prefix "modul." unless imported by name). */
  protected externalName(lib: string, fn: string): string {
    const module = externalModule(lib);
    if (!module) return fn;
    const imp = this.findImport(module);
    const realModule = imp?.module ?? module;
    const imports = (this.program.meta?.imports ?? []).filter((i) => i.lang === this.lang && i.module === realModule);
    // "from pulp import LpVariable": used without prefix
    const byName = imports.find((i) => !i.alias && i.names?.some((n) => n === '*' || n.split(/\s+as\s+/).pop() === fn));
    const fromOnly = imports.length > 0 && imports.every((i) => !i.alias && i.names);
    const fromImp = byName ?? (fromOnly ? imports[0] : undefined);
    if (fromImp) {
      if (!this.usedExternal.has(fromImp.module)) this.usedExternal.set(fromImp.module, new Set());
      this.usedExternal.get(fromImp.module)!.add(fn);
      return fn;
    }
    return `${imp?.lang === this.lang && imp.alias ? imp.alias : module}.${fn}`;
  }

  protected externalCall(lib: string, fn: string, args: Ex[], get = false): Code {
    const name = this.externalName(lib, fn);
    return [get ? name : `${name}(${this.args(args)})`, ATOM];
  }

  /** print(a, b): the single values if the output is "a b" written as several values. */
  protected spacedValues(s: Stmt): Ex[] | null {
    if (s.k !== 'print' || !s.spaced || s.value?.k !== 'join') return null;
    const parts = s.value.parts;
    if (parts.length < 3 || parts.length % 2 === 0) return null;
    for (let i = 1; i < parts.length; i += 2) {
      const sep = parts[i];
      if (sep?.k !== 'str' || sep.v !== ' ') return null;
    }
    return parts.filter((_, i) => i % 2 === 0);
  }

  /** Value of a print(a, b) that is written as one text: "Liste" + " " + xs becomes "Liste " + xs. */
  protected printValue(s: Stmt & { k: 'print' }): Ex {
    if (!s.spaced || s.value?.k !== 'join') return s.value;
    const parts: Ex[] = [];
    for (const x of s.value.parts) {
      const last = parts[parts.length - 1];
      if (x?.k === 'str' && last?.k === 'str') parts[parts.length - 1] = { k: 'str', v: last.v + x.v };
      else parts.push(x);
    }
    return parts.length === 1 ? parts[0] : { ...s.value, parts };
  }

  /** Comments at the start of the main program (a file header): [header, rest]. */
  protected splitHeader(main: Stmt[]): [Stmt[], Stmt[]] {
    let i = 0;
    while (i < main.length && main[i].k === 'comment') i++;
    return [main.slice(0, i), main.slice(i)];
  }

  /** "from x import a, b": the imported names plus the ones the program uses. */
  protected importedNames(imp: ImportInfo): string[] {
    const names = [...(imp.names ?? [])];
    for (const fn of this.usedExternal.get(imp.module) ?? []) if (!names.includes('*') && !names.some((n) => n.split(/\s+as\s+/).pop() === fn)) names.push(fn);
    return names;
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
    if (this.droppedNames.size) {
      this.warnings.add(`Benannte Werte (${[...this.droppedNames].join(', ')}) gibt es in ${langLabel(this.lang)} nicht; die Werte werden an ihrer Stelle übergeben.`);
    }
    for (const imp of this.program.meta?.imports ?? []) {
      if (imp.lang !== this.lang) this.warnings.add(`Das Paket "${imp.module}" gibt es nur in ${langLabel(imp.lang)}; der Code dafür wird nur übertragen.`);
    }
    if (!this.program.main) this.warnings.add('Es gibt keinen Block "Wenn Programm startet" - das Hauptprogramm ist leer.');
    // Python (PEP 8) keeps two blank lines around classes and functions, the others one
    const marked = (this.lang === 'python' ? code.replace(/\n{4,}/g, '\n\n\n') : code.replace(/\n{3,}/g, '\n\n')).trimEnd().split('\n');
    const own = new Map<string, [number, number]>();
    const clean = marked.map((line, i) => {
      let id: string | null = null;
      const text = line.replace(MARK, (_m, x: string) => {
        id ??= x;
        return '';
      });
      if (id) {
        const r = own.get(id);
        own.set(id, r ? [Math.min(r[0], i + 1), Math.max(r[1], i + 1)] : [i + 1, i + 1]);
      }
      return text;
    });
    // a block covers its own lines and the lines of the blocks inside it
    const lines: Record<string, [number, number]> = {};
    for (const [id, r] of own) {
      let cur: string | undefined = id;
      while (cur) {
        const old: [number, number] | undefined = lines[cur];
        lines[cur] = old ? [Math.min(old[0], r[0]), Math.max(old[1], r[1])] : [r[0], r[1]];
        cur = this.parentOf.get(cur);
      }
    }
    // blank lines are not part of a block
    return { code: clean.join('\n') + '\n', warnings: [...this.warnings], lines, exprs: Object.fromEntries(this.exprCode) };
  }

  protected abstract stmt(s: Stmt): void;

  protected body(stmts: Stmt[]) {
    stmts.forEach((s, i) => {
      if (s.gap && i > 0) this.blank();
      const multiline = !!s.trail && s.trail.includes('\n');
      if (multiline) this.comment(s.trail!);
      const before = this.lines.length;
      this.withId(s.id, () => this.stmt(s));
      if (s.trail && !multiline && this.lines.length > before) {
        this.lines[this.lines.length - 1] += `${this.lang === 'python' ? '  ' : ' '}${this.commentPrefix} ${s.trail}`;
      }
    });
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
