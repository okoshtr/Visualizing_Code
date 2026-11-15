import type { Diagnostic, Ex, Expr, Lang, Program, Stmt } from '../ir';

export interface ParseResult {
  program: Program;
  diagnostics: Diagnostic[];
}

export class ParseError extends Error {
  constructor(
    message: string,
    public pos: number,
  ) {
    super(message);
  }
}

export interface Token {
  /** Token type: name, num, str, op, nl, indent, dedent, comment, eof, ... */
  t: string;
  v: string;
  s: number;
  e: number;
  /** Extra data, e.g. the parts of an f-string / template literal or string prefix. */
  x?: any;
}

export function lineOf(src: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

export function rawStmt(code: string, lang: Lang): Stmt {
  return { k: 'raw', code: code.replace(/\s+$/, ''), lang };
}

export function rawExpr(code: string, lang: Lang): Expr {
  return { k: 'raw', code: code.trim(), lang };
}

/** Negates an expression for "x -= e" (literal numbers become negative literals). */
export function negate(e: Ex): Ex {
  if (!e) return e;
  if (e.k === 'num') return { ...e, v: -e.v };
  return { k: 'math', fn: 'neg', a: e };
}

/** Unescapes a C-like / Python string body. */
export function unescape(body: string): string {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[0-7]{1,3}|.)/gs, (m, c: string) => {
    if (c.startsWith('u{')) return String.fromCodePoint(parseInt(c.slice(2, -1), 16));
    if (c[0] === 'u' && c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
    if (c[0] === 'x' && c.length === 3) return String.fromCharCode(parseInt(c.slice(1), 16));
    if (/^[0-7]+$/.test(c)) return c === '0' ? '\0' : String.fromCharCode(parseInt(c, 8));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', a: '\x07', '0': '\0' }[c] ?? c;
  });
}

export function lineStartOf(src: string, pos: number): number {
  let i = pos;
  while (i > 0 && src[i - 1] !== '\n') i--;
  return i;
}

/** Is the line before the one containing `pos` empty (and not at the start of the file)? */
export function blankLineBefore(src: string, pos: number): boolean {
  const ls = lineStartOf(src, pos);
  if (ls === 0) return false;
  const prev = lineStartOf(src, ls - 1);
  return src.slice(prev, ls).trim() === '' && src.slice(0, prev).trim() !== '';
}

/** Is there code before `pos` on the same line (i.e. a comment at the end of a line)? */
export function isTrailing(src: string, pos: number): boolean {
  return src.slice(lineStartOf(src, pos), pos).trim() !== '';
}

/** Marks the first statement as following an empty line. */
export function markGap(stmts: Stmt[], src: string, pos: number): Stmt[] {
  if (stmts.length && blankLineBefore(src, pos)) stmts[0] = { ...stmts[0], gap: true };
  return stmts;
}

/**
 * Rebuilds a statement / expression tree. fn may return a replacement for an expression
 * (it is not visited further) or undefined to keep it and continue with its children.
 */
export function mapTree<T>(node: T, fn: (e: Expr) => Expr | undefined): T {
  const visit = (x: any): any => {
    if (Array.isArray(x)) return x.map(visit);
    if (!x || typeof x !== 'object') return x;
    if ('k' in x && isExprKind(x.k)) {
      const r = fn(x);
      if (r !== undefined) return r;
    }
    const out: any = {};
    for (const [key, v] of Object.entries(x)) out[key] = key === 'src' || key === 'id' ? v : visit(v);
    return out;
  };
  return visit(node);
}

const STMT_KINDS = new Set(['print', 'set', 'change', 'if', 'repeat', 'while', 'for', 'foreach', 'break', 'continue', 'listadd', 'listset', 'callstmt', 'libstmt', 'methodstmt', 'return', 'try', 'throw', 'dset', 'fset', 'comment', 'pexpr']);
const isExprKind = (k: string) => !STMT_KINDS.has(k);

/** In a catch handler: references to the caught error variable become "Fehlermeldung". */
export function errorVarToMessage(stmts: Stmt[], name: string, lang: Lang): Stmt[] {
  if (!name) return stmts;
  const isVar = (e: any) => e?.k === 'var' && (lang === 'vba' ? e.name.toLowerCase() === name.toLowerCase() : e.name === name);
  return mapTree(stmts, (e) => {
    // str(e), e.getMessage(), e.Message, e.what(), e.message, string(e.what())
    if (e.k === 'pcall' && e.callee.k === 'var' && (e.callee.name === 'str' || e.callee.name === 'string') && e.args.length === 1) {
      const a: any = e.args[0];
      if (isVar(a)) return { k: 'errmsg' };
      if (a?.k === 'pcall' && a.callee.k === 'member' && isVar(a.callee.obj) && a.callee.name === 'what') return { k: 'errmsg' };
    }
    if (e.k === 'pcall' && e.callee.k === 'member' && isVar(e.callee.obj) && ['getMessage', 'what', 'ToString', 'toString'].includes(e.callee.name) && !e.args.length) return { k: 'errmsg' };
    if (e.k === 'member' && isVar(e.obj) && (e.name === 'Message' || e.name === 'message')) return { k: 'errmsg' };
    if (isVar(e)) return { k: 'errmsg' };
    return undefined;
  });
}

/** if-chain for switch / Select Case / match: subject == value1 || subject == value2 ... */
export function caseCondition(subject: Ex, values: Ex[]): Ex {
  const conds: Ex[] = values.map((v) => ({ k: 'bin', op: 'EQ', a: subject, b: v }) as Expr);
  return conds.reduce((acc, c) => (acc ? ({ k: 'bin', op: 'OR', a: acc, b: c } as Expr) : c), null as Ex);
}

/** Does the statement list end the case (break / return / throw / continue at its end)? */
export function endsCase(stmts: Stmt[]): boolean {
  const last = stmts[stmts.length - 1];
  return !!last && (last.k === 'break' || last.k === 'return' || last.k === 'throw' || last.k === 'continue');
}

/** "break" anywhere except at the end (inside if-blocks) cannot be turned into an if-chain. */
export function hasInnerBreak(stmts: Stmt[]): boolean {
  let found = false;
  const visit = (list: Stmt[], top: boolean) => {
    list.forEach((s, i) => {
      if (s.k === 'break' && !(top && i === list.length - 1)) found = true;
      if (s.k === 'if') {
        s.branches.forEach((b) => visit(b.body, false));
        if (s.else) visit(s.else, false);
      }
      if (s.k === 'try') {
        visit(s.body, false);
        visit(s.handler, false);
      }
    });
  };
  visit(stmts, true);
  return found;
}

export const isIdentStart = (c: string) => /[\p{L}_$]/u.test(c);
export const isIdentChar = (c: string) => /[\p{L}\p{N}_$]/u.test(c);
