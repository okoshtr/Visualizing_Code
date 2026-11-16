// Ways of writing things that are typical for one language and only recognisable by looking
// at the details (e.g. the format text in String.format("%.2f", x)). They become the same
// blocks as everywhere else, so the program can be shown in every language.

import { foldPlus } from '../generators/base';
import type { Ex, Expr, Lang, Stmt } from '../ir';

const num = (v: number): Expr => ({ k: 'num', v });
const str = (v: string): Expr => ({ k: 'str', v });
const lib = (l: string, fn: string, args: Ex[]): Expr => ({ k: 'lib', lib: l, fn, args });
const fixed = (x: Ex, digits: number): Expr => lib('text', 'fixed', [x, num(digits)]);
const length = (s: Ex): Expr => ({ k: 'len', of: 'text', a: s });
const plus = (a: Ex, b: Ex): Ex => (b?.k === 'num' && Number.isInteger(b.v) ? foldPlus(a, b.v) : a?.k === 'num' && b ? foldPlus(b, a.v) : { k: 'bin', op: 'ADD', a, b });

/** One piece of a format text: plain text or a value with an optional number of decimals. */
type Piece = { text: string } | { arg: number; digits?: number; kind: string };

/**
 * printf style: "%d Stück, %.2f Euro%n" (Java, C), also "%s" and "%f".
 * Returns null for anything that has no block (widths, flags, other conversions).
 */
export function parsePrintf(fmt: string): { pieces: Piece[]; newline: boolean } | null {
  const pieces: Piece[] = [];
  let text = '';
  let arg = 0;
  let newline = false;
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== '%') {
      text += c;
      continue;
    }
    const m = /^%(?:\.(\d+))?([dsfn%])/.exec(fmt.slice(i));
    if (!m) return null;
    i += m[0].length - 1;
    if (m[2] === '%') {
      text += '%';
      continue;
    }
    if (m[2] === 'n') {
      text += '\n';
      continue;
    }
    if (text) pieces.push({ text });
    text = '';
    if (m[1] !== undefined && m[2] !== 'f') return null;
    pieces.push({ arg: arg++, kind: m[2], digits: m[2] === 'f' ? Number(m[1] ?? 6) : undefined });
  }
  if (text.endsWith('\n') && !text.slice(0, -1).includes('\n')) {
    newline = true;
    text = text.slice(0, -1);
  }
  if (text) pieces.push({ text });
  return { pieces, newline };
}

/** Python / C# placeholders: "{} hat {:.2f}" / "{0} hat {1:F2}". */
export function parseBraces(fmt: string, lang: Lang): Piece[] | null {
  const pieces: Piece[] = [];
  let text = '';
  let auto = 0;
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if ((c === '{' || c === '}') && fmt[i + 1] === c) {
      text += c;
      i++;
      continue;
    }
    if (c === '}') return null;
    if (c !== '{') {
      text += c;
      continue;
    }
    const end = fmt.indexOf('}', i);
    if (end < 0) return null;
    const inner = fmt.slice(i + 1, end);
    i = end;
    const m = /^(\d*)(?::(.*))?$/.exec(inner);
    if (!m) return null;
    const argNo = m[1] === '' ? (lang === 'python' ? auto++ : -1) : Number(m[1]);
    if (argNo < 0) return null;
    const digits = formatDigits(m[2], lang);
    if (digits === null) return null;
    if (text) pieces.push({ text });
    text = '';
    pieces.push({ arg: argNo, kind: 'any', digits });
  }
  if (text) pieces.push({ text });
  return pieces;
}

/** Number of decimals of a format such as ".2f" (Python), "F2" or "0.00" (C#, VBA); undefined = none. */
export function formatDigits(spec: string | undefined, lang: Lang): number | undefined | null {
  if (spec === undefined || spec === '') return undefined;
  let m = /^\.(\d+)f$/.exec(spec);
  if (m && lang === 'python') return Number(m[1]);
  m = /^[Ff](\d+)$/.exec(spec);
  if (m && lang === 'csharp') return Number(m[1]);
  m = /^0(?:\.(0+))?$/.exec(spec);
  if (m && (lang === 'csharp' || lang === 'vba')) return m[1]?.length ?? 0;
  return null;
}

/** Text pieces and values -> one text (join). */
function joinPieces(pieces: Piece[], args: Ex[]): Expr | null {
  const parts: Ex[] = [];
  for (const p of pieces) {
    if ('text' in p) parts.push(str(p.text));
    else {
      const a = args[p.arg];
      if (a === undefined) return null;
      parts.push(p.digits !== undefined ? fixed(a, p.digits) : a);
    }
  }
  if (parts.length === 0) return str('');
  if (parts.length === 1) return parts[0]!.k === 'str' ? parts[0]! : { k: 'join', parts: [str(''), parts[0]] };
  return { k: 'join', parts };
}

const isVar = (e: Ex, name: string, lang: Lang) => e?.k === 'var' && (lang === 'vba' ? e.name.toLowerCase() === name.toLowerCase() : e.name === name);
const isMember = (e: Ex, obj: string, name: string) => e?.k === 'member' && e.name === name && e.obj?.k === 'var' && e.obj.name === obj;

/**
 * An expression in the way the language writes it -> blocks, or undefined.
 * `ex` normalizes the parts (arguments).
 */
export function idiomExpr(e: Expr, lang: Lang, ex: (e: Ex) => Ex): Ex | undefined {
  if (((e.k === 'pbin' && e.op === '%') || (e.k === 'bin' && e.op === 'MOD')) && lang === 'python' && e.a?.k === 'str') {
    // "%.2f Euro" % preis  /  "%d von %d" % (a, b)
    const f = parsePrintf(e.a.v);
    const args = e.b?.k === 'list' && e.b.src === '__tuple__' ? e.b.items : [e.b];
    const r = f && !f.newline ? joinPieces(f.pieces, args.map(ex)) : null;
    return r ?? undefined;
  }
  if (e.k !== 'pcall') return undefined;
  const c = e.callee;
  const args = e.args;
  if (c.k === 'var') {
    const name = lang === 'vba' ? c.name.toLowerCase() : c.name;
    if (lang === 'python') {
      // format(preis, ".2f")
      if (name === 'format' && args.length === 2 && args[1]?.k === 'str') {
        const d = formatDigits(args[1].v, 'python');
        if (typeof d === 'number') return fixed(ex(args[0]), d);
      }
    }
    if (lang === 'vba') {
      // Format(preis, "0.00")
      if (name === 'format' && args.length === 2 && args[1]?.k === 'str') {
        const d = formatDigits(args[1].v, 'vba');
        if (typeof d === 'number') return fixed(ex(args[0]), d);
      }
      // Left / Right / Mid (positions start at 1 in VBA)
      if (name === 'left' && args.length === 2) return lib('text', 'substring', [ex(args[0]), num(0), ex(args[1])]);
      if (name === 'right' && args.length === 2) {
        const s = ex(args[0]);
        return lib('text', 'substring', [s, { k: 'bin', op: 'SUB', a: length(s), b: ex(args[1]) }, length(s)]);
      }
      if (name === 'mid' && (args.length === 2 || args.length === 3)) {
        const s = ex(args[0]);
        const from = plus(ex(args[1]), num(-1));
        return lib('text', 'substring', [s, from, args.length === 3 ? plus(from, ex(args[2])) : length(s)]);
      }
      // InStr(text, part) gives 0 if not found, the position counted from 1 otherwise
      if (name === 'instr' && args.length === 2) return plus(lib('text', 'indexOf', [ex(args[0]), ex(args[1])]), num(1));
    }
    return undefined;
  }
  if (c.k !== 'member') return undefined;
  const obj = c.obj;
  const m = c.name;
  // Python: "{:.2f} Euro".format(preis), "{} hat {} Punkte".format(name, n)
  if (lang === 'python' && m === 'format' && obj?.k === 'str' && !e.kwargs) {
    const pieces = parseBraces(obj.v, 'python');
    const r = pieces ? joinPieces(pieces, args.map(ex)) : null;
    return r ?? undefined;
  }
  // Java: String.format("%.2f", x) (also with a Locale first)
  if (lang === 'java' && isMember(c, 'String', 'format')) {
    const rest = args[0]?.k === 'member' && args[0].obj?.k === 'var' && args[0].obj.name === 'Locale' ? args.slice(1) : args;
    if (rest[0]?.k === 'str') {
      const f = parsePrintf(rest[0].v);
      const r = f && !f.newline ? joinPieces(f.pieces, rest.slice(1).map(ex)) : null;
      if (r) return r;
    }
  }
  // C#: x.ToString("F2") / x.ToString("0.00")
  if (lang === 'csharp' && m === 'ToString' && args.length === 1 && args[0]?.k === 'str') {
    const d = formatDigits(args[0].v, 'csharp');
    if (typeof d === 'number') return fixed(ex(obj), d);
  }
  // C#: s.Substring(von, Länge) / s.Substring(von); C++: s.substr(...)
  if ((lang === 'csharp' && m === 'Substring') || (lang === 'cpp' && m === 'substr')) {
    const s = ex(obj);
    if (args.length === 1) return lib('text', 'substring', [s, ex(args[0]), length(s)]);
    if (args.length === 2) {
      const from = ex(args[0]);
      return lib('text', 'substring', [s, from, plus(from, ex(args[1]))]);
    }
  }
  // C++: v.back() / v.front()
  if (lang === 'cpp' && (m === 'back' || m === 'front') && args.length === 0) {
    const l = ex(obj);
    return { k: 'index', list: l, index: m === 'front' ? num(0) : { k: 'bin', op: 'SUB', a: { k: 'len', of: 'list', a: l }, b: num(1) } };
  }
  // Java: Arrays.toString(a) is the text of the list
  if (lang === 'java' && isMember(c, 'Arrays', 'toString') && args.length === 1) return { k: 'convert', to: 'text', a: ex(args[0]) };
  return undefined;
}

/** A statement in the way the language writes it -> blocks, or undefined. */
export function idiomStmt(e: Expr, lang: Lang, ex: (e: Ex) => Ex): Stmt | undefined {
  if (e.k !== 'pcall' || e.callee.k !== 'member') return undefined;
  const c = e.callee;
  // Java: System.out.printf("%d Stück%n", n)
  if (lang === 'java' && c.name === 'printf' && c.obj?.k === 'member' && c.obj.name === 'out' && c.obj.obj?.k === 'var' && c.obj.obj.name === 'System' && e.args[0]?.k === 'str') {
    const f = parsePrintf(e.args[0].v);
    const value = f ? joinPieces(f.pieces, e.args.slice(1).map(ex)) : null;
    if (f && value) return { k: 'print', value, newline: f.newline };
  }
  // Java: Arrays.sort(a); C#: Array.Sort(a)
  if (((lang === 'java' && isMember(c, 'Arrays', 'sort')) || (lang === 'csharp' && isMember(c, 'Array', 'Sort'))) && e.args.length === 1) {
    return { k: 'libstmt', lib: 'list', fn: 'sort', args: [ex(e.args[0])] };
  }
  return undefined;
}

export { isVar };
