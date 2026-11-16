// Java / C# / C++ / JavaScript source -> IR

import { foldPlus } from '../generators/base';
import type { ClassDef, Ex, Expr, FunctionDef, ImportInfo, Lang, Program, Stmt, TypeName } from '../ir';
import { CTOR, assignedNames, methodPlace, walkAllExprs, walkStmts } from '../ir';
import { helperNames } from '../library';
import { ParseError, type ParseResult, type Token, blankLineBefore, mapTree, caseCondition, endsCase, errorVarToMessage, hasInnerBreak, isIdentChar, isIdentStart, lineOf, markGap, negate, rawStmt, unescape } from './common';
import { normalize } from './normalize';

type CLang = Exclude<Lang, 'python' | 'vba'>;

const OPS = [
  '>>>=', '<<=', '>>=', '>>>', '===', '!==', '...', '::', '->', '=>', '++', '--', '&&', '||', '??', '?.', '==', '!=', '<=', '>=',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '=',
  '?', ':', '(', ')', '[', ']', '{', '}', ',', ';', '.', '@', '#',
];

interface Comment {
  s: number;
  e: number;
  text: string;
}

export function tokenizeCLike(src: string, lang: CLang): { toks: Token[]; comments: Comment[] } {
  const toks: Token[] = [];
  const comments: Comment[] = [];
  let i = 0;
  let lineStart = true;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      lineStart = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      let e = i;
      while (e < src.length && src[e] !== '\n') e++;
      comments.push({ s: i, e, text: src.slice(i + 2, e).replace(/\r$/, '').replace(/^ /, '') });
      i = e;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? src.length : e + 2;
      const text = src
        .slice(i + 2, end - 2)
        .split('\n')
        .map((l) => l.replace(/^\s*\*? ?/, ''))
        .join('\n')
        .trim();
      comments.push({ s: i, e: end, text });
      i = end;
      continue;
    }
    if (c === '#' && lineStart && (lang === 'cpp' || lang === 'csharp')) {
      let e = i;
      while (e < src.length && src[e] !== '\n') e++;
      toks.push({ t: 'pp', v: src.slice(i, e).trim(), s: i, e });
      i = e;
      continue;
    }
    lineStart = false;
    // strings
    if (c === '"' || (c === "'" && lang === 'javascript') || (c === '@' && src[i + 1] === '"' && lang === 'csharp') || (c === '$' && src[i + 1] === '"' && lang === 'csharp')) {
      const s = i;
      const verbatim = c === '@';
      const interp = c === '$';
      if (verbatim || interp) i++;
      const q = src[i];
      let j = i + 1;
      let body = '';
      while (true) {
        if (j >= src.length || (src[j] === '\n' && !verbatim)) throw new ParseError('Ein Text (String) wird nicht geschlossen.', s);
        if (verbatim && src[j] === '"' && src[j + 1] === '"') {
          body += '"';
          j += 2;
          continue;
        }
        if (src[j] === q) break;
        if (src[j] === '\\' && !verbatim) {
          body += src[j] + src[j + 1];
          j += 2;
          continue;
        }
        body += src[j++];
      }
      i = j + 1;
      if (interp) toks.push({ t: 'tpl', v: body, s, e: i, x: splitInterpolation(body, '{', s + 2) });
      else toks.push({ t: 'str', v: verbatim ? body : unescape(body), s, e: i });
      continue;
    }
    if (c === "'") {
      // char literal
      const s = i;
      let j = i + 1;
      let body = '';
      while (j < src.length && src[j] !== "'") {
        if (src[j] === '\\') {
          body += src[j] + src[j + 1];
          j += 2;
        } else body += src[j++];
      }
      i = j + 1;
      toks.push({ t: 'str', v: unescape(body), s, e: i, x: { char: true } });
      continue;
    }
    if (c === '`' && lang === 'javascript') {
      const s = i;
      let j = i + 1;
      let depth = 0;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (depth === 0 && src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') {
          depth++;
          j += 2;
          continue;
        }
        if (depth > 0 && src[j] === '}') depth--;
        j++;
      }
      const body = src.slice(i + 1, j);
      i = j + 1;
      toks.push({ t: 'tpl', v: body, s, e: i, x: splitInterpolation(body, '${', s + 1) });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F_']+|0[bB][01_']+|(?:[0-9][0-9_']*)?\.?[0-9_']*(?:[eE][+-]?[0-9]+)?)([uUlLfFdDmMnN]*)/.exec(src.slice(i))!;
      toks.push({ t: 'num', v: m[1].replace(/['_]/g, ''), s: i, e: i + m[0].length, x: { suffix: m[2] } });
      i += m[0].length;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdentChar(src[j])) j++;
      toks.push({ t: 'name', v: src.slice(i, j), s: i, e: j });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ParseError(`Unbekanntes Zeichen "${c}".`, i);
    toks.push({ t: 'op', v: op, s: i, e: i + op.length });
    i += op.length;
  }
  toks.push({ t: 'eof', v: '', s: src.length, e: src.length });
  return { toks, comments };
}

/** Splits "Hallo {name}!" into text and expression parts. */
function splitInterpolation(body: string, open: '{' | '${', offset: number): { text?: string; expr?: string }[] {
  const parts: { text?: string; expr?: string }[] = [];
  let text = '';
  for (let i = 0; i < body.length; i++) {
    if (open === '{' && body[i] === '{' && body[i + 1] === '{') {
      text += '{';
      i++;
      continue;
    }
    if (open === '{' && body[i] === '}' && body[i + 1] === '}') {
      text += '}';
      i++;
      continue;
    }
    if (body.startsWith(open, i)) {
      if (text) parts.push({ text });
      text = '';
      let depth = 1;
      let j = i + open.length;
      while (j < body.length && depth > 0) {
        if (body[j] === '{') depth++;
        if (body[j] === '}') depth--;
        if (depth > 0) j++;
      }
      parts.push({ expr: body.slice(i + open.length, j) });
      i = j;
      continue;
    }
    if (body[i] === '\\') {
      text += body[i] + (body[i + 1] ?? '');
      i++;
      continue;
    }
    text += body[i];
  }
  if (text) parts.push({ text });
  void offset;
  return parts;
}

const MODIFIERS = new Set([
  'public', 'private', 'protected', 'static', 'final', 'internal', 'readonly', 'virtual', 'override', 'abstract', 'async',
  'inline', 'extern', 'unsafe', 'sealed', 'synchronized', 'native', 'transient', 'volatile', 'constexpr', 'export', 'default',
]);
const PRIMITIVES = new Set(['int', 'long', 'short', 'byte', 'double', 'float', 'char', 'boolean', 'bool', 'String', 'string', 'void', 'var', 'auto', 'decimal', 'object', 'Object', 'unsigned', 'signed', 'size_t', 'Integer', 'Double', 'dynamic']);
const GENERIC_TYPES = new Set(['vector', 'List', 'ArrayList', 'LinkedList', 'map', 'Map', 'HashMap', 'Dictionary', 'set', 'Set', 'HashSet', 'array', 'pair', 'Stack', 'Queue']);

export function typeHint(type: string): TypeName | null {
  const t = type.replace(/^(const\s+)/, '').replace(/[&*?]\s*$/, '').replace(/^std::/, '').trim();
  if (/^(int|long|short|byte|Integer|Long|Short|Byte|size_t|unsigned( int)?|signed( int)?|long long|unsigned long)$/.test(t)) return 'int';
  if (/^(double|float|Double|Float|decimal)$/.test(t)) return 'double';
  if (/^(String|string|char|Character)$/.test(t)) return 'string';
  if (/^(boolean|bool|Boolean)$/.test(t)) return 'bool';
  const arr = /^(.+)\[\]$/.exec(t);
  if (arr) {
    const inner = typeHint(arr[1]);
    return inner ? (`list<${inner}>` as TypeName) : null;
  }
  const map = /^(?:java\.util\.|System\.Collections\.Generic\.)?(HashMap|LinkedHashMap|TreeMap|Map|Dictionary|map|unordered_map)<(.+)>$/.exec(t);
  if (map) {
    const parts = splitTypeArgs(map[2]);
    const k = typeHint(parts[0] ?? '');
    const v = typeHint(parts[1] ?? '');
    return k && v ? (`dict<${k}|${v}>` as TypeName) : null;
  }
  const gen = /^(?:java\.util\.|System\.Collections\.Generic\.)?(ArrayList|List|LinkedList|vector)<(.+)>$/.exec(t);
  if (gen) {
    const inner = typeHint(gen[2]);
    return inner ? (`list<${inner}>` as TypeName) : null;
  }
  return null;
}

function splitTypeArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '<') depth++;
    if (c === '>') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

class CParser {
  p = 0;
  ci = 0;
  imports: ImportInfo[] = [];
  types: Record<string, TypeName> = {};
  locals: Record<string, string[]> = {};
  scope = '';
  className?: string;
  /** Statements found at the top level (JS / C# top-level statements / C++ globals). */
  topLevel: Stmt[] = [];
  mainBody: Stmt[] | null = null;
  functions: FunctionDef[] = [];
  globalInits: Stmt[] = [];
  helpers: Set<string>;
  declaredInScope = new Set<string>();

  constructor(
    public src: string,
    public lang: CLang,
    public toks: Token[],
    public comments: Comment[],
  ) {
    this.helpers = helperNames(lang);
    // names of the user's classes (known before they are parsed, e.g. for "Hund h;")
    toks.forEach((t, i) => {
      if (t.t === 'name' && (t.v === 'class' || t.v === 'struct') && toks[i + 1]?.t === 'name' && !this.helpers.has(toks[i + 1].v)) this.userClasses.add(toks[i + 1].v);
    });
  }

  userClasses = new Set<string>();

  /** import x from "m";  import * as x from "m";  import { a, b } from "m"; */
  jsImport() {
    this.p++;
    if (this.cur() === 'str') {
      // import "m"; (side effects only)
      this.p++;
      this.eat(';');
      return;
    }
    let alias = '';
    const names: string[] = [];
    if (this.eat('*')) {
      if (!this.eatName('as')) this.fail('"as" erwartet.');
      alias = this.name();
    } else if (this.is('{')) {
      names.push(...this.jsNameList());
    } else {
      alias = this.name();
      if (this.eat(',')) names.push(...this.jsNameList());
    }
    if (!this.eatName('from') || this.cur() !== 'str') this.fail('"from" erwartet.');
    const module = this.toks[this.p++].v;
    this.eat(';');
    if (alias) this.imports.push({ lang: 'javascript', module, alias });
    if (names.length) this.imports.push({ lang: 'javascript', module, alias: '', names });
  }

  /** { a, b as c } */
  jsNameList(): string[] {
    this.expect('{');
    const names: string[] = [];
    while (!this.is('}')) {
      const n = this.name();
      if (this.eatName('as') || this.eat(':')) names.push(`${n} as ${this.name()}`);
      else names.push(n);
      if (!this.eat(',')) break;
    }
    this.expect('}');
    return names;
  }

  /** const { a, b } = require("m"); */
  jsRequireNames(): boolean {
    const save = this.p;
    this.p++;
    const names = this.jsNameList();
    if (this.eat('=') && this.isName('require') && this.peek().v === '(' && this.peek(2).t === 'str' && this.peek(3).v === ')') {
      const module = this.peek(2).v;
      this.p += 4;
      this.eat(';');
      this.imports.push({ lang: 'javascript', module, alias: '', names });
      return true;
    }
    this.p = save;
    return false;
  }

  /** One argument of a call; C# also has named arguments "lowBound: 0". */
  callArg(): Ex {
    if (this.lang === 'csharp' && this.cur() === 'name' && this.peek().v === ':' && this.peek(2).v !== ':') {
      const name = this.name();
      this.p++;
      return { k: 'kwarg', name, value: this.assignment() };
    }
    return this.assignment();
  }

  /** Type hint, including objects of the user's classes. */
  hintOf(t: string): TypeName | null {
    const ptr = /^(?:std::)?shared_ptr<(\w+)>$/.exec(t.trim());
    if (ptr && this.userClasses.has(ptr[1])) return `obj<${ptr[1]}>`;
    const base = t.replace(/^(const\s+)?/, '').replace(/[&*]$/, '').trim();
    if (this.userClasses.has(base)) return `obj<${base}>`;
    return typeHint(t);
  }

  get tok(): Token {
    return this.toks[this.p];
  }
  cur(): string {
    return this.toks[this.p].t;
  }
  peek(n = 1): Token {
    return this.toks[Math.min(this.p + n, this.toks.length - 1)];
  }
  is(v: string): boolean {
    return this.cur() === 'op' && this.tok.v === v;
  }
  isName(v?: string): boolean {
    return this.cur() === 'name' && (v === undefined || this.tok.v === v);
  }
  eat(v: string): boolean {
    if (this.is(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  eatName(v: string): boolean {
    if (this.isName(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  expect(v: string): Token {
    if (!this.is(v)) throw new ParseError(`"${v}" erwartet, gefunden: "${this.tok.v || 'Dateiende'}".`, this.tok.s);
    return this.toks[this.p++];
  }
  name(): string {
    if (this.cur() !== 'name') throw new ParseError(`Name erwartet, gefunden: "${this.tok.v || 'Dateiende'}".`, this.tok.s);
    return this.toks[this.p++].v;
  }
  srcFrom(startTok: number): string {
    return this.src.slice(this.toks[startTok].s, this.toks[Math.max(startTok, this.p - 1)].e);
  }
  fail(msg: string): never {
    throw new ParseError(msg, this.tok.s);
  }

  /** Comment statements located before position `pos`. */
  commentsBefore(pos: number): Stmt[] {
    const out: Stmt[] = [];
    while (this.ci < this.comments.length && this.comments[this.ci].s < pos) {
      const c = this.comments[this.ci];
      out.push(blankLineBefore(this.src, c.s) ? { k: 'comment', text: c.text, gap: true } : { k: 'comment', text: c.text });
      this.ci++;
    }
    return out;
  }

  // ---- program structure ---------------------------------------------------------

  parseProgram(): void {
    while (this.cur() !== 'eof') this.topItem(this.topLevel);
    this.topLevel.push(...this.commentsBefore(Infinity));
  }

  topItem(out: Stmt[]) {
    const pending = this.commentsBefore(this.tok.s);
    const before = this.functions.length;
    const beforeClasses = this.classes.length;
    const target: Stmt[] = [];
    this.topItemInner(target);
    this.attachComments(pending, before, out, beforeClasses);
    out.push(...target);
  }

  /** Comments directly before a function (or class) become its comment. */
  attachComments(pending: Stmt[], before: number, out: Stmt[], beforeClasses = this.classes.length) {
    const text = pending.map((c) => (c as any).text).join('\n');
    if (this.functions.length > before && pending.length) this.functions[before].comment = text;
    else if (this.classes.length > beforeClasses && pending.length) this.classes[beforeClasses].comment = text;
    else out.push(...pending);
  }

  topItemInner(out: Stmt[]) {
    const t = this.tok;
    if (t.t === 'pp') {
      this.p++;
      const inc = /^#include\s*([<"].*[>"])/.exec(t.v);
      // headers the generator adds by itself when needed
      if (inc && !/^<(iostream|string|vector|cmath|cstdlib|ctime|algorithm|random|thread|chrono|sstream|cctype|cstdio|memory|map|fstream|numeric|stdexcept|bits\/stdc\+\+\.h)>$/.test(inc[1])) {
        this.imports.push({ lang: 'cpp', module: inc[1], alias: inc[1] });
      }
      return;
    }
    if (t.t === 'eof') return;
    const start = this.p;
    try {
      if (this.isName('package') || (this.isName('import') && this.lang === 'java')) {
        const isImport = this.isName('import');
        this.p++;
        let name = '';
        while (!this.is(';') && this.cur() !== 'eof') name += this.toks[this.p++].v;
        this.expect(';');
        if (isImport && !name.startsWith('java.') && !name.startsWith('static')) this.imports.push({ lang: 'java', module: name, alias: name.split('.').pop()! });
        return;
      }
      if (this.lang === 'javascript' && this.isName('import') && this.peek().v !== '(') {
        this.jsImport();
        return;
      }
      if (this.lang === 'javascript' && (this.isName('const') || this.isName('let') || this.isName('var')) && this.peek().v === '{') {
        if (this.jsRequireNames()) return;
      }
      if (this.isName('using')) {
        this.p++;
        let name = '';
        while (!this.is(';') && this.cur() !== 'eof') name += this.toks[this.p++].v + (this.toks[this.p - 1].t === 'name' && this.isName() ? ' ' : '');
        this.expect(';');
        if (this.lang === 'csharp' && !name.startsWith('System') && !name.includes('=')) this.imports.push({ lang: 'csharp', module: name, alias: name });
        return;
      }
      if (this.isName('namespace')) {
        this.p++;
        if (this.helpers.has(this.tok.v)) {
          // helper namespace written by the generator (e.g. turtle)
          while (!this.is('{') && this.cur() !== 'eof') this.p++;
          this.skipBalanced();
          return;
        }
        while (!this.is('{') && !this.is(';')) this.p++;
        if (this.eat(';')) return;
        this.expect('{');
        while (!this.is('}') && this.cur() !== 'eof') this.topItem(out);
        out.push(...this.commentsBefore(this.tok.s));
        this.expect('}');
        return;
      }
      // skip modifiers / annotations / attributes
      const save = this.p;
      this.skipModifiers();
      if (this.isName('class') || this.isName('struct') || this.isName('interface') || this.isName('enum') || this.isName('record')) {
        const isMainClass = (this.lang === 'java' || this.lang === 'csharp') && this.isName('class') && !this.className && this.mainClassAhead();
        if (!isMainClass && (this.isName('class') || this.isName('struct')) && !this.helpers.has(this.peek().v)) {
          this.classDecl();
          return;
        }
        if ((this.lang === 'java' || this.lang === 'csharp') && this.isName('class') && !this.className) {
          this.p++;
          this.className = this.name();
          while (!this.is('{')) this.p++;
          this.expect('{');
          while (!this.is('}') && this.cur() !== 'eof') this.member();
          this.globalInits.push(...this.commentsBefore(this.tok.s));
          this.expect('}');
          this.eat(';');
          return;
        }
        this.fail('Klassen haben noch keinen Block.');
      }
      if (this.lang === 'javascript') {
        this.p = save;
        if (this.isName('function') || (this.isName('async') && this.peek().v === 'function')) {
          this.eatName('async');
          this.functionDecl(null);
          return;
        }
        out.push(...this.topStatement());
        return;
      }
      if (this.lang === 'cpp') {
        if (this.isName('template') && this.peek().v === '<') {
          this.p++;
          let depth = 0;
          do {
            if (this.is('<')) depth++;
            if (this.is('>')) depth--;
            this.p++;
          } while (depth > 0 && this.cur() !== 'eof');
          this.skipModifiers();
        }
        if (this.isName('using') || this.isName('typedef') || this.isName('template')) this.fail('Diese Anweisung hat noch keinen Block.');
        this.memberRest(save, out);
        return;
      }
      // C# top-level statements
      this.p = save;
      out.push(...this.topStatement());
    } catch (err) {
      if (!(err instanceof ParseError)) throw err;
      this.p = start;
      out.push(this.recover(start));
    }
  }

  /** Skips "<K, V>" (type parameters of a generic method). */
  skipTypeParams() {
    if (!this.is('<')) return;
    let depth = 0;
    do {
      if (this.is('<')) depth++;
      else if (this.is('>')) depth--;
      else if (this.is('>>')) depth -= 2;
      this.p++;
    } while (depth > 0 && this.cur() !== 'eof');
  }

  skipModifiers() {
    while (true) {
      if (this.is('<') && (this.lang === 'java' || this.lang === 'csharp')) {
        this.skipTypeParams();
        continue;
      }
      if (this.cur() === 'name' && MODIFIERS.has(this.tok.v) && !(this.lang === 'javascript' && this.tok.v !== 'async' && this.tok.v !== 'export')) {
        this.p++;
        continue;
      }
      if (this.is('@') && this.lang === 'java') {
        this.p++;
        this.name();
        while (this.eat('.')) this.name();
        if (this.is('(')) this.skipBalanced();
        continue;
      }
      if (this.is('[') && this.lang === 'csharp' && this.peek().t === 'name' && this.toks[this.p + 2]?.v !== ']') {
        // attribute like [STAThread]
        this.skipBalanced();
        continue;
      }
      break;
    }
  }

  member() {
    const out: Stmt[] = [];
    const pending = this.commentsBefore(this.tok.s);
    const before = this.functions.length;
    const start = this.p;
    try {
      this.skipModifiers();
      if (this.isName('class') || this.isName('interface') || this.isName('enum') || this.isName('struct') || this.isName('record')) {
        // helper classes written by the generator (e.g. Turtle) are skipped
        if (this.helpers.has(this.peek().v)) {
          while (!this.is('{') && this.cur() !== 'eof') this.p++;
          this.skipBalanced();
          return;
        }
        if (this.isName('class') || this.isName('struct')) {
          const beforeClasses = this.classes.length;
          this.classDecl();
          if (pending.length && this.classes.length > beforeClasses) this.classes[beforeClasses].comment = pending.map((c) => (c as any).text).join('\n');
          else this.globalInits.push(...pending);
          return;
        }
        this.fail('Weitere Klassen haben noch keinen Block.');
      }
      this.memberRest(start, out);
    } catch (err) {
      if (!(err instanceof ParseError)) throw err;
      out.push(this.recover(start));
    }
    const target: Stmt[] = [];
    this.attachComments(pending, before, target);
    this.globalInits.push(...target, ...out);
  }

  /** Field, method or (C++) global declaration after the modifiers. */
  memberRest(start: number, out: Stmt[]) {
    const save = this.p;
    if (this.cur() === 'name' && this.peek().v === '(' && this.toks[save].v === this.className) this.fail('Konstruktoren haben noch keinen Block.');
    const type = this.parseType();
    if (!type) this.fail('Typ erwartet.');
    if (this.is('~')) this.fail('Destruktoren haben noch keinen Block.');
    const name = this.name();
    if (this.is('<') && this.lang === 'csharp') this.skipTypeParams();
    if (this.is('(')) {
      this.functionRest(type, name);
      return;
    }
    // field / global variable
    this.p = save;
    const decl = this.declaration(true);
    if (!decl) this.fail('Deklaration erwartet.');
    this.expect(';');
    void start;
    for (const d of decl) out.push(d);
  }

  functionDecl(_retType: string | null) {
    if (!this.eatName('function')) this.fail('"function" erwartet.');
    if (this.is('*')) this.fail('Generatoren haben noch keinen Block.');
    const name = this.name();
    this.functionRest('', name);
  }

  fnDepth = 0;

  /** Parameters and body of a function, method or constructor (null for a prototype). */
  parseCallable(retType: string, scope: string, isMain = false): { params: string[]; defaults: Ex[]; body: Stmt[]; declared: Set<string> } | null {
    this.expect('(');
    const params: string[] = [];
    const defaults: Ex[] = [];
    const paramTypes: string[] = [];
    while (!this.is(')')) {
      this.skipModifiers();
      this.eatName('final');
      this.eatName('const');
      if (this.lang === 'javascript') {
        if (this.is('...')) this.fail('Rest-Parameter haben noch keinen Block.');
        params.push(this.name());
        paramTypes.push('');
      } else {
        if (this.isName('params') || this.isName('ref') || this.isName('out')) this.fail('ref/out/params haben noch keinen Block.');
        const t = this.parseType();
        if (!t) this.fail('Parametertyp erwartet.');
        // "Object... pairs" (varargs) only appears in helper functions, which are skipped
        const varargs = this.eat('...');
        params.push(this.name());
        paramTypes.push(varargs ? `${t}[]` : t);
      }
      if (this.eat('=')) defaults[params.length - 1] = this.assignment();
      if (!this.eat(',')) break;
    }
    this.expect(')');
    if (this.eatName('throws')) {
      this.name();
      while (this.eat(',')) this.name();
    }
    while (this.isName('const') || this.isName('noexcept') || this.isName('override')) this.p++;
    const isCtor = this.ctorHeadNext;
    this.ctorHeadNext = false;
    const pre: Stmt[] = [];
    if (this.is(':') && (this.lang === 'cpp' || this.lang === 'csharp')) {
      if (!isCtor) this.fail('Initialisierungslisten haben noch keinen Block.');
      this.p++;
      do {
        const target = this.name();
        const close = this.is('{') ? '}' : ')';
        this.p++;
        const args: Ex[] = [];
        while (!this.is(close)) {
          args.push(this.callArg());
          if (!this.eat(',')) break;
        }
        this.expect(close);
        if ((this.lang === 'csharp' && target === 'base') || target === this.classBase) pre.push({ k: 'superinit', args });
        else if (this.lang === 'cpp' && args.length === 1) pre.push({ k: 'fset', obj: { k: 'self' }, name: target, value: args[0] });
        else this.fail(`"${target}(...)" im Kopf des Konstruktors hat noch keinen Block.`);
      } while (this.eat(','));
    }
    if (this.eat(';')) return null; // prototype
    const savedScope = this.scope;
    const savedDeclared = this.declaredInScope;
    this.scope = isMain ? '' : scope;
    this.declaredInScope = new Set(params);
    if (!isMain) {
      paramTypes.forEach((t, i) => {
        const h = this.hintOf(t);
        if (h) this.types[`${scope}:${params[i]}`] = h;
      });
      const rh = this.hintOf(retType);
      if (rh) this.types[`${scope}:return`] = rh;
    }
    this.fnDepth++;
    let body: Stmt[];
    try {
      body = [...pre, ...this.block()];
    } finally {
      this.fnDepth--;
    }
    const declared = this.declaredInScope;
    this.scope = savedScope;
    this.declaredInScope = savedDeclared;
    return { params, defaults, body, declared };
  }

  functionRest(retType: string, name: string) {
    const isMain = (this.lang === 'java' && name === 'main') || (this.lang === 'csharp' && name === 'Main') || (this.lang === 'cpp' && name === 'main');
    const r = this.parseCallable(retType, name, isMain);
    if (!r) return;
    const { params, defaults, body, declared } = r;
    if (this.helpers.has(name)) return;
    if (isMain) {
      if (this.lang === 'cpp') {
        const last = body[body.length - 1];
        if (last?.k === 'return' && last.value?.k === 'num' && last.value.v === 0) body.pop();
      }
      this.mainBody = body;
      return;
    }
    this.locals[name] = [...declared].filter((n) => !params.includes(n));
    const returns = retType !== 'void' && !(this.lang === 'javascript' && !hasValueReturn(body));
    this.functions.push({ name, params, body, returns, ...(defaults.length ? { defaults } : {}) });
  }

  // ---- user-defined classes ----------------------------------------------------------

  inClass = false;
  classes: ClassDef[] = [];
  /** Base class of the class being read (for super / base / Tier::). */
  classBase: string | null = null;
  classFieldNames = new Map<string, string[]>();
  classMethodNames = new Map<string, string[]>();
  /** Reading the head of a constructor (C# ": base(...)", C++ ": Tier(...), x(0)"). */
  ctorHeadNext = false;

  /** Java/C#: is the class starting here the one with the main method? */
  mainClassAhead(): boolean {
    let depth = 0;
    for (let j = this.p; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.t === 'op' && t.v === '{') depth++;
      if (t.t === 'op' && t.v === '}') {
        depth--;
        if (depth === 0) return false;
      }
      if (depth === 1 && t.t === 'name' && (t.v === 'main' || t.v === 'Main') && this.toks[j + 1]?.v === '(') return true;
    }
    return false;
  }

  /** class / struct with properties, constructor and methods. */
  classDecl(): void {
    this.p++; // class / struct
    const name = this.name();
    if (this.is('<')) this.fail('Generische Klassen haben noch keinen Block.');
    // inheritance: "extends Tier" (Java, JavaScript), ": Tier" (C#), ": public Tier" (C++)
    let base: string | undefined;
    if (this.eatName('extends') || this.eat(':')) {
      while (this.isName('public') || this.isName('protected') || this.isName('private') || this.isName('virtual')) this.p++;
      base = this.name();
      if (this.is('.') || this.is('::') || this.is('<')) this.fail('Vererbung von Klassen aus Paketen hat noch keinen Block.');
      if (this.lang === 'csharp' && !this.userClasses.has(base)) this.fail('Schnittstellen und Klassen aus Paketen haben noch keinen Block.');
    }
    if (this.isName('implements') || this.is(',')) this.fail('Schnittstellen und Mehrfachvererbung haben noch keinen Block.');
    this.expect('{');
    const cls: ClassDef = { name, fields: [], ctorParams: [], ctor: [], methods: [], ...(base ? { base } : {}) };
    // properties of base classes can be used without "this." as well
    const fieldNames: string[] = [...(base ? (this.classFieldNames.get(base) ?? []) : [])];
    const savedBase = this.classBase;
    this.classBase = base ?? null;
    const methodLocals = new Map<string, Set<string>>();
    const saved = this.inClass;
    this.inClass = true;
    try {
      while (!this.is('}')) {
        if (this.cur() === 'eof') this.fail('"}" fehlt.');
        const comments = this.commentsBefore(this.tok.s);
        const comment = comments.map((c) => (c as any).text).join('\n');
        if ((this.isName('public') || this.isName('private') || this.isName('protected')) && this.peek().v === ':') {
          this.p += 2;
          continue;
        }
        this.skipModifiers();
        // constructor
        if ((this.tok.v === name || (this.lang === 'javascript' && this.tok.v === 'constructor')) && this.peek().v === '(') {
          this.p++;
          this.ctorHeadNext = true;
          const place = methodPlace(name, CTOR);
          const r = this.parseCallable('void', place);
          if (r && (r.params.length || r.body.length)) {
            cls.ctorParams = r.params;
            cls.ctor = r.body;
            methodLocals.set(place, r.declared);
          }
          continue;
        }
        // JavaScript method "name(...) { }" or property "name = value;"
        if (this.lang === 'javascript' && this.cur() === 'name') {
          const mname = this.name();
          if (this.eat('=')) {
            cls.fields.push({ name: mname, value: this.expr() });
            fieldNames.push(mname);
            this.eat(';');
            continue;
          }
          const place = methodPlace(name, mname);
          const r = this.parseCallable('', place)!;
          cls.methods.push({ name: mname, params: r.params, body: r.body, returns: hasValueReturn(r.body), ...(comment ? { comment } : {}) });
          methodLocals.set(place, r.declared);
          continue;
        }
        const type = this.parseType();
        if (!type) this.fail('Typ erwartet.');
        const member = this.name();
        if (this.is('(')) {
          const place = methodPlace(name, member);
          const r = this.parseCallable(type, place)!;
          cls.methods.push({ name: member, params: r.params, body: r.body, returns: type !== 'void', ...(comment ? { comment } : {}) });
          methodLocals.set(place, r.declared);
          continue;
        }
        // C# auto property: "public string Name { get; set; } = "";"
        if (this.is('{') && (this.peek().v === 'get' || this.peek().v === 'set' || this.peek().v === 'private' || this.peek().v === 'init')) {
          this.skipBalanced();
          const hint = this.hintOf(type);
          if (hint) this.types[`${name}#${member}`] = hint;
          fieldNames.push(member);
          if (this.eat('=')) {
            cls.fields.push({ name: member, value: this.expr() });
            this.expect(';');
          }
          continue;
        }
        // properties: "int x = 0, y;"
        let fname = member;
        while (true) {
          const hint = this.hintOf(type);
          if (hint) this.types[`${name}#${fname}`] = hint;
          fieldNames.push(fname);
          if (this.eat('=')) cls.fields.push({ name: fname, value: this.is('{') ? this.initList() : this.expr() });
          if (!this.eat(',')) break;
          fname = this.name();
        }
        this.expect(';');
      }
      this.expect('}');
      this.eat(';');
    } finally {
      this.inClass = saved;
      this.classBase = savedBase;
    }
    this.classFieldNames.set(name, fieldNames);
    // properties used without "this." inside the methods
    const fix = (stmts: Stmt[], place: string, params: string[]) => {
      const local = methodLocals.get(place) ?? new Set();
      const isField = (n: string) => fieldNames.includes(n) && !params.includes(n) && !local.has(n);
      const self: Expr = { k: 'self' };
      // laut() inside a method means this.laut()
      const isMethod = (n: string) => methodNames.includes(n) && !params.includes(n) && !local.has(n);
      const map = (e: Expr): Expr | undefined => {
        if (e.k === 'var' && isField(e.name)) return { k: 'member', obj: self, name: e.name };
        if (e.k === 'pcall' && e.callee?.k === 'var' && isMethod(e.callee.name)) {
          return { ...e, callee: { k: 'member', obj: self, name: e.callee.name }, args: e.args.map((a) => mapTree(a, map)) };
        }
        return undefined;
      };
      const mapped = mapTree(stmts, map);
      const visit = (list: Stmt[]): Stmt[] =>
        list.map((s0) => {
          let s: any = { ...s0 };
          for (const key of ['body', 'else', 'handler']) if (Array.isArray(s[key])) s[key] = visit(s[key]);
          if (s.branches) s.branches = s.branches.map((b: any) => ({ ...b, body: visit(b.body) }));
          if (s.k === 'set' && isField(s.name)) s = { k: 'fset', obj: self, name: s.name, value: s.value, gap: s.gap, trail: s.trail };
          if (s.k === 'change' && isField(s.name)) s = { k: 'fset', obj: self, name: s.name, value: { k: 'bin', op: 'ADD', a: { k: 'member', obj: self, name: s.name }, b: s.by }, gap: s.gap, trail: s.trail };
          return s;
        });
      return visit(mapped);
    };
    const methodNames = [...cls.methods.map((m) => m.name), ...(base ? (this.classMethodNames.get(base) ?? []) : [])];
    this.classMethodNames.set(name, methodNames);
    cls.ctor = fix(cls.ctor, methodPlace(name, CTOR), cls.ctorParams);
    cls.methods = cls.methods.map((m) => ({ ...m, body: fix(m.body, methodPlace(name, m.name), m.params) }));
    // "this.x = ..." in the constructor of a property without start value is fine as it is
    this.classes.push(cls);
  }

  // ---- types ---------------------------------------------------------------------

  /** Parses a type; returns its text or null (position is restored on failure). */
  parseType(): string | null {
    const save = this.p;
    let text = '';
    if (this.lang === 'javascript') return null;
    while (this.isName('const') || this.isName('unsigned') || this.isName('signed') || this.isName('volatile')) text += this.toks[this.p++].v + ' ';
    if (this.cur() !== 'name') {
      this.p = save;
      return text.trim() || null;
    }
    text += this.toks[this.p++].v;
    while ((this.isName('long') || this.isName('int') || this.isName('short')) && /(long|short|unsigned|signed)$/.test(text)) text += ' ' + this.toks[this.p++].v;
    while ((this.is('.') || this.is('::')) && this.peek().t === 'name') {
      text += this.toks[this.p++].v + this.toks[this.p++].v;
    }
    if (this.is('<')) {
      const args = this.typeArgs();
      if (args === null) {
        this.p = save;
        return null;
      }
      text += `<${args}>`;
    }
    while (this.is('[') && this.peek().v === ']') {
      this.p += 2;
      text += '[]';
    }
    while (this.is('*') || this.is('&') || this.is('&&') || (this.is('?') && this.lang === 'csharp')) text += this.toks[this.p++].v;
    return text.replace(/^std::/, '');
  }

  pendingGt = 0;

  typeArgs(): string | null {
    const save = this.p;
    this.expect('<');
    const parts: string[] = [];
    if (this.is('>')) {
      this.p++;
      return '';
    }
    while (true) {
      if (this.is('?')) {
        this.p++;
        parts.push('?');
      } else {
        const t = this.parseType();
        if (!t) {
          this.p = save;
          return null;
        }
        parts.push(t);
      }
      if (this.pendingGt > 0) {
        this.pendingGt--;
        return parts.join(', ');
      }
      if (this.eat(',')) continue;
      if (this.eat('>')) return parts.join(', ');
      if (this.is('>>')) {
        this.p++;
        this.pendingGt++;
        return parts.join(', ');
      }
      if (this.is('>>>')) {
        this.p++;
        this.pendingGt += 2;
        return parts.join(', ');
      }
      this.p = save;
      return null;
    }
  }

  // ---- statements ------------------------------------------------------------------

  block(): Stmt[] {
    this.expect('{');
    const out: Stmt[] = [];
    while (!this.is('}')) {
      if (this.cur() === 'eof') this.fail('"}" fehlt.');
      out.push(...this.statementSafe());
    }
    out.push(...this.commentsBefore(this.tok.s));
    this.expect('}');
    return out;
  }

  /** Statement or block, as a list. */
  body(): Stmt[] {
    if (this.is('{')) return this.block();
    return this.statementSafe();
  }

  statementSafe(): Stmt[] {
    const comments = this.commentsBefore(this.tok.s);
    const start = this.p;
    const ci = this.ci;
    let out: Stmt[];
    try {
      out = this.statement();
    } catch (err) {
      if (!(err instanceof ParseError)) throw err;
      this.p = start;
      this.ci = ci;
      out = [this.recover(start)];
    }
    out = markGap(out, this.src, this.toks[start].s);
    this.attachTrailing(out);
    return [...comments, ...out];
  }

  /** Statement at the top level (JavaScript, C# top-level statements). */
  topStatement(): Stmt[] {
    const start = this.p;
    const out = markGap(this.statement(), this.src, this.toks[start].s);
    this.attachTrailing(out);
    return out;
  }

  /** A comment at the end of the statement's last line becomes part of the statement. */
  attachTrailing(out: Stmt[]) {
    const c = this.comments[this.ci];
    if (!out.length || !c || this.p === 0) return;
    const lastEnd = this.toks[this.p - 1].e;
    if (c.s < lastEnd || c.s > this.tok.s || this.src.slice(lastEnd, c.s).includes('\n') || c.text.includes('\n')) return;
    out[out.length - 1] = { ...out[out.length - 1], trail: c.text };
    this.ci++;
  }

  /** Skips a statement that cannot be parsed and returns it as raw code. */
  recover(start: number): Stmt {
    let depth = 0;
    while (this.cur() !== 'eof') {
      const t = this.tok;
      if (t.t === 'op' && '([{'.includes(t.v)) depth++;
      if (t.t === 'op' && ')]}'.includes(t.v)) {
        if (depth === 0) break;
        depth--;
        if (depth === 0 && t.v === '}') {
          this.p++;
          const next = this.tok;
          if (next.t === 'name' && ['else', 'catch', 'finally', 'while'].includes(next.v)) continue;
          if (next.t === 'op' && (next.v === ';' || next.v === ')' || next.v === ',' || next.v === '.')) continue;
          break;
        }
      }
      this.p++;
      if (depth === 0 && t.t === 'op' && t.v === ';') break;
    }
    if (this.p === start) this.p++;
    let s = this.toks[start].s;
    while (s > 0 && this.src[s - 1] !== '\n' && /[ \t]/.test(this.src[s - 1])) s--;
    const e = this.toks[this.p - 1].e;
    // drop comments inside the skipped code
    while (this.ci < this.comments.length && this.comments[this.ci].s < e) this.ci++;
    return rawStmt(this.src.slice(s, e), this.lang);
  }

  skipBalanced() {
    const open = this.tok.v;
    const close = { '(': ')', '[': ']', '{': '}' }[open]!;
    let depth = 0;
    do {
      if (this.is(open)) depth++;
      else if (this.is(close)) depth--;
      this.p++;
    } while (depth > 0 && this.cur() !== 'eof');
  }

  statement(): Stmt[] {
    const t = this.tok;
    if (this.is('{')) return this.block();
    if (this.eat(';')) return [];
    if (t.t === 'name') {
      switch (t.v) {
        case 'if':
          return [this.ifStmt()];
        case 'while': {
          this.p++;
          this.expect('(');
          const cond = this.expr();
          this.expect(')');
          const body = this.body();
          if (cond?.k === 'not') return [{ k: 'while', until: true, cond: cond.a, body }];
          return [{ k: 'while', until: false, cond, body }];
        }
        case 'for':
        case 'foreach':
          return [this.forStmt()];
        case 'return': {
          this.p++;
          const value = this.is(';') ? null : this.expr();
          this.expect(';');
          return [{ k: 'return', value }];
        }
        case 'break':
          this.p++;
          this.expect(';');
          return [{ k: 'break' }];
        case 'continue':
          this.p++;
          this.expect(';');
          return [{ k: 'continue' }];
        case 'do':
          return [this.doStmt()];
        case 'switch':
          return this.switchStmt();
        case 'try':
          return [this.tryStmt()];
        case 'throw':
          return [this.throwStmt()];
        case 'goto':
        case 'class':
        case 'yield':
        case 'using':
        case 'lock':
        case 'struct':
          this.fail(`"${t.v}" hat noch keinen Block.`);
          break;
        case 'function':
          if (this.lang === 'javascript') this.fail('Funktionen in Blöcken haben noch keinen Block.');
          break;
        case 'cout':
        case 'cin':
        case 'std':
          if (this.lang === 'cpp') {
            const r = this.streamStmt();
            if (r) return r;
          }
          break;
        case 'getline':
          if (this.lang === 'cpp' && this.peek().v === '(' && this.toks[this.p + 2]?.v === 'cin') {
            this.p += 3;
            this.expect(',');
            const target = this.name();
            this.expect(')');
            this.expect(';');
            return [{ k: 'set', name: target, value: { k: 'ask', prompt: { k: 'str', v: '' }, as: 'text' } }];
          }
          break;
      }
    }
    const decl = this.declaration(false);
    if (decl) {
      this.expect(';');
      return decl;
    }
    const start = this.p;
    const e = this.expr();
    this.expect(';');
    return [this.exprStmt(e!, start)];
  }

  /** Converts an expression statement (assignments, ++, calls). */
  exprStmt(e: Expr, start: number): Stmt {
    // super(name); in a constructor (Java, JavaScript)
    if (e.k === 'pcall' && e.callee?.k === 'super') return { k: 'superinit', args: e.args };
    if (e.k === 'pbin' && ['=', '+=', '-=', '*=', '/=', '%='].includes(e.op)) {
      const target = e.a;
      const value = e.b;
      if (target?.k === 'var') {
        if (e.op === '=') return { k: 'set', name: target.name, value };
        if (e.op === '+=') return { k: 'change', name: target.name, by: value };
        if (e.op === '-=') return { k: 'change', name: target.name, by: negate(value) };
        const op = { '*=': 'MUL', '/=': 'DIV', '%=': 'MOD' }[e.op] as any;
        return { k: 'set', name: target.name, value: { k: 'bin', op, a: target, b: value } };
      }
      if (target?.k === 'index' && e.op === '=') return { k: 'listset', list: target.list, index: target.index, value };
      // this.x = ...  /  konto.x += ...
      if (target?.k === 'member' && target.name !== 'CurrentCulture') {
        const ops: Record<string, any> = { '+=': 'ADD', '-=': 'SUB', '*=': 'MUL', '/=': 'DIV', '%=': 'MOD' };
        if (e.op === '=') return { k: 'fset', obj: target.obj, name: target.name, value };
        return { k: 'fset', obj: target.obj, name: target.name, value: { k: 'bin', op: ops[e.op], a: target, b: value } };
      }
      return rawStmt(this.srcFrom(start) + ';', this.lang);
    }
    if (this.lang === 'cpp' && e.k === 'pcall' && e.callee.k === 'var' && e.callee.name === 'srand') return { k: 'comment', text: '__drop__' };
    if (e.k === 'pbin' && e.op === '=' && e.a?.k === 'member' && e.a.name === 'CurrentCulture') return { k: 'comment', text: '__drop__' };
    if (e.k === 'punary' && (e.op === '++' || e.op === '--') && e.a?.k === 'var') {
      return { k: 'change', name: e.a.name, by: { k: 'num', v: e.op === '++' ? 1 : -1 } };
    }
    if (e.k === 'punary' && (e.op === '++' || e.op === '--') && e.a?.k === 'member') {
      return { k: 'fset', obj: e.a.obj, name: e.a.name, value: { k: 'bin', op: e.op === '++' ? 'ADD' : 'SUB', a: e.a, b: { k: 'num', v: 1 } } };
    }
    return { k: 'pexpr', e };
  }

  /** cout << a << b << endl;  /  cin >> x; */
  streamStmt(): Stmt[] | null {
    const save = this.p;
    if (this.isName('std') && this.peek().v === '::') this.p += 2;
    const which = this.tok.v;
    if (which !== 'cout' && which !== 'cin') {
      this.p = save;
      return null;
    }
    this.p++;
    const op = which === 'cout' ? '<<' : '>>';
    const items: Ex[] = [];
    while (this.eat(op)) items.push(this.additive());
    this.expect(';');
    if (which === 'cin') {
      return items.map((it) => {
        if (it?.k !== 'var') this.fail('cin >> braucht eine Variable.');
        const hint = this.types[`${this.scope}:${it.name}`] ?? this.types[`:${it.name}`];
        const as = hint === 'int' ? 'int' : hint === 'double' ? 'float' : 'text';
        return { k: 'set', name: it.name, value: { k: 'ask', prompt: { k: 'str', v: '' }, as } } as Stmt;
      });
    }
    const isEndl = (x: Ex) => (x?.k === 'var' && x.name === 'endl') || (x?.k === 'member' && x.name === 'endl');
    const out: Stmt[] = [];
    let parts: Ex[] = [];
    const flush = (newline: boolean) => {
      if (!parts.length && !newline) return;
      const value: Ex = parts.length === 0 ? { k: 'str', v: '' } : parts.length === 1 ? parts[0] : { k: 'join', parts };
      out.push({ k: 'print', value, newline });
      parts = [];
    };
    for (const it of items) {
      if (isEndl(it)) flush(true);
      else if (it?.k === 'str' && it.v.endsWith('\n')) {
        if (it.v.length > 1) parts.push({ k: 'str', v: it.v.slice(0, -1) });
        flush(true);
      } else parts.push(it);
    }
    flush(false);
    return out;
  }

  /** Variable declaration (returns null if this is not a declaration). */
  declaration(isField: boolean): Stmt[] | null {
    const save = this.p;
    let type: string | null = null;
    if (this.lang === 'javascript') {
      if (this.isName('let') || this.isName('const') || this.isName('var')) {
        this.p++;
        type = '';
      } else return null;
    } else {
      while (this.isName('final') || this.isName('static') || (this.lang === 'csharp' && this.isName('const'))) this.p++;
      type = this.parseType();
      if (type === null || this.cur() !== 'name' || ['instanceof', 'in', 'is', 'as'].includes(this.tok.v)) {
        this.p = save;
        return null;
      }
      const after = this.peek();
      const cppObject = this.lang === 'cpp' && this.userClasses.has(type) && after.v === '(';
      if (!cppObject && !(after.t === 'op' && ['=', ';', ',', '['].includes(after.v))) {
        this.p = save;
        return null;
      }
    }
    const out: Stmt[] = [];
    do {
      if (this.is('{') || this.is('[')) this.fail('Destrukturierung hat noch keinen Block.');
      const name = this.name();
      if (this.lang === 'javascript' && this.helpers.has(name) && this.is('=')) {
        // helper object written by the generator (e.g. const turtle = { ... })
        this.p++;
        if (this.is('{')) this.skipBalanced();
        else this.expr();
        continue;
      }
      let t = type;
      if (this.is('[') && this.peek().v === ']') {
        this.p += 2;
        t += '[]';
      }
      if (this.is('[')) this.fail('C-Arrays haben noch keinen Block.');
      const scopeKey = isField ? '' : this.scope;
      const hint = this.hintOf(t);
      if (/^(Scanner|Random|BufferedReader|mt19937|random_device|default_random_engine)\b/.test(t.replace(/^(java\.util\.)/, ''))) {
        // input / random helpers are created automatically
        if (this.eat('=')) this.expr();
        continue;
      }
      if (hint) this.types[`${scopeKey}:${name}`] = hint;
      if (!isField) this.declaredInScope.add(name);
      if (this.lang === 'cpp' && this.userClasses.has(t) && !this.is('=')) {
        // Hund h("Bello");  /  Hund h;
        const args: Ex[] = [];
        if (this.eat('(')) {
          while (!this.is(')')) {
            args.push(this.callArg());
            if (!this.eat(',')) break;
          }
          this.expect(')');
        }
        out.push({ k: 'set', name, value: { k: 'pnew', type: t, args } });
        continue;
      }
      if (this.eat('=')) {
        let value: Ex;
        if (this.is('{')) value = this.initList();
        else value = this.expr();
        if (value?.k === 'pcall' && value.callee.k === 'var' && value.callee.name === 'require') {
          const arg = value.args[0];
          if (arg?.k === 'str' && this.fnDepth === 0) this.imports.push({ lang: 'javascript', module: arg.v, alias: name });
          continue;
        }
        if (isField && isDefaultValue(value)) continue;
        out.push({ k: 'set', name, value });
      } else if (hint && hint.startsWith('list<') && (this.lang === 'cpp' || isField)) {
        out.push({ k: 'set', name, value: { k: 'list', items: [] } });
      } else if (isField && hint) {
        // static int x;  -> x starts with the default value
      }
    } while (this.eat(','));
    return out;
  }

  initList(): Expr {
    const start = this.p;
    this.expect('{');
    const items: Ex[] = [];
    while (!this.is('}')) {
      items.push(this.is('{') ? this.initList() : this.expr());
      if (!this.eat(',')) break;
    }
    this.expect('}');
    return { k: 'list', items, src: this.srcFrom(start) };
  }

  doStmt(): Stmt {
    this.p++; // do
    const body = this.body();
    if (!this.eatName('while')) this.fail('"while" nach "do" erwartet.');
    this.expect('(');
    const cond = this.expr();
    this.expect(')');
    this.expect(';');
    if (cond?.k === 'not') return { k: 'while', until: true, cond: cond.a, body, post: true };
    return { k: 'while', until: false, cond, body, post: true };
  }

  tryStmt(): Stmt {
    this.p++; // try
    const body = this.block();
    if (!this.eatName('catch')) this.fail('try ohne catch hat noch keinen Block.');
    let name = '';
    if (this.eat('(')) {
      if (this.lang === 'javascript') name = this.name();
      else {
        this.eatName('const');
        const t = this.parseType();
        if (!t && !this.is('.')) this.fail('Fehlertyp erwartet.');
        if (this.is('...')) this.p++;
        if (this.cur() === 'name') name = this.name();
      }
      this.expect(')');
    }
    let handler = this.block();
    if (this.isName('catch') || this.isName('finally')) this.fail('Mehrere catch- oder finally-Teile haben noch keinen Block.');
    handler = errorVarToMessage(handler, name, this.lang);
    return { k: 'try', body, handler };
  }

  throwStmt(): Stmt {
    this.p++; // throw
    const e = this.expr();
    this.expect(';');
    if (e?.k === 'pnew' && e.args.length <= 1) return { k: 'throw', value: e.args[0] ?? { k: 'str', v: 'Fehler' } };
    if (e?.k === 'pcall' && e.args.length === 1) return { k: 'throw', value: e.args[0] };
    return { k: 'throw', value: e };
  }

  /** switch -> chain of "falls / sonst falls / sonst" */
  switchStmt(): Stmt[] {
    const start = this.p;
    this.p++; // switch
    this.expect('(');
    const subject = this.expr();
    this.expect(')');
    if (!subject || !['var', 'num', 'str', 'member'].includes(subject.k)) this.fail('switch über einen berechneten Wert hat noch keinen Block.');
    this.expect('{');
    const cases: { values: Ex[]; isDefault: boolean; body: Stmt[] }[] = [];
    while (!this.is('}')) {
      if (this.cur() === 'eof') this.fail('"}" fehlt.');
      const c = { values: [] as Ex[], isDefault: false, body: [] as Stmt[] };
      while (this.isName('case') || this.isName('default')) {
        if (this.eatName('default')) c.isDefault = true;
        else {
          this.p++;
          do c.values.push(this.ternary());
          while (this.eat(','));
        }
        if (this.is('->')) this.fail('switch mit "->" hat noch keinen Block.');
        this.expect(':');
      }
      if (!c.values.length && !c.isDefault) this.fail('"case" erwartet.');
      while (!this.isName('case') && !this.isName('default') && !this.is('}')) {
        if (this.cur() === 'eof') this.fail('"}" fehlt.');
        c.body.push(...this.statementSafe());
      }
      cases.push(c);
    }
    this.expect('}');
    void start;
    const branches: { cond: Ex; body: Stmt[] }[] = [];
    let elseBody: Stmt[] | null = null;
    cases.forEach((c, i) => {
      const last = i === cases.length - 1;
      if (!last && !endsCase(c.body)) this.fail('switch mit Durchfallen (fall-through) hat noch keinen Block.');
      let body = c.body;
      if (body[body.length - 1]?.k === 'break') body = body.slice(0, -1);
      if (hasInnerBreak(body)) this.fail('"break" innerhalb eines case hat noch keinen Block.');
      if (c.isDefault) elseBody = body;
      else branches.push({ cond: caseCondition(subject, c.values), body });
    });
    if (!branches.length) return elseBody ?? [];
    return [{ k: 'if', branches, else: elseBody }];
  }

  ifStmt(): Stmt {
    const branches: { cond: Ex; body: Stmt[] }[] = [];
    let elseBody: Stmt[] | null = null;
    this.p++; // if
    this.expect('(');
    const cond = this.expr();
    this.expect(')');
    branches.push({ cond, body: this.body() });
    while (true) {
      const comments = this.commentsBefore(this.tok.s);
      if (this.isName('else')) {
        this.p++;
        if (this.isName('if')) {
          this.p++;
          this.expect('(');
          const c = this.expr();
          this.expect(')');
          branches.push({ cond: c, body: [...comments, ...this.body()] });
          continue;
        }
        elseBody = [...comments, ...this.body()];
      } else if (comments.length) {
        // comments after the if belong to the following code
        this.ci -= comments.length;
      }
      break;
    }
    return { k: 'if', branches, else: elseBody };
  }

  forStmt(): Stmt {
    const kw = this.toks[this.p++].v;
    if (this.lang === 'javascript' && this.isName('await')) this.fail('for await hat noch keinen Block.');
    this.expect('(');
    // for-each
    const save = this.p;
    let declType: string | null = null;
    if (this.lang === 'javascript') {
      if (this.isName('let') || this.isName('const') || this.isName('var')) {
        this.p++;
        declType = '';
      }
    } else {
      this.eatName('final');
      declType = this.parseType();
    }
    if (this.cur() === 'name') {
      const nameTok = this.tok;
      const next = this.peek();
      const isEach = (next.t === 'op' && next.v === ':' && this.lang !== 'javascript') || (next.t === 'name' && (next.v === 'in' || next.v === 'of') && (kw === 'foreach' || this.lang === 'javascript'));
      if (isEach && declType !== null) {
        if (next.v === 'in' && this.lang === 'javascript') this.fail('for...in hat noch keinen Block.');
        this.p += 2;
        const list = this.expr();
        this.expect(')');
        const hint = declType ? this.hintOf(declType) : null;
        if (hint) this.types[`${this.scope}:${nameTok.v}`] = hint;
        this.declaredInScope.add(nameTok.v);
        const body = this.body();
        return { k: 'foreach', var: nameTok.v, list, body };
      }
    }
    this.p = save;
    // classic for (init; cond; update)
    let v: string | null = null;
    let from: Ex = null;
    const initStart = this.p;
    let initStmts: Stmt[] = [];
    if (!this.is(';')) {
      const decl = this.declaration(false);
      if (decl) initStmts = decl;
      else {
        const e = this.expr();
        initStmts = [this.exprStmt(e!, initStart)];
      }
    }
    this.expect(';');
    if (initStmts.length === 1 && initStmts[0].k === 'set') {
      v = initStmts[0].name;
      from = initStmts[0].value;
    }
    const cond = this.is(';') ? null : this.expr();
    this.expect(';');
    const updates: Stmt[] = [];
    while (!this.is(')')) {
      const us = this.p;
      updates.push(this.exprStmt(this.expr()!, us));
      if (!this.eat(',')) break;
    }
    this.expect(')');
    const body = this.body();

    const step = updates.length === 1 && updates[0].k === 'change' && updates[0].name === v ? updates[0].by : null;
    if (v && cond?.k === 'bin' && cond.a?.k === 'var' && cond.a.name === v && step) {
      const positive = step.k !== 'num' || step.v > 0;
      let to: Ex = null;
      if (cond.op === 'LT' && positive) to = foldPlus(cond.b, -1);
      else if (cond.op === 'LTE' && positive) to = cond.b;
      else if (cond.op === 'GT' && !positive) to = foldPlus(cond.b, 1);
      else if (cond.op === 'GTE' && !positive) to = cond.b;
      if (to) {
        const used = usesName(body, v);
        if (!used && from?.k === 'num' && from.v === 0 && cond.op === 'LT' && step.k === 'num' && step.v === 1) {
          return { k: 'repeat', times: cond.b, body };
        }
        return { k: 'for', var: v, from, to, by: step, body };
      }
    }
    // general for loop -> init; while (cond) { body; update }
    let hasContinue = false;
    walkStmts(body, (s) => {
      if (s.k === 'continue') hasContinue = true;
    });
    if (hasContinue) this.fail('Diese for-Schleife hat noch keinen Block.');
    const loop: Stmt = { k: 'while', until: false, cond: cond ?? { k: 'bool', v: true }, body: [...body, ...updates] };
    if (initStmts.length) {
      // wrap into an if(true) is not nice; return init statements before the loop
      return { k: 'if', branches: [{ cond: { k: 'bool', v: true }, body: [...initStmts, loop] }], else: null, src: '__inline__' };
    }
    return loop;
  }

  // ---- expressions ---------------------------------------------------------------------

  mk(e: Expr, start: number): Expr {
    if (e.k !== 'num' && e.k !== 'str' && e.k !== 'var' && e.k !== 'bool') e.src = this.srcFrom(start);
    return e;
  }

  expr(): Ex {
    return this.assignment();
  }

  assignment(): Ex {
    const start = this.p;
    if (this.isLambda()) return this.lambda(start);
    const a = this.ternary();
    const op = ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=', '??='].find((o) => this.is(o));
    if (op) {
      this.p++;
      const b = this.assignment();
      return this.mk({ k: 'pbin', op, a, b }, start);
    }
    return a;
  }

  isLambda(): boolean {
    const arrow = this.lang === 'java' ? '->' : '=>';
    if (this.lang === 'cpp') return this.is('[') && this.lang === 'cpp' && false;
    if (this.cur() === 'name' && this.peek().v === arrow) return true;
    if (this.isName('async') && this.lang === 'javascript') return true;
    if (this.isName('function') && this.lang === 'javascript') return true;
    if (this.is('(')) {
      let depth = 0;
      let j = this.p;
      do {
        const t = this.toks[j];
        if (t.t === 'op' && t.v === '(') depth++;
        if (t.t === 'op' && t.v === ')') depth--;
        j++;
      } while (depth > 0 && j < this.toks.length);
      return this.toks[j]?.t === 'op' && this.toks[j].v === arrow;
    }
    return false;
  }

  lambda(start: number): Expr {
    // skip parameters
    const arrow = this.lang === 'java' ? '->' : '=>';
    while (!this.is(arrow) && !this.is('{') && this.cur() !== 'eof') {
      if (this.is('(')) this.skipBalanced();
      else this.p++;
    }
    this.eat(arrow);
    if (this.is('{')) this.skipBalanced();
    else this.assignment();
    return { k: 'plambda', src: this.srcFrom(start) };
  }

  ternary(): Ex {
    const start = this.p;
    const cond = this.nullish();
    if (this.is('?')) {
      this.p++;
      const a = this.assignment();
      this.expect(':');
      const b = this.assignment();
      return this.mk({ k: 'cond', cond, a, b }, start);
    }
    return cond;
  }

  nullish(): Ex {
    const start = this.p;
    let a = this.or();
    while (this.is('??')) {
      this.p++;
      a = this.mk({ k: 'pbin', op: '??', a, b: this.or() }, start);
    }
    return a;
  }

  binLevel(next: () => Ex, ops: Record<string, string | null>): Ex {
    const start = this.p;
    let a = next();
    while (true) {
      const op = Object.keys(ops).find((o) => (this.cur() === 'op' || this.cur() === 'name') && this.tok.v === o);
      if (!op) break;
      this.p++;
      const b = next();
      const irOp = ops[op];
      a = this.mk(irOp ? ({ k: 'bin', op: irOp, a, b } as Expr) : { k: 'pbin', op, a, b }, start);
    }
    return a;
  }

  or = (): Ex => this.binLevel(this.and, { '||': 'OR' });
  and = (): Ex => this.binLevel(this.bitOr, { '&&': 'AND' });
  bitOr = (): Ex => this.binLevel(this.bitXor, { '|': null });
  bitXor = (): Ex => this.binLevel(this.bitAnd, { '^': null });
  bitAnd = (): Ex => this.binLevel(this.equality, { '&': null });
  equality = (): Ex => this.binLevel(this.relational, { '===': 'EQ', '!==': 'NEQ', '==': 'EQ', '!=': 'NEQ' });
  relational = (): Ex =>
    this.binLevel(this.shift, { '<=': 'LTE', '>=': 'GTE', '<': 'LT', '>': 'GT', ...(this.lang === 'cpp' ? {} : { instanceof: null, is: null, as: null }) });
  shift = (): Ex => this.binLevel(this.additive, { '<<': null, '>>>': null, '>>': null });
  additive = (): Ex => this.binLevel(this.multiplicative, { '+': 'ADD', '-': 'SUB' });
  multiplicative = (): Ex => this.binLevel(this.exponent, { '*': 'MUL', '/': 'DIV', '%': 'MOD' });

  exponent = (): Ex => {
    const start = this.p;
    const base = this.unary();
    if (this.lang === 'javascript' && this.is('*') && this.peek().v === '*' && this.peek().s === this.tok.e) {
      // "**" is lexed as two "*"
      this.p += 2;
      const exp = this.exponent();
      if (base?.k === 'num' && base.v === 10) return this.mk({ k: 'math', fn: 'pow10', a: exp }, start);
      return this.mk({ k: 'bin', op: 'POW', a: base, b: exp }, start);
    }
    return base;
  };

  unary(): Ex {
    const start = this.p;
    if (this.is('!')) {
      this.p++;
      return this.mk({ k: 'not', a: this.unary() }, start);
    }
    if (this.is('-')) {
      this.p++;
      const a = this.unary();
      if (a?.k === 'num') return { ...a, v: -a.v };
      return this.mk({ k: 'math', fn: 'neg', a }, start);
    }
    if (this.is('+')) {
      this.p++;
      return this.unary();
    }
    if (this.is('++') || this.is('--') || this.is('~') || this.is('*') || this.is('&')) {
      const op = this.toks[this.p++].v;
      return this.mk({ k: 'punary', op, a: this.unary() }, start);
    }
    if (this.isName('typeof') || this.isName('await') || this.isName('delete') || this.isName('sizeof') || this.isName('void')) {
      const op = this.toks[this.p++].v;
      return this.mk({ k: 'punary', op, a: this.unary() }, start);
    }
    // cast
    if (this.is('(') && this.lang !== 'javascript') {
      const save = this.p;
      this.p++;
      const t = this.parseType();
      if (t && this.is(')') && (PRIMITIVES.has(t.replace(/[*&]$/, '')) || /^[A-Z]\w*$/.test(t))) {
        this.p++;
        const next = this.tok;
        const castable = next.t === 'name' || next.t === 'num' || next.t === 'str' || (next.t === 'op' && (next.v === '(' || next.v === '!' || next.v === '-'));
        if (castable && (PRIMITIVES.has(t) || next.t === 'name' || next.v === '(')) {
          return this.mk({ k: 'pcast', type: t, a: this.unary() }, start);
        }
      }
      this.p = save;
    }
    if (this.lang === 'cpp' && /^(static_cast|dynamic_cast|reinterpret_cast|const_cast)$/.test(this.tok.v)) {
      this.p++;
      this.expect('<');
      const t = this.parseType() ?? '';
      if (this.pendingGt > 0) this.pendingGt--;
      else this.expect('>');
      this.expect('(');
      const a = this.expr();
      this.expect(')');
      return this.mk({ k: 'pcast', type: t, a }, start);
    }
    return this.postfix();
  }

  postfix(): Ex {
    const start = this.p;
    let e = this.primary();
    // C++: Tier::laut() inside a subclass of Tier is the base class's version
    if (this.lang === 'cpp' && this.inClass && e?.k === 'var' && e.name === this.classBase && this.is('::')) e = { k: 'super' };
    while (true) {
      if (this.is('.') || this.is('::') || this.is('->')) {
        this.p++;
        const n = this.name();
        e = this.mk({ k: 'member', obj: e, name: n }, start);
      } else if (this.is('?.')) {
        this.fail('?. hat noch keinen Block.');
      } else if (this.is('(')) {
        this.p++;
        const args: Ex[] = [];
        while (!this.is(')')) {
          if (this.is('...')) this.fail('Spread hat noch keinen Block.');
          args.push(this.callArg());
          if (!this.eat(',')) break;
        }
        this.expect(')');
        e = this.mk({ k: 'pcall', callee: e!, args }, start);
      } else if (this.is('[')) {
        this.p++;
        const index = this.expr();
        this.expect(']');
        e = this.mk({ k: 'index', list: e, index }, start);
      } else if (this.is('++') || this.is('--')) {
        const op = this.toks[this.p++].v;
        e = this.mk({ k: 'punary', op, a: e, postfix: true }, start);
      } else break;
    }
    return e;
  }

  primary(): Ex {
    const t = this.tok;
    const start = this.p;
    if (t.t === 'num') {
      this.p++;
      const isFloat = /[.eE]/.test(t.v) && !/^0x/i.test(t.v);
      const v = /^0[xb]/i.test(t.v) ? Number(t.v) : parseFloat(t.v);
      const suffix: string = t.x?.suffix ?? '';
      return isFloat || /[fFdDmM]/.test(suffix) ? { k: 'num', v, float: true } : { k: 'num', v };
    }
    if (t.t === 'str') {
      this.p++;
      let s: Expr = { k: 'str', v: t.v };
      // C/C++ adjacent string literals
      while (this.cur() === 'str' && this.lang === 'cpp') s = { k: 'str', v: (s as any).v + this.toks[this.p++].v };
      return s;
    }
    if (t.t === 'tpl') {
      this.p++;
      const parts: Ex[] = (t.x as { text?: string; expr?: string }[]).map((part) =>
        part.text !== undefined ? { k: 'str', v: unescape(part.text) } : this.subExpr(part.expr!),
      );
      return this.mk({ k: 'join', parts }, start);
    }
    if (t.t === 'name') {
      switch (t.v) {
        case 'true':
        case 'false':
          this.p++;
          return { k: 'bool', v: t.v === 'true' };
        case 'std':
        case 'make_shared':
        case 'shared_ptr': {
          if (this.lang !== 'cpp') break;
          const save = this.p;
          if (t.v === 'std') {
            if (this.peek().v !== '::') break;
            this.p += 2;
          }
          const fn = this.tok.v;
          if ((fn === 'make_shared' || fn === 'shared_ptr') && this.peek().v === '<') {
            this.p++;
            const type = this.typeArgs();
            if (type !== null && this.is('(')) {
              this.p++;
              // shared_ptr<Hund>(this, [](Hund*) {}): "dieses Objekt"
              if (fn === 'shared_ptr' && this.isName('this') && this.inClass) {
                let depth = 1;
                while (depth > 0 && this.cur() !== 'eof') {
                  if (this.is('(')) depth++;
                  if (this.is(')')) depth--;
                  this.p++;
                }
                return { k: 'self' };
              }
              const args: Ex[] = [];
              while (!this.is(')')) {
                args.push(this.callArg());
                if (!this.eat(',')) break;
              }
              this.expect(')');
              return this.mk({ k: 'pnew', type, args }, start);
            }
          }
          this.p = save;
          break;
        }
        case 'this':
          if (this.inClass) {
            this.p++;
            return { k: 'self' };
          }
          this.fail('"this" außerhalb einer Klasse hat noch keinen Block.');
          break;
        case 'super':
        case 'base':
          if (this.inClass && this.classBase && (t.v === 'super') === (this.lang !== 'csharp')) {
            this.p++;
            return { k: 'super' };
          }
          this.fail(`"${t.v}" hat noch keinen Block.`);
          break;
        case 'null':
        case 'nullptr':
        case 'undefined':
          this.fail(`"${t.v}" hat noch keinen Block.`);
          break;
        case 'new': {
          this.p++;
          let type = this.parseType();
          if (!type && this.lang === 'javascript' && this.cur() === 'name') {
            type = this.name();
            while (this.is('.') && this.peek().t === 'name') type += this.toks[this.p++].v + this.name();
          }
          if (!type) this.fail('Typ nach "new" erwartet.');
          let args: Ex[] = [];
          let init: Ex[] | undefined;
          if (this.is('(')) {
            this.p++;
            while (!this.is(')')) {
              args.push(this.callArg());
              if (!this.eat(',')) break;
            }
            this.expect(')');
          }
          if (this.is('[')) {
            this.skipBalanced();
          }
          if (this.is('{')) {
            const list = this.initList();
            init = (list as any).items;
          }
          return this.mk({ k: 'pnew', type, args, init }, start);
        }
      }
      // C++ vector<int>{...} / List.of(...) generic constructions
      if (GENERIC_TYPES.has(t.v) && this.peek().v === '<') {
        const save = this.p;
        const type = this.parseType();
        if (type && (this.is('{') || this.is('('))) {
          if (this.is('{')) {
            const list = this.initList();
            return this.mk({ k: 'pnew', type, args: [], init: (list as any).items }, start);
          }
          this.p++;
          const args: Ex[] = [];
          while (!this.is(')')) {
            args.push(this.callArg());
            if (!this.eat(',')) break;
          }
          this.expect(')');
          return this.mk({ k: 'pnew', type, args }, start);
        }
        this.p = save;
      }
      this.p++;
      // List.of / Arrays.asList
      return { k: 'var', name: t.v };
    }
    if (this.is('(')) {
      this.p++;
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (this.is('[') && this.lang === 'javascript') {
      this.p++;
      const items: Ex[] = [];
      while (!this.is(']')) {
        if (this.is('...')) this.fail('Spread hat noch keinen Block.');
        items.push(this.assignment());
        if (!this.eat(',')) break;
      }
      this.expect(']');
      return this.mk({ k: 'list', items }, start);
    }
    if (this.is('{') && this.lang === 'cpp') return this.initList();
    if (this.is('{') && this.lang === 'javascript') this.fail('Objekte haben noch keinen Block.');
    this.fail(`Unerwartetes "${t.v || 'Dateiende'}".`);
  }

  subExpr(code: string): Ex {
    const { toks } = tokenizeCLike(code, this.lang);
    const p = new CParser(code, this.lang, toks, []);
    p.inClass = this.inClass;
    const e = p.expr();
    if (p.tok.t !== 'eof') throw new ParseError('Ausdruck im Text konnte nicht gelesen werden.', this.tok.s);
    return e;
  }
}

function isDefaultValue(e: Ex): boolean {
  if (!e) return true;
  if (e.k === 'num') return e.v === 0;
  if (e.k === 'str') return e.v === '';
  if (e.k === 'bool') return !e.v;
  if (e.k === 'list') return e.items.length === 0;
  if (e.k === 'pnew') return !e.args.length && !e.init?.length && /^(ArrayList|List|vector)/.test(e.type);
  return false;
}

function usesName(body: Stmt[], name: string): boolean {
  let used = false;
  walkAllExprs(body, (e) => {
    if (e.k === 'var' && e.name === name) used = true;
  });
  return used || assignedNames(body).has(name);
}

function hasValueReturn(body: Stmt[]): boolean {
  let found = false;
  walkStmts(body, (s) => {
    if (s.k === 'return' && s.value) found = true;
  });
  return found;
}

/** Inline "if (true) { ... }" wrappers produced by for-loop conversion. */
function inlineWrappers(stmts: Stmt[]): Stmt[] {
  const out: Stmt[] = [];
  for (const s of stmts) {
    if (s.k === 'comment' && s.text === '__drop__') continue;
    if (s.k === 'if' && s.src === '__inline__') {
      out.push(...inlineWrappers(s.branches[0].body));
      continue;
    }
    if (s.k === 'if') out.push({ ...s, branches: s.branches.map((b) => ({ ...b, body: inlineWrappers(b.body) })), else: s.else ? inlineWrappers(s.else) : null });
    else if (s.k === 'repeat' || s.k === 'while' || s.k === 'for' || s.k === 'foreach') out.push({ ...s, body: inlineWrappers(s.body) } as Stmt);
    else out.push(s);
  }
  return out;
}

export function parseCLikeExpr(code: string, lang: Lang): Expr {
  const { toks } = tokenizeCLike(code, lang as CLang);
  const p = new CParser(code, lang as CLang, toks, []);
  const e = p.expr();
  if (!e || p.tok.t !== 'eof') throw new ParseError('Ausdruck erwartet.', 0);
  return e;
}

export function parseCLike(src: string, lang: CLang): ParseResult {
  let lexed: { toks: Token[]; comments: Comment[] };
  try {
    lexed = tokenizeCLike(src, lang);
  } catch (err) {
    if (err instanceof ParseError) {
      return { program: { main: [rawStmt(src, lang)], functions: [] }, diagnostics: [{ message: err.message, line: lineOf(src, err.pos) }] };
    }
    throw err;
  }
  const p = new CParser(src, lang, lexed.toks, lexed.comments);
  p.parseProgram();
  let main: Stmt[];
  if (lang === 'javascript' || lang === 'csharp') main = [...p.globalInits, ...p.topLevel, ...(p.mainBody ?? [])];
  else main = [...p.topLevel, ...p.globalInits, ...(p.mainBody ?? [])];
  const program: Program = {
    main: inlineWrappers(main),
    functions: p.functions.map((f) => ({ ...f, body: inlineWrappers(f.body) })),
    ...(p.classes.length
      ? { classes: p.classes.map((c) => ({ ...c, ctor: inlineWrappers(c.ctor), methods: c.methods.map((m) => ({ ...m, body: inlineWrappers(m.body) })) })) }
      : {}),
    meta: { types: p.types, locals: p.locals, imports: p.imports, className: p.className },
  };
  return normalize(program, lang);
}
