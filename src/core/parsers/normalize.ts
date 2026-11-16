// Turns the raw parse tree of any language into clean IR:
// recognises library calls (via the catalog templates), built-in functions,
// user function calls, and fixes things that need type information.

import { analyze, isDict, isList } from '../analysis';
import { foldPlus } from '../generators/base';
import type { ClassDef, Diagnostic, Ex, Expr, FunctionDef, Lang, Program, Stmt } from '../ir';
import { CTOR, assignedNames, exprEquals, methodPlace } from '../ir';
import { LIBRARIES, implFor } from '../library';
import type { ParseResult } from './common';
import { parseCLikeExpr } from './clike';
import { parsePythonExpr } from './python';
import { parseVbaExpr } from './vba';

type Holes = Ex[];
type ExprBuilder = (h: Holes) => Expr;
type StmtBuilder = (h: Holes) => Stmt;

const n = (v: number): Expr => ({ k: 'num', v });
const math = (fn: any) => (h: Holes): Expr => ({ k: 'math', fn, a: h[0] });
const conv = (to: any) => (h: Holes): Expr => ({ k: 'convert', to, a: h[0] });
const ask = (as: any) => (h: Holes): Expr => ({ k: 'ask', prompt: h[0] ?? { k: 'str', v: '' }, as });
const len = (of: any) => (h: Holes): Expr => ({ k: 'len', of, a: h[0] });
const bin = (op: any) => (h: Holes): Expr => ({ k: 'bin', op, a: h[0], b: h[1] });
/** Integer division / remainder with explicit rounding: trunc (toward zero) or floor (down). */
const idiv = (op: 'IDIV' | 'MOD', trunc: boolean) => (h: Holes): Expr => ({ k: 'bin', op, a: h[0], b: h[1], trunc });
/** random(from = h[1], size = h[0]) */
const rnd = (h: Holes): Expr => {
  const from = h[1] ?? n(0);
  const size = h[0];
  let to: Ex;
  if (from.k === 'num') to = foldPlus(size, from.v - 1);
  else {
    const minus1 = foldPlus(size, -1);
    // "(b - a + 1)" with a == from  ->  b
    to = minus1?.k === 'bin' && minus1.op === 'SUB' && exprEquals(minus1.b, from) ? minus1.a : { k: 'bin', op: 'ADD', a: minus1, b: from };
  }
  return { k: 'random', from, to };
};

const EXPR_PATTERNS: Record<Lang, [string, ExprBuilder][]> = {
  python: [
    ['len({0})', len('auto')],
    ['int(input({0}))', ask('int')],
    ['float(input({0}))', ask('float')],
    ['int(input())', () => ask('int')([])],
    ['input({0})', ask('text')],
    ['input()', () => ask('text')([])],
    ['int({0})', conv('int')],
    ['float({0})', conv('float')],
    ['str({0})', conv('text')],
    ['abs({0})', math('abs')],
    ['round({0})', math('round')],
    ['math.sqrt({0})', math('sqrt')],
    ['math.log({0})', math('ln')],
    ['math.log10({0})', math('log10')],
    ['math.exp({0})', math('exp')],
    ['math.ceil({0})', math('ceil')],
    ['math.floor({0})', math('floor')],
    ['math.pow({0}, {1})', bin('POW')],
    ['int({0} / {1})', idiv('IDIV', true)],
    ['int(math.fmod({0}, {1}))', idiv('MOD', true)],
    ['math.fmod({0}, {1})', idiv('MOD', true)],
    ['random.randint({0}, {1})', (h) => ({ k: 'random', from: h[0], to: h[1] })],
  ],
  java: [
    ['Math.pow(10, {0})', math('pow10')],
    ['(int) Math.pow({0}, {1})', bin('POW')],
    ['Math.pow({0}, {1})', bin('POW')],
    ['Math.floorDiv({0}, {1})', idiv('IDIV', false)],
    ['Math.floorMod({0}, {1})', idiv('MOD', false)],
    ['(int) Math.floor({0} / {1})', idiv('IDIV', false)],
    ['(int) ({0} / {1})', idiv('IDIV', true)],
    ['(({0} % {1}) + {1}) % {1}', idiv('MOD', false)],
    ['Math.sqrt({0})', math('sqrt')],
    ['Math.abs({0})', math('abs')],
    ['Math.log({0})', math('ln')],
    ['Math.log10({0})', math('log10')],
    ['Math.exp({0})', math('exp')],
    ['(int) Math.round({0})', math('round')],
    ['Math.round({0})', math('round')],
    ['(int) Math.ceil({0})', math('ceil')],
    ['Math.ceil({0})', math('ceil')],
    ['(int) Math.floor({0})', math('floor')],
    ['Math.floor({0})', math('floor')],
    ['{0}.length()', len('text')],
    ['{0}.size()', len('list')],
    ['{0}.get({1})', (h) => ({ k: 'index', list: h[0], index: h[1] })],
    ['!{0}.equals({1})', bin('NEQ')],
    ['{0}.equals({1})', bin('EQ')],
    ['Integer.parseInt({0})', conv('int')],
    ['Double.parseDouble({0})', conv('float')],
    ['String.valueOf({0})', conv('text')],
    ['Integer.toString({0})', conv('text')],
    ['Double.toString({0})', conv('text')],
    ['{0}.toString()', conv('text')],
    ['input({0})', ask('text')],
    ['{9}.nextLine()', () => ask('text')([])],
    ['{9}.nextInt()', () => ask('int')([])],
    ['{9}.nextDouble()', () => ask('float')([])],
    ['{9}.nextInt({0}) + {1}', rnd],
    ['{9}.nextInt({0})', (h) => rnd([h[0], n(0)])],
    ['(int) (Math.random() * {0}) + {1}', rnd],
    ['(int) (Math.random() * {0})', (h) => rnd([h[0], n(0)])],
  ],
  csharp: [
    ['Math.Pow(10, {0})', math('pow10')],
    ['(int) Math.Pow({0}, {1})', bin('POW')],
    ['Math.Pow({0}, {1})', bin('POW')],
    ['(int) Math.Floor((double) {0} / {1})', idiv('IDIV', false)],
    ['(int) Math.Floor({0} / {1})', idiv('IDIV', false)],
    ['(int) ({0} / {1})', idiv('IDIV', true)],
    ['(({0} % {1}) + {1}) % {1}', idiv('MOD', false)],
    ['Math.Sqrt({0})', math('sqrt')],
    ['Math.Abs({0})', math('abs')],
    ['Math.Log({0})', math('ln')],
    ['Math.Log10({0})', math('log10')],
    ['Math.Exp({0})', math('exp')],
    ['(int) Math.Round({0})', math('round')],
    ['Math.Round({0})', math('round')],
    ['(int) Math.Ceiling({0})', math('ceil')],
    ['Math.Ceiling({0})', math('ceil')],
    ['(int) Math.Floor({0})', math('floor')],
    ['Math.Floor({0})', math('floor')],
    ['{0}.Length', len('text')],
    ['{0}.Count', len('list')],
    ['int.Parse({0})', conv('int')],
    ['double.Parse({0})', conv('float')],
    ['Convert.ToInt32({0})', conv('int')],
    ['Convert.ToDouble({0})', conv('float')],
    ['Convert.ToString({0})', conv('text')],
    ['{0}.ToString()', conv('text')],
    ['Input({0})', ask('text')],
    ['Console.ReadLine()', () => ask('text')([])],
    ['{9}.Next({0}, {1})', (h) => ({ k: 'random', from: h[0], to: foldPlus(h[1], -1) })],
    ['{9}.Next({0})', (h) => rnd([h[0], n(0)])],
  ],
  cpp: [
    ['pow(10, {0})', math('pow10')],
    ['(int) pow({0}, {1})', bin('POW')],
    ['pow({0}, {1})', bin('POW')],
    ['(int) floor((double) {0} / {1})', idiv('IDIV', false)],
    ['(int) floor({0} / {1})', idiv('IDIV', false)],
    ['(int) ({0} / {1})', idiv('IDIV', true)],
    ['(({0} % {1}) + {1}) % {1}', idiv('MOD', false)],
    ['fmod(fmod({0}, {1}) + {1}, {1})', idiv('MOD', false)],
    ['sqrt({0})', math('sqrt')],
    ['abs({0})', math('abs')],
    ['fabs({0})', math('abs')],
    ['log({0})', math('ln')],
    ['log10({0})', math('log10')],
    ['exp({0})', math('exp')],
    ['(int) round({0})', math('round')],
    ['round({0})', math('round')],
    ['(int) ceil({0})', math('ceil')],
    ['ceil({0})', math('ceil')],
    ['(int) floor({0})', math('floor')],
    ['floor({0})', math('floor')],
    ['fmod({0}, {1})', idiv('MOD', true)],
    ['(int) {0}.length()', len('text')],
    ['{0}.length()', len('text')],
    ['(int) {0}.size()', len('auto')],
    ['{0}.size()', len('auto')],
    ['stoi(input({0}))', ask('int')],
    ['stod(input({0}))', ask('float')],
    ['stoi({0})', conv('int')],
    ['stod({0})', conv('float')],
    ['stof({0})', conv('float')],
    ['to_string({0})', conv('text')],
    ['toText({0})', conv('text')],
    ['input({0})', ask('text')],
    ['rand() % {0} + {1}', rnd],
    ['rand() % {0}', (h) => rnd([h[0], n(0)])],
    ['string({0})', (h) => h[0] ?? { k: 'str', v: '' }],
  ],
  javascript: [
    ['Math.pow(10, {0})', math('pow10')],
    ['Math.pow({0}, {1})', bin('POW')],
    ['Math.sqrt({0})', math('sqrt')],
    ['Math.abs({0})', math('abs')],
    ['Math.log({0})', math('ln')],
    ['Math.log10({0})', math('log10')],
    ['Math.exp({0})', math('exp')],
    ['Math.round({0})', math('round')],
    ['Math.ceil({0})', math('ceil')],
    ['Math.trunc({0} / {1})', idiv('IDIV', true)],
    ['Math.floor({0} / {1})', idiv('IDIV', false)],
    ['(({0} % {1}) + {1}) % {1}', idiv('MOD', false)],
    ['Math.floor(Math.random() * {0}) + {1}', rnd],
    ['Math.floor(Math.random() * {0})', (h) => rnd([h[0], n(0)])],
    ['Math.floor({0})', math('floor')],
    ['Math.trunc({0})', conv('int')],
    ['{0}.length', len('auto')],
    ['{0}.get({1})', (h) => ({ k: 'index', list: h[0], index: h[1] })],
    ['parseInt(input({0}))', ask('int')],
    ['parseFloat(input({0}))', ask('float')],
    ['parseInt(prompt({0}))', ask('int')],
    ['parseFloat(prompt({0}))', ask('float')],
    ['parseInt({0})', conv('int')],
    ['toInt({0})', conv('int')],
    ['toFloat({0})', conv('float')],
    ['toInt(input({0}))', ask('int')],
    ['toFloat(input({0}))', ask('float')],
    ['parseFloat({0})', conv('float')],
    ['Number({0})', conv('float')],
    ['String({0})', conv('text')],
    ['{0}.toString()', conv('text')],
    ['input({0})', ask('text')],
    ['prompt({0})', ask('text')],
  ],
  vba: [
    ['Sqr({0})', math('sqrt')],
    ['Abs({0})', math('abs')],
    ['Log({0}) / Log(10)', math('log10')],
    ['Log({0})', math('ln')],
    ['Exp({0})', math('exp')],
    ['Round({0})', math('round')],
    ['-Int(-{0})', math('ceil')],
    ['Int(Rnd() * {0}) + {1}', rnd],
    ['Int(Rnd * {0}) + {1}', rnd],
    ['Int(({0} - {1} + 1) * Rnd + {1})', (h) => ({ k: 'random', from: h[1], to: h[0] })],
    ['Int(Rnd() * {0})', (h) => rnd([h[0], n(0)])],
    ['Int({0} / {1})', idiv('IDIV', false)],
    ['(({0} Mod {1}) + {1}) Mod {1}', idiv('MOD', false)],
    ['Int({0})', math('floor')],
    ['Fix({0})', conv('int')],
    ['CLng(InputBox({0}))', ask('int')],
    ['CInt(InputBox({0}))', ask('int')],
    ['CDbl(InputBox({0}))', ask('float')],
    ['CLng({0})', conv('int')],
    ['CInt({0})', conv('int')],
    ['CDbl({0})', conv('float')],
    ['CSng({0})', conv('float')],
    ['CStr({0})', conv('text')],
    ['Len({0})', len('text')],
    ['(UBound({0}) - LBound({0}) + 1)', len('list')],
    ['UBound({0}) - LBound({0}) + 1', len('list')],
    ['UBound({0}) + 1', len('list')],
    ['InputBox({0})', ask('text')],
    ['IIf({0}, {1}, {2})', (h) => ({ k: 'cond', cond: h[0], a: h[1], b: h[2] })],
    ['Err.Description', () => ({ k: 'errmsg' })],
    ['10 ^ {0}', math('pow10')],
  ],
};

const print = (newline: boolean) => (h: Holes): Stmt => ({ k: 'print', value: h[0] ?? { k: 'str', v: '' }, newline });
const listadd: StmtBuilder = (h) => ({ k: 'listadd', list: h[0], value: h[1] });

const STMT_PATTERNS: Record<Lang, [string, StmtBuilder][]> = {
  python: [['{0}.append({1})', listadd]],
  java: [
    ['System.out.println({0})', print(true)],
    ['System.out.println()', print(true)],
    ['System.out.print({0})', print(false)],
    ['{0}.add({1})', listadd],
    ['{0}.set({1}, {2})', (h) => ({ k: 'listset', list: h[0], index: h[1], value: h[2] })],
    ['{0}.put({1}, {2})', (h) => ({ k: 'dset', dict: h[0], key: h[1], value: h[2] })],
  ],
  csharp: [
    ['Console.WriteLine({0})', print(true)],
    ['Console.WriteLine()', print(true)],
    ['Console.Write({0})', print(false)],
    ['{0}.Add({1})', listadd],
    ['{0}.Add({1}, {2})', (h) => ({ k: 'dset', dict: h[0], key: h[1], value: h[2] })],
  ],
  cpp: [['{0}.push_back({1})', listadd]],
  javascript: [
    ['console.log()', print(true)],
    ['process.stdout.write({0})', print(false)],
    ['process.stdout.write(String({0}))', print(false)],
    ['{0}.push({1})', listadd],
    ['{0}.set({1}, {2})', (h) => ({ k: 'dset', dict: h[0], key: h[1], value: h[2] })],
  ],
  vba: [],
};

// ---------------------------------------------------------------------------
// Template matching

function parseExprFor(lang: Lang, code: string): Expr {
  const prepared = code.replace(/\{(\d)\}/g, '__h$1__');
  if (lang === 'python') return parsePythonExpr(prepared);
  if (lang === 'vba') return parseVbaExpr(prepared);
  return parseCLikeExpr(prepared, lang);
}

interface Compiled<B> {
  pattern: Expr;
  build: B;
  arity: number;
}

const cache = new Map<string, any>();

function compile<B>(lang: Lang, list: [string, B][]): Compiled<B>[] {
  const out: Compiled<B>[] = [];
  for (const [tpl0, build] of list) {
    // VBA statement calls without parentheses: "SortList {0}" == "SortList({0})"
    const tpl = lang === 'vba' ? tpl0.replace(/^([A-Za-z]\w*) (\{.*)$/, '$1($2)') : tpl0;
    try {
      const pattern = stripSrc(parseExprFor(lang, tpl));
      const arity = Math.max(-1, ...[...tpl.matchAll(/\{(\d)\}/g)].map((m) => Number(m[1]))) + 1;
      out.push({ pattern, build, arity });
    } catch {
      // template cannot be parsed by the simple parser: only used for generation
    }
  }
  return out;
}

function libPatterns(lang: Lang, statements: boolean): Compiled<ExprBuilder>[] {
  const key = `lib:${lang}:${statements}`;
  if (cache.has(key)) return cache.get(key);
  const list: [string, ExprBuilder][] = [];
  for (const lib of LIBRARIES) {
    for (const fn of lib.fns) {
      if ((fn.returns === null) !== statements) continue;
      const impl = implFor(fn, lang);
      const templates = [...(impl.match === false ? [] : [impl.code, ...Object.values(impl.byType ?? {})]), ...(impl.alt ?? [])];
      for (const tpl of templates) {
        list.push([tpl, (h) => ({ k: 'lib', lib: lib.id, fn: fn.id, args: fn.params.map((_, i) => h[i] ?? null) })]);
      }
    }
  }
  // Patterns like "{0}", "{0}[{1}]" or "{0} * {1}" would match far too much.
  const isHole = (x: any) => x?.k === 'var' && HOLE.test(x.name);
  const compiled = compile(lang, list).filter((c) => {
    const p: any = c.pattern;
    if (isHole(p)) return false;
    if (p.k === 'index') return !(isHole(p.list) && isHole(p.index));
    if (p.k === 'bin') return !(isHole(p.a) && isHole(p.b));
    return true;
  });
  cache.set(key, compiled);
  return compiled;
}

function builtinPatterns(lang: Lang): Compiled<ExprBuilder>[] {
  const key = `expr:${lang}`;
  if (!cache.has(key)) cache.set(key, compile(lang, EXPR_PATTERNS[lang]));
  return cache.get(key);
}

function stmtPatterns(lang: Lang): Compiled<StmtBuilder>[] {
  const key = `stmt:${lang}`;
  if (!cache.has(key)) cache.set(key, compile(lang, STMT_PATTERNS[lang]));
  return cache.get(key);
}

function stripSrc(e: any): any {
  if (Array.isArray(e)) return e.map(stripSrc);
  if (e && typeof e === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(e)) if (k !== 'src' && k !== 'id') out[k] = stripSrc(v);
    return out;
  }
  return e;
}

const HOLE = /^__h(\d)__$/;

function match(p: any, node: any, holes: Holes, ci: boolean): boolean {
  if (p && p.k === 'var' && HOLE.test(p.name)) {
    const i = Number(HOLE.exec(p.name)![1]);
    if (holes[i] !== undefined) return exprEquals(holes[i], node);
    holes[i] = node;
    return true;
  }
  if (p === null || typeof p !== 'object') {
    if (ci && typeof p === 'string' && typeof node === 'string') return p.toLowerCase() === node.toLowerCase();
    return p === node;
  }
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(p)) {
    if (!Array.isArray(node) || p.length !== node.length) return false;
    return p.every((x, i) => match(x, node[i], holes, ci));
  }
  for (const key of Object.keys(p)) {
    if (!match(p[key], node[key], holes, ci)) return false;
  }
  // node must not have extra structure (e.g. kwargs)
  for (const key of Object.keys(node)) if (!(key in p) && key !== 'src' && key !== 'id' && node[key] !== undefined) {
    if (key === 'float' && p.k === 'num') continue;
    return false;
  }
  return true;
}

function tryPatterns<B>(lang: Lang, list: Compiled<B>[], node: Expr): { build: B; holes: Holes } | null {
  for (const c of list) {
    const holes: Holes = [];
    if (match(c.pattern, node, holes, lang === 'vba')) {
      for (let i = 0; i < c.arity; i++) if (holes[i] === undefined) holes[i] = null;
      return { build: c.build, holes };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

class Normalizer {
  userFns: Map<string, FunctionDef>;
  classNames: Map<string, string>;
  importAliases: Map<string, string>;
  /** "from pulp import LpVariable": LpVariable -> pulp */
  fromNames = new Map<string, string>();
  starModule: string | null = null;
  diagnostics: Diagnostic[] = [];

  constructor(
    public program: Program,
    public lang: Lang,
  ) {
    const key = (s: string) => (lang === 'vba' ? s.toLowerCase() : s);
    this.userFns = new Map(program.functions.map((f) => [key(f.name), f]));
    this.classNames = new Map((program.classes ?? []).map((c) => [key(c.name), c.name]));
    this.importAliases = new Map((program.meta?.imports ?? []).filter((i) => i.alias).map((i) => [key(i.alias), i.module]));
    const addAll = (names: Iterable<string>) => {
      for (const n of names) this.knownNames.add(key(n));
    };
    addAll(assignedNames(program.main ?? []));
    for (const f of program.functions) addAll([...f.params, ...assignedNames(f.body)]);
    for (const c of program.classes ?? []) addAll([...c.ctorParams, ...assignedNames(c.ctor), ...c.methods.flatMap((m) => [...m.params, ...assignedNames(m.body)])]);
    addAll(Object.keys(program.meta?.types ?? {}).map((k) => k.slice(k.indexOf(':') + 1)));
    for (const imp of program.meta?.imports ?? []) {
      for (const n of imp.names ?? []) {
        if (n === '*') this.starModule ??= imp.module;
        else this.fromNames.set(key(n.split(/\s+as\s+/).pop()!), imp.module);
      }
    }
  }

  /** Names that are variables, parameters, functions or classes of the program. */
  knownNames = new Set<string>();

  /** Is "a.b.c" a path into a package (imported alias or an unknown name like JsonConvert)? */
  isPackagePath(path: string | null): boolean {
    if (!path) return false;
    const root = this.key(path.split('.')[0]);
    if (this.importAliases.has(root)) return true;
    return /^[A-Z]/.test(path) && !this.knownNames.has(root) && !this.classNames.has(root) && !this.userFns.has(root);
  }

  /** Library id of a free function: imported by name ("from x import f") or unknown. */
  freeLib(name: string): string {
    const m = this.fromNames.get(this.key(name)) ?? this.starModule;
    return `ext:${m ?? ''}`;
  }

  /** Arguments of a call that is not a user function: named arguments become "kwarg" values. */
  plainArgs(e: Expr & { k: 'pcall' }): Ex[] {
    return [...e.args.map((a) => this.expr(a)), ...Object.entries(e.kwargs ?? {}).map(([name, value]): Expr => ({ k: 'kwarg', name, value: this.expr(value) }))];
  }

  key(s: string) {
    return this.lang === 'vba' ? s.toLowerCase() : s;
  }

  /** [[k, v], ...] or {{k, v}, ...} -> dictionary entries */
  dictFromPairs(items: Ex[]): Expr | null {
    const entries: { key: Ex; value: Ex }[] = [];
    for (const it of items) {
      const pair = it?.k === 'list' ? it.items : null;
      if (!pair || pair.length !== 2) return null;
      entries.push({ key: this.expr(pair[0]), value: this.expr(pair[1]) });
    }
    return { k: 'dict', entries };
  }

  /** VBA: "Klasse_methode" -> methode */
  vbaMethod(name: string): string | null {
    const i = name.indexOf('_');
    if (i < 0) return null;
    // the method may come from a base class
    const classes = this.program.classes ?? [];
    let cls = classes.find((c) => c.name.toLowerCase() === name.slice(0, i).toLowerCase());
    const seen = new Set<ClassDef>();
    while (cls && !seen.has(cls)) {
      seen.add(cls);
      const m = cls.methods.find((x) => x.name.toLowerCase() === name.slice(i + 1).toLowerCase());
      if (m) return m.name;
      cls = cls.base ? classes.find((c) => c.name === cls!.base) : undefined;
    }
    return null;
  }

  /** Arguments of a call of a user function: keyword arguments and default values are filled in. */
  callArgs(f: { params: string[]; defaults?: Ex[] }, e: Expr & { k: 'pcall' }): Ex[] {
    const named: Record<string, Ex> = { ...(e.kwargs ?? {}) };
    const positional: Ex[] = [];
    for (const a of e.args) {
      if (a?.k === 'kwarg') named[a.name] = a.value;
      else positional.push(a);
    }
    const args: Ex[] = positional.map((a) => this.expr(a));
    for (const [name, value] of Object.entries(named)) {
      const i = f.params.findIndex((p) => this.key(p) === this.key(name));
      if (i >= 0) args[i] = this.expr(value);
    }
    for (let i = 0; i < f.params.length; i++) if (args[i] === undefined) args[i] = f.defaults?.[i] ? this.expr(f.defaults[i]) : null;
    return args.slice(0, Math.max(f.params.length, positional.length));
  }

  raw(e: Expr): Expr {
    return { k: 'raw', code: e.src ?? '?', lang: this.lang };
  }

  stmts(list: Stmt[]): Stmt[] {
    const out: Stmt[] = [];
    for (const s of list) {
      const r = this.stmt(s);
      if (r) out.push(r);
    }
    return out;
  }

  stmt(s: Stmt): Stmt | null {
    switch (s.k) {
      case 'pexpr': {
        const r = this.exprStmt(s.e);
        if (!r) return r;
        return { ...r, ...(s.gap ? { gap: true } : {}), ...(s.trail ? { trail: s.trail } : {}) };
      }
      case 'print':
        return { ...s, value: this.expr(s.value) };
      case 'set':
        return { ...s, value: this.expr(s.value) };
      case 'superinit':
        return { ...s, args: s.args.map((a) => this.expr(a)) };
      case 'change':
        return { ...s, by: this.expr(s.by) };
      case 'if':
        return { ...s, branches: s.branches.map((b) => ({ cond: this.expr(b.cond), body: this.stmts(b.body) })), else: s.else ? this.stmts(s.else) : null };
      case 'repeat':
        return { ...s, times: this.expr(s.times), body: this.stmts(s.body) };
      case 'while':
        return { ...s, cond: this.expr(s.cond), body: this.stmts(s.body) };
      case 'for':
        return { ...s, from: this.expr(s.from), to: this.expr(s.to), by: this.expr(s.by), body: this.stmts(s.body) };
      case 'foreach':
        return { ...s, list: this.expr(s.list), body: this.stmts(s.body) };
      case 'listadd':
        return { ...s, list: this.expr(s.list), value: this.expr(s.value) };
      case 'listset':
        return { ...s, list: this.expr(s.list), index: this.expr(s.index), value: this.expr(s.value) };
      case 'callstmt':
      case 'libstmt':
        return { ...s, args: s.args.map((a) => this.expr(a)) };
      case 'methodstmt':
        return { ...s, obj: this.expr(s.obj), args: s.args.map((a) => this.expr(a)) };
      case 'return':
        return { ...s, value: this.expr(s.value) };
      case 'throw':
        return { ...s, value: this.expr(s.value) };
      case 'try':
        return { ...s, body: this.stmts(s.body), handler: this.stmts(s.handler) };
      case 'dset':
        return { ...s, dict: this.expr(s.dict), key: this.expr(s.key), value: this.expr(s.value) };
      default:
        return s;
    }
  }

  exprStmt(e: Expr): Stmt | null {
    const lib = tryPatterns(this.lang, libPatterns(this.lang, true), e);
    if (lib) {
      const x = lib.build(lib.holes) as Expr & { k: 'lib' };
      return { k: 'libstmt', lib: x.lib, fn: x.fn, args: x.args.map((a) => this.expr(a)) };
    }
    const st = tryPatterns(this.lang, stmtPatterns(this.lang), e);
    if (st) return this.stmt(st.build(st.holes));
    if (this.lang === 'javascript' && e.k === 'pcall' && e.callee.k === 'member' && e.callee.name === 'log' && e.callee.obj?.k === 'var' && e.callee.obj.name === 'console') {
      const parts: Ex[] = [];
      e.args.forEach((a, i) => {
        if (i > 0) parts.push({ k: 'str', v: ' ', sep: true });
        parts.push(a);
      });
      return this.stmt({ k: 'print', value: parts.length === 1 ? parts[0] : { k: 'join', parts }, newline: true, ...(e.args.length > 1 ? { spaced: true } : {}) });
    }
    if (e.k === 'pcall') {
      const c = e.callee;
      const fn = c.k === 'var' ? this.userFns.get(this.key(c.name)) : undefined;
      const args = fn ? this.callArgs(fn, e) : this.plainArgs(e);
      if (c.k === 'var') {
        const f = fn;
        if (f && !f.returns) return { k: 'callstmt', name: f.name, args };
        const m = this.lang === 'vba' ? this.vbaMethod(c.name) : null;
        if (m && args.length) return { k: 'methodstmt', obj: args[0], name: m, args: args.slice(1) };
        return { k: 'libstmt', lib: this.freeLib(c.name), fn: c.name, args };
      }
      if (c.k === 'member') {
        const path = dottedName(c.obj);
        if (path && this.isPackagePath(path)) return { k: 'libstmt', lib: `ext:${path}`, fn: c.name, args };
        return { k: 'methodstmt', obj: this.expr(c.obj), name: c.name, args };
      }
    }
    if (e.k === 'raw') return { k: 'raw', code: e.code, lang: e.lang };
    return { k: 'raw', code: e.src ?? '', lang: this.lang };
  }

  expr(e: Ex): Ex {
    if (!e) return e;
    const lib = tryPatterns(this.lang, libPatterns(this.lang, false), e);
    if (lib) return this.children(lib.build(lib.holes));
    const b = tryPatterns(this.lang, builtinPatterns(this.lang), e);
    if (b) return this.children(b.build(b.holes));
    switch (e.k) {
      case 'pcall': {
        const c = e.callee;
        const fn = c.k === 'var' ? this.userFns.get(this.key(c.name)) : undefined;
        if (fn) return { k: 'call', name: fn.name, args: this.callArgs(fn, e) };
        // Konto("Ada") / NeuKonto("Ada") (VBA): a new object
        if (c.k === 'var') {
          const cls = this.classNames.get(this.key(c.name)) ?? (this.lang === 'vba' && /^neu/i.test(c.name) ? this.classNames.get(this.key(c.name.slice(3))) : undefined);
          const def = cls ? this.program.classes!.find((x) => x.name === cls)! : null;
          if (def) return { k: 'new', cls: def.name, args: this.callArgs({ params: def.ctorParams }, e) };
          const m = this.lang === 'vba' ? this.vbaMethod(c.name) : null;
          if (m && e.args.length) return { k: 'method', obj: this.expr(e.args[0]), name: m, args: e.args.slice(1).map((a) => this.expr(a)) };
        }
        const args = this.plainArgs(e);
        if (c.k === 'var') {
          if (this.lang === 'vba' && c.name.toLowerCase() === 'array') return { k: 'list', items: args };
          // mapOf(k, v, ...) (Java helper) / NewDict(k, v, ...) (VBA helper)
          if (/^(mapOf|newdict)$/i.test(c.name) && args.length % 2 === 0) return { k: 'dict', entries: pairsOf(args) };
          if (this.lang === 'vba' && c.name.toLowerCase() === 'createobject' && args[0]?.k === 'str' && /dictionary/i.test(args[0].v)) return { k: 'dict', entries: [] };
          return { k: 'lib', lib: this.freeLib(c.name), fn: c.name, args };
        }
        if (c.k === 'member') {
          const path = dottedName(c.obj);
          if (path && /^(List|Arrays|Set|Stream)$/.test(path) && /^(of|asList)$/.test(c.name)) return { k: 'list', items: args };
          if (path === 'Map' && c.name === 'of' && args.length % 2 === 0) return { k: 'dict', entries: pairsOf(args) };
          if (path && this.isPackagePath(path)) return { k: 'lib', lib: `ext:${path}`, fn: c.name, args };
          return { k: 'method', obj: this.expr(c.obj), name: c.name, args };
        }
        return this.raw(e);
      }
      case 'pslice': {
        if (e.step?.k === 'num' && e.step.v === -1 && !e.from && !e.to) return { k: 'lib', lib: 'text', fn: 'reverse', args: [this.expr(e.obj)] };
        if (!e.step) {
          const obj = this.expr(e.obj);
          return { k: 'lib', lib: 'text', fn: 'substring', args: [obj, this.expr(e.from) ?? { k: 'num', v: 0 }, this.expr(e.to) ?? { k: 'len', of: 'auto', a: obj }] };
        }
        return this.raw(e);
      }
      case 'pnew': {
        const t = e.type.replace(/<.*$/s, '').replace(/^(java\.util\.|System\.Collections\.Generic\.|std::)/, '');
        const userCls = this.classNames.get(this.key(t));
        if (userCls && !e.init) return { k: 'new', cls: userCls, args: e.args.map((a) => this.expr(a)) };
        if (['HashMap', 'LinkedHashMap', 'TreeMap', 'Map', 'Dictionary', 'map', 'unordered_map'].includes(t)) {
          // { {k, v}, ... }  /  new Map([[k, v], ...])  /  new HashMap<>(Map.of(...))
          if (e.init) return this.dictFromPairs(e.init) ?? this.raw(e);
          if (!e.args.length) return { k: 'dict', entries: [] };
          const inner = this.expr(e.args[0]);
          if (inner?.k === 'dict') return inner;
          if (inner?.k === 'list') return this.dictFromPairs(inner.items) ?? this.raw(e);
          return this.raw(e);
        }
        if (['ArrayList', 'List', 'LinkedList', 'vector'].includes(t)) {
          if (e.init) return { k: 'list', items: e.init.map((x) => this.expr(x)) };
          if (!e.args.length) return { k: 'list', items: [] };
          const inner = this.expr(e.args[0]);
          if (inner?.k === 'list') return inner;
          if (e.args.length === 1 && inner && inner.k !== 'num') return inner;
          return { k: 'list', items: [] };
        }
        return this.raw(e);
      }
      case 'pcast': {
        const t = e.type.replace(/^std::/, '');
        const a = this.expr(e.a);
        if (['int', 'long', 'short', 'byte', 'Integer', 'Long'].includes(t)) return { k: 'convert', to: 'int', a };
        if (['double', 'float', 'Double', 'Float'].includes(t)) return { k: 'convert', to: 'float', a };
        if (['String', 'string'].includes(t)) return { k: 'convert', to: 'text', a };
        return this.raw(e);
      }
      case 'pin':
        return { k: 'lib', lib: 'text', fn: 'contains', args: [this.expr(e.b), this.expr(e.a)] };
      case 'member': {
        // pulp.LpMaximize: a value from a package
        const path = dottedName(e.obj);
        if (path && this.isPackagePath(path)) return { k: 'lib', lib: `ext:${path}`, fn: e.name, args: [], get: true };
        return this.children(e);
      }
      case 'var':
        // "from pulp import LpMaximize": the name alone
        if (this.fromNames.has(this.key(e.name)) && !this.userFns.has(this.key(e.name))) return { k: 'lib', lib: `ext:${this.fromNames.get(this.key(e.name))}`, fn: e.name, args: [], get: true };
        return this.children(e);
      case 'pbin':
      case 'punary':
      case 'plambda':
        return this.raw(e);
      default:
        return this.children(e);
    }
  }

  children(e: Expr): Expr {
    const out: any = { ...e };
    for (const [k, v] of Object.entries(e)) {
      if (k === 'src' || k === 'id') continue;
      if (Array.isArray(v)) out[k] = v.map((x) => (x && typeof x === 'object' && 'k' in x ? this.expr(x) : isEntry(x) ? { key: this.expr(x.key), value: this.expr(x.value) } : x));
      else if (v && typeof v === 'object' && 'k' in (v as any)) out[k] = this.expr(v as Expr);
    }
    delete out.src;
    return out;
  }
}

function pairsOf(args: Ex[]): { key: Ex; value: Ex }[] {
  const out: { key: Ex; value: Ex }[] = [];
  for (let i = 0; i + 1 < args.length; i += 2) out.push({ key: args[i], value: args[i + 1] });
  return out;
}

function isEntry(x: any): x is { key: Ex; value: Ex } {
  return !!x && typeof x === 'object' && !('k' in x) && 'key' in x && 'value' in x;
}

function dottedName(e: Ex): string | null {
  if (!e) return null;
  if (e.k === 'var') return e.name;
  if (e.k === 'member') {
    const base = dottedName(e.obj);
    return base ? `${base}.${e.name}` : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Passes that need types

function mapExprs(stmts: Stmt[], fn: (e: Expr) => Expr): Stmt[] {
  const ex = (e: Ex): Ex => {
    if (!e) return e;
    const out: any = { ...e };
    for (const [k, v] of Object.entries(e)) {
      if (Array.isArray(v)) out[k] = v.map((x) => (x && typeof x === 'object' && 'k' in x ? ex(x) : isEntry(x) ? { key: ex(x.key), value: ex(x.value) } : x));
      else if (v && typeof v === 'object' && 'k' in (v as any)) out[k] = ex(v as Expr);
    }
    return fn(out);
  };
  const st = (s: Stmt): Stmt => {
    const out: any = { ...s };
    for (const [k, v] of Object.entries(s)) {
      if (k === 'body' || k === 'else' || k === 'handler') out[k] = v ? (v as Stmt[]).map(st) : v;
      else if (k === 'branches') out[k] = (v as any[]).map((b) => ({ cond: ex(b.cond), body: b.body.map(st) }));
      else if (k === 'args') out[k] = (v as Ex[]).map(ex);
      else if (v && typeof v === 'object' && 'k' in (v as any)) out[k] = ex(v as Expr);
    }
    return out;
  };
  return stmts.map(st);
}

function mapProgram(p: Program, fn: (e: Expr, place: string) => Expr): Program {
  const exprIn = (e: Ex, place: string): Ex => (e ? (mapExprs([{ k: 'pexpr', e }], (x) => fn(x, place))[0] as any).e : e);
  return {
    ...p,
    main: p.main ? mapExprs(p.main, (e) => fn(e, '')) : null,
    functions: p.functions.map((f) => ({ ...f, body: mapExprs(f.body, (e) => fn(e, f.name)) })),
    ...(p.classes
      ? {
          classes: p.classes.map((c) => ({
            ...c,
            fields: c.fields.map((x) => ({ ...x, value: exprIn(x.value, methodPlace(c.name, CTOR)) })),
            ctor: mapExprs(c.ctor, (e) => fn(e, methodPlace(c.name, CTOR))),
            methods: c.methods.map((m) => ({ ...m, body: mapExprs(m.body, (e) => fn(e, methodPlace(c.name, m.name))) })),
          })),
        }
      : {}),
  };
}

function simplify(e: Expr): Expr {
  if (e.k === 'convert' && e.to === 'int' && e.a?.k === 'math' && ['round', 'ceil', 'floor'].includes(e.a.fn)) return e.a;
  if (e.k === 'convert' && e.to === 'int' && e.a?.k === 'bin' && e.a.op === 'DIV') return { ...e.a, op: 'IDIV', trunc: true };
  if (e.k === 'convert' && e.to !== 'text' && e.a?.k === 'ask' && e.a.as === 'text') return { ...e.a, as: e.to };
  if (e.k === 'math' && e.fn === 'neg' && e.a?.k === 'num') return { ...e.a, v: -e.a.v };
  return e;
}

/** (double) a / b  ->  a / b  (the block "/" is always a real division). */
function stripDivCasts(e: Expr): Expr {
  if (e.k === 'bin' && e.op === 'DIV') {
    const a = e.a?.k === 'convert' && e.a.to === 'float' ? e.a.a : e.a;
    const b = e.b?.k === 'convert' && e.b.to === 'float' ? e.b.a : e.b;
    return { ...e, a, b };
  }
  return e;
}

const hasCast = (x: Ex) => x?.k === 'convert' && x.to === 'float';

function flattenJoin(e: Ex, isStr: (e: Ex) => boolean, out: Ex[]) {
  if (e?.k === 'bin' && e.op === 'ADD' && (isStr(e.a) || isStr(e.b) || isStr(e))) {
    flattenJoin(e.a, isStr, out);
    flattenJoin(e.b, isStr, out);
  } else if (e?.k === 'join') {
    for (const p of e.parts) flattenJoin(p, isStr, out);
  } else out.push(e?.k === 'convert' && e.to === 'text' ? e.a : e);
}

export function normalize(program: Program, lang: Lang, diagnostics: Diagnostic[] = []): ParseResult {
  const nz = new Normalizer(program, lang);
  let p: Program = {
    ...program,
    meta: { ...program.meta, sourceLang: lang },
    main: program.main ? nz.stmts(program.main) : null,
    functions: program.functions.map(({ defaults: _d, ...f }) => ({ ...f, body: nz.stmts(f.body) })),
    ...(program.classes
      ? {
          classes: program.classes.map((c) => ({
            ...c,
            fields: c.fields.map((x) => ({ ...x, value: nz.expr(x.value) })),
            // a constructor that only passes its values on to the base class is the inherited one
            ...(isPassOn(c) ? { ctorParams: [] } : {}),
            ctor: isPassOn(c) ? [] : nz.stmts(c.ctor),
            methods: c.methods.map(({ defaults: _d, ...m }) => ({ ...m, body: nz.stmts(m.body) })),
          })),
        }
      : {}),
  };
  p = mapProgram(p, simplify);

  // type-dependent fixes (two rounds: joins change types)
  for (let round = 0; round < 2; round++) {
    const a = analyze(p);
    const typed = lang === 'java' || lang === 'csharp' || lang === 'cpp';
    p = mapProgram(p, (e, place) => {
      const t = (x: Ex) => a.typeOf(x, place);
      const isStr = (x: Ex) => t(x) === 'string';
      switch (e.k) {
        case 'bin':
          if (e.op === 'ADD' && (isStr(e.a) || isStr(e.b))) {
            const parts: Ex[] = [];
            flattenJoin(e, isStr, parts);
            return { k: 'join', parts: mergeStr(parts) };
          }
          if (e.op === 'DIV' && typed && round === 0 && !hasCast(e.a) && !hasCast(e.b) && t(e.a) === 'int' && t(e.b) === 'int') return { ...e, op: 'IDIV', trunc: true };
          if (e.op === 'MUL' && isStr(e.a) && !isStr(e.b)) return { k: 'lib', lib: 'text', fn: 'repeat', args: [e.a, e.b] };
          return e;
        case 'join': {
          const parts: Ex[] = [];
          for (const x of e.parts) flattenJoin(x, isStr, parts);
          return { k: 'join', parts: mergeStr(parts) };
        }
        case 'len':
          if (isDict(t(e.a))) return { k: 'lib', lib: 'dict', fn: 'size', args: [e.a] };
          if (e.of === 'auto') return { ...e, of: isList(t(e.a)) ? 'list' : 'text' };
          return e;
        case 'index':
          if (isStr(e.list)) return { k: 'lib', lib: 'text', fn: 'charAt', args: [e.list, e.index] };
          if (isDict(t(e.list))) return { k: 'dget', dict: e.list, key: e.index };
          return e;
        case 'lib':
          if ((e.lib === 'text' || e.lib === 'list') && e.fn === 'contains' && isDict(t(e.args[0]))) return { ...e, lib: 'dict', fn: 'has' };
          if (e.lib === 'text' && (e.fn === 'contains' || e.fn === 'indexOf') && isList(t(e.args[0]))) return { ...e, lib: 'list' };
          if (e.lib === 'list' && (e.fn === 'contains' || e.fn === 'indexOf') && isStr(e.args[0])) return { ...e, lib: 'text' };
          return e;
        default:
          return e;
      }
    });
  }
  p = fixDictStatements(p);
  p = mapProgram(p, stripDivCasts);
  // Every language except Python rounds integer division and remainder toward zero.
  p = mapProgram(p, (e) => {
    if (e.k !== 'bin' || (e.op !== 'IDIV' && e.op !== 'MOD')) return e;
    const trunc = e.trunc ?? lang !== 'python';
    const { trunc: _old, ...rest } = e;
    return trunc ? { ...rest, trunc: true } : rest;
  });
  return { program: p, diagnostics: [...diagnostics, ...nz.diagnostics] };
}

/** list-style statements on dictionaries: d[k] = v, removing an entry. */
function fixDictStatements(p: Program): Program {
  const a = analyze(p);
  const fix = (stmts: Stmt[], place: string): Stmt[] =>
    stmts.map((s0) => {
      let s: any = { ...s0 };
      for (const key of ['body', 'else', 'handler']) if (Array.isArray(s[key])) s[key] = fix(s[key], place);
      if (s.branches) s.branches = s.branches.map((b: any) => ({ ...b, body: fix(b.body, place) }));
      const isD = (x: Ex) => isDict(a.typeOf(x, place));
      if (s.k === 'listset' && isD(s.list)) s = { k: 'dset', dict: s.list, key: s.index, value: s.value, gap: s.gap, trail: s.trail, id: s.id };
      if (s.k === 'libstmt' && s.lib === 'list' && s.fn === 'removeAt' && isD(s.args[0])) s = { ...s, lib: 'dict', fn: 'remove' };
      if (s.k === 'listadd' && isD(s.list)) s = { k: 'raw', code: '?', lang: p.meta?.sourceLang ?? 'python' };
      // for (k of d.keys()) / d.keySet() / d.Keys  ->  for each key of d
      if (s.k === 'foreach') {
        const l = s.list;
        if (l?.k === 'method' && !l.args.length && /^(keys|keySet)$/.test(l.name) && isD(l.obj)) s = { ...s, list: l.obj };
        else if (l?.k === 'member' && /^keys$/i.test(l.name) && isD(l.obj)) s = { ...s, list: l.obj };
        else if (l?.k === 'lib' && l.lib === 'dict' && l.fn === 'keys') s = { ...s, list: l.args[0] };
      }
      // C++: map<string, int> m = {{"a", 1}};
      if (s.k === 'set' && s.value?.k === 'list' && s.value.items.length && s.value.items.every((x: Ex) => x?.k === 'list' && x.items.length === 2) && isDict(a.varType(s.name, place))) {
        s = { ...s, value: { k: 'dict', entries: s.value.items.map((x: any) => ({ key: x.items[0], value: x.items[1] })) } };
      }
      return s;
    });
  return {
    ...p,
    main: p.main ? fix(p.main, '') : null,
    functions: p.functions.map((f) => ({ ...f, body: fix(f.body, f.name) })),
    ...(p.classes
      ? {
          classes: p.classes.map((c) => ({
            ...c,
            ctor: fix(c.ctor, methodPlace(c.name, CTOR)),
            methods: c.methods.map((m) => ({ ...m, body: fix(m.body, methodPlace(c.name, m.name)) })),
          })),
        }
      : {}),
  };
}

/** Hund(name) { super(name); } */
function isPassOn(c: ClassDef): boolean {
  if (!c.base || c.ctor.length !== 1) return false;
  const s = c.ctor[0];
  return s.k === 'superinit' && s.args.length === c.ctorParams.length && s.args.every((a, i) => a?.k === 'var' && a.name === c.ctorParams[i]);
}

function mergeStr(parts: Ex[]): Ex[] {
  const out: Ex[] = [];
  for (const x of parts) {
    const last = out[out.length - 1];
    if (x?.k === 'str' && last?.k === 'str' && !x.sep && !last.sep) out[out.length - 1] = { k: 'str', v: last.v + x.v };
    else if (!(x?.k === 'str' && x.v === '' && parts.length > 1)) out.push(x);
  }
  return out.length ? out : [{ k: 'str', v: '' }];
}
