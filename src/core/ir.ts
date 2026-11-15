// Language-neutral program model ("IR").
// Blocks  <->  IR  <->  source code in every supported language.

export type Lang = 'python' | 'java' | 'javascript' | 'csharp' | 'cpp' | 'vba';

export const LANGS: Lang[] = ['python', 'java', 'javascript', 'csharp', 'cpp', 'vba'];

export const LANG_INFO: Record<Lang, { label: string; ext: string; extensions: string[] }> = {
  python: { label: 'Python', ext: 'py', extensions: ['py'] },
  java: { label: 'Java', ext: 'java', extensions: ['java'] },
  javascript: { label: 'JavaScript', ext: 'js', extensions: ['js', 'mjs', 'cjs'] },
  csharp: { label: 'C#', ext: 'cs', extensions: ['cs'] },
  cpp: { label: 'C++', ext: 'cpp', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'h'] },
  vba: { label: 'VBA', ext: 'bas', extensions: ['bas', 'vba', 'vb', 'cls'] },
};

export function langFromFileName(fileName: string): Lang | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  for (const lang of LANGS) if (LANG_INFO[lang].extensions.includes(ext)) return lang;
  return null;
}

export type ArithOp = 'ADD' | 'SUB' | 'MUL' | 'DIV' | 'IDIV' | 'MOD' | 'POW';
export type CompareOp = 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE';
export type LogicOp = 'AND' | 'OR';
export type BinOp = ArithOp | CompareOp | LogicOp;
export type MathFn = 'sqrt' | 'abs' | 'neg' | 'ln' | 'log10' | 'exp' | 'pow10' | 'round' | 'ceil' | 'floor';
export type AskType = 'text' | 'int' | 'float';
export type ConvertType = 'int' | 'float' | 'text';

export const ARITH_OPS: ArithOp[] = ['ADD', 'SUB', 'MUL', 'DIV', 'IDIV', 'MOD', 'POW'];
export const COMPARE_OPS: CompareOp[] = ['EQ', 'NEQ', 'LT', 'LTE', 'GT', 'GTE'];

interface Node {
  /** Id of the block this node came from (for highlighting while running). */
  id?: string;
  /** Source text (only set by the parsers, used for fallbacks). */
  src?: string;
  /** Statement: an empty line comes before it. */
  gap?: boolean;
  /** Statement: comment at the end of its (last) line. */
  trail?: string;
}

export type Expr = Node &
  (
    | { k: 'num'; v: number; float?: boolean }
    | { k: 'str'; v: string }
    | { k: 'bool'; v: boolean }
    | { k: 'var'; name: string }
    /** For IDIV/MOD: trunc = round toward zero (Java, C#, C++, JS, VBA); default = round down (Python). */
    | { k: 'bin'; op: BinOp; a: Ex; b: Ex; trunc?: boolean }
    | { k: 'not'; a: Ex }
    | { k: 'math'; fn: MathFn; a: Ex }
    | { k: 'random'; from: Ex; to: Ex }
    | { k: 'join'; parts: Ex[] }
    | { k: 'len'; of: 'text' | 'list' | 'auto'; a: Ex }
    | { k: 'ask'; prompt: Ex; as: AskType }
    | { k: 'convert'; to: ConvertType; a: Ex }
    | { k: 'list'; items: Ex[] }
    | { k: 'index'; list: Ex; index: Ex }
    /** Call of a user-defined function that returns a value. */
    | { k: 'call'; name: string; args: Ex[] }
    /** Library function: catalog entry (lib = 'math' | 'text' | ...) or external ("ext:numpy"). */
    | { k: 'lib'; lib: string; fn: string; args: Ex[] }
    /** Method call on an object that is not covered by the catalog, e.g. obj.doSomething(x). */
    | { k: 'method'; obj: Ex; name: string; args: Ex[] }
    /** Attribute access, e.g. obj.field. */
    | { k: 'member'; obj: Ex; name: string }
    /** "cond ? a : b" */
    | { k: 'cond'; cond: Ex; a: Ex; b: Ex }
    /** Message of the error caught by the surrounding "versuche ... falls Fehler" block. */
    | { k: 'errmsg' }
    /** Dictionary (map) literal. */
    | { k: 'dict'; entries: { key: Ex; value: Ex }[] }
    /** Value for a key in a dictionary. */
    | { k: 'dget'; dict: Ex; key: Ex }
    /** Fallback: source text that has no block yet. */
    | { k: 'raw'; code: string; lang: Lang }
    // ---- parse-only nodes, removed by normalize() ----
    | { k: 'pcall'; callee: Expr; args: Ex[]; kwargs?: Record<string, Expr> }
    | { k: 'pslice'; obj: Ex; from: Ex; to: Ex; step: Ex }
    | { k: 'pnew'; type: string; args: Ex[]; init?: Ex[] }
    | { k: 'pcast'; type: string; a: Ex }
    | { k: 'pin'; a: Ex; b: Ex }
    | { k: 'pbin'; op: string; a: Ex; b: Ex }
    | { k: 'punary'; op: string; a: Ex; postfix?: boolean }
    | { k: 'plambda' }
  );

export type Ex = Expr | null;

export type Stmt = Node &
  (
    | { k: 'print'; value: Ex; newline: boolean }
    | { k: 'set'; name: string; value: Ex }
    | { k: 'change'; name: string; by: Ex }
    | { k: 'if'; branches: { cond: Ex; body: Stmt[] }[]; else: Stmt[] | null }
    | { k: 'repeat'; times: Ex; body: Stmt[] }
    /** post: the condition is checked after the body (do ... while). */
    | { k: 'while'; until: boolean; cond: Ex; body: Stmt[]; post?: boolean }
    | { k: 'for'; var: string; from: Ex; to: Ex; by: Ex; body: Stmt[] }
    | { k: 'foreach'; var: string; list: Ex; body: Stmt[] }
    | { k: 'break' }
    | { k: 'continue' }
    | { k: 'listadd'; list: Ex; value: Ex }
    | { k: 'listset'; list: Ex; index: Ex; value: Ex }
    /** Call of a user-defined function as a statement. */
    | { k: 'callstmt'; name: string; args: Ex[] }
    /** Library function used as a statement (e.g. list sort, wait). */
    | { k: 'libstmt'; lib: string; fn: string; args: Ex[] }
    | { k: 'methodstmt'; obj: Ex; name: string; args: Ex[] }
    | { k: 'return'; value: Ex }
    /** try / catch */
    | { k: 'try'; body: Stmt[]; handler: Stmt[] }
    /** raise an error with a message */
    | { k: 'throw'; value: Ex }
    /** set the value for a key in a dictionary */
    | { k: 'dset'; dict: Ex; key: Ex; value: Ex }
    | { k: 'comment'; text: string }
    | { k: 'raw'; code: string; lang: Lang }
    // ---- parse-only ----
    | { k: 'pexpr'; e: Expr }
  );

export interface FunctionDef {
  id?: string;
  name: string;
  params: string[];
  body: Stmt[];
  /** True if the function returns a value. */
  returns: boolean;
  /** Comment shown above the function. */
  comment?: string;
  /** Parse only: default values of parameters (filled in at the call sites). */
  defaults?: Ex[];
}

export type TypeName = 'int' | 'double' | 'string' | 'bool' | 'any' | `list<${string}>`;

export interface ImportInfo {
  lang: Lang;
  /** Module as written in the source, e.g. "numpy". */
  module: string;
  /** Name used in code, e.g. "np" for "import numpy as np". */
  alias: string;
}

export interface ProgramMeta {
  /** Declared types from typed source code: "scope:name" -> type (scope "" = main/global). */
  types?: Record<string, TypeName>;
  /** Variables that are explicitly local in a function: function name -> names. */
  locals?: Record<string, string[]>;
  /** External imports (libraries that are not part of the built-in catalog). */
  imports?: ImportInfo[];
  /** Java / C# class name. */
  className?: string;
  /** VBA: name of the Sub that is the main program (default "Main"). */
  mainName?: string;
  /** Language the program was read from (className / mainName only apply there). */
  sourceLang?: Lang;
}

export interface Program {
  /** Body of the "when program starts" block; null if there is no start block. */
  main: Stmt[] | null;
  mainId?: string;
  functions: FunctionDef[];
  meta?: ProgramMeta;
}

export interface Diagnostic {
  message: string;
  line?: number;
  blockId?: string;
}

// ---------------------------------------------------------------------------
// Small helpers

export const num = (v: number, float = false): Expr => (float ? { k: 'num', v, float } : { k: 'num', v });
export const str = (v: string): Expr => ({ k: 'str', v });
export const v = (name: string): Expr => ({ k: 'var', name });

/** Calls fn for every expression contained (directly or nested) in the statement list. */
export function walkStmts(stmts: Stmt[], onStmt: (s: Stmt, depth: number, loopDepth: number) => void, depth = 0, loopDepth = 0): void {
  for (const s of stmts) {
    onStmt(s, depth, loopDepth);
    for (const body of childBodies(s)) {
      const isLoop = s.k === 'repeat' || s.k === 'while' || s.k === 'for' || s.k === 'foreach';
      walkStmts(body, onStmt, depth + 1, loopDepth + (isLoop ? 1 : 0));
    }
  }
}

export function childBodies(s: Stmt): Stmt[][] {
  switch (s.k) {
    case 'if':
      return [...s.branches.map((b) => b.body), ...(s.else ? [s.else] : [])];
    case 'repeat':
    case 'while':
    case 'for':
    case 'foreach':
      return [s.body];
    case 'try':
      return [s.body, s.handler];
    default:
      return [];
  }
}

/** Direct expressions of a statement (not of nested statements). */
export function stmtExprs(s: Stmt): Ex[] {
  switch (s.k) {
    case 'print':
      return [s.value];
    case 'set':
      return [s.value];
    case 'change':
      return [s.by];
    case 'if':
      return s.branches.map((b) => b.cond);
    case 'repeat':
      return [s.times];
    case 'while':
      return [s.cond];
    case 'for':
      return [s.from, s.to, s.by];
    case 'foreach':
      return [s.list];
    case 'listadd':
      return [s.list, s.value];
    case 'listset':
      return [s.list, s.index, s.value];
    case 'callstmt':
    case 'libstmt':
      return s.args;
    case 'methodstmt':
      return [s.obj, ...s.args];
    case 'return':
      return [s.value];
    case 'pexpr':
      return [s.e];
    case 'throw':
      return [s.value];
    case 'dset':
      return [s.dict, s.key, s.value];
    default:
      return [];
  }
}

export function exprChildren(e: Expr): Ex[] {
  switch (e.k) {
    case 'bin':
      return [e.a, e.b];
    case 'not':
    case 'math':
    case 'len':
    case 'convert':
      return [e.a];
    case 'random':
      return [e.from, e.to];
    case 'join':
      return e.parts;
    case 'ask':
      return [e.prompt];
    case 'list':
      return e.items;
    case 'index':
      return [e.list, e.index];
    case 'call':
    case 'lib':
      return e.args;
    case 'method':
      return [e.obj, ...e.args];
    case 'member':
      return [e.obj];
    case 'pcall':
      return [e.callee, ...e.args, ...Object.values(e.kwargs ?? {})];
    case 'pslice':
      return [e.obj, e.from, e.to, e.step];
    case 'pnew':
      return [...e.args, ...(e.init ?? [])];
    case 'pcast':
      return [e.a];
    case 'cond':
      return [e.cond, e.a, e.b];
    case 'dict':
      return e.entries.flatMap((x) => [x.key, x.value]);
    case 'dget':
      return [e.dict, e.key];
    case 'pin':
    case 'pbin':
      return [e.a, e.b];
    case 'punary':
      return [e.a];
    default:
      return [];
  }
}

export function walkExpr(e: Ex, fn: (e: Expr) => void): void {
  if (!e) return;
  fn(e);
  for (const c of exprChildren(e)) walkExpr(c, fn);
}

/** Visits every expression in a statement tree. */
export function walkAllExprs(stmts: Stmt[], fn: (e: Expr, s: Stmt) => void): void {
  walkStmts(stmts, (s) => {
    for (const e of stmtExprs(s)) walkExpr(e, (x) => fn(x, s));
  });
}

/** Deep structural equality of expressions, ignoring ids. */
export function exprEquals(a: Ex, b: Ex): boolean {
  return JSON.stringify(stripIds(a)) === JSON.stringify(stripIds(b));
}

export function stripIds<T>(x: T): T {
  return JSON.parse(JSON.stringify(x, (key, value) => (key === 'id' || key === 'src' ? undefined : value)));
}

export function isLiteralNumber(e: Ex): e is Expr & { k: 'num' } {
  return !!e && e.k === 'num';
}

/** Statement list -> all variable names that are assigned (set, change, loop vars). */
export function assignedNames(stmts: Stmt[]): Set<string> {
  const names = new Set<string>();
  walkStmts(stmts, (s) => {
    if (s.k === 'set' || s.k === 'change') names.add(s.name);
    if (s.k === 'for' || s.k === 'foreach') names.add(s.var);
  });
  return names;
}
