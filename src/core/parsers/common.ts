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

export const isIdentStart = (c: string) => /[\p{L}_$]/u.test(c);
export const isIdentChar = (c: string) => /[\p{L}\p{N}_$]/u.test(c);
