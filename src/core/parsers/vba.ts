// VBA source -> IR

import type { Ex, Expr, FunctionDef, Program, Stmt, TypeName } from '../ir';
import { walkStmts } from '../ir';
import { helperNames } from '../library';
import { ParseError, type ParseResult, type Token, lineOf, negate, rawStmt } from './common';
import { normalize } from './normalize';

const OPS = ['<>', '<=', '>=', ':=', '=', '<', '>', '+', '-', '*', '/', '\\', '^', '&', '(', ')', ',', '.', ':', ';', '#', '!'];

export function tokenizeVba(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let lineStart = true;
  const push = (t: string, v: string, s: number, e: number, x?: any) => toks.push({ t, v, s, e, x });
  while (i < src.length) {
    const c = src[i];
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      if (toks.length && toks[toks.length - 1].t !== 'nl') push('nl', '', i, i);
      lineStart = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t') {
      // line continuation " _"
      if (src[i + 1] === '_' && /^_[ \t]*\r?\n/.test(src.slice(i + 1))) {
        i = src.indexOf('\n', i + 1) + 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === "'" || (lineStart && /^rem(\s|$)/i.test(src.slice(i, i + 4)))) {
      let e = i;
      while (e < src.length && src[e] !== '\n') e++;
      const text = src.slice(i + (c === "'" ? 1 : 3), e).replace(/\r$/, '').replace(/^ /, '');
      push('comment', text, i, e);
      i = e;
      continue;
    }
    if (c === '"') {
      const s = i;
      let j = i + 1;
      let body = '';
      while (true) {
        if (j >= src.length || src[j] === '\n') throw new ParseError('Ein Text (String) wird nicht geschlossen.', s);
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            body += '"';
            j += 2;
            continue;
          }
          break;
        }
        body += src[j++];
      }
      i = j + 1;
      push('str', body, s, i);
      lineStart = false;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(&H[0-9A-Fa-f]+|[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)[#!@&%]?/.exec(src.slice(i))!;
      push('num', m[1], i, i + m[0].length);
      i += m[0].length;
      lineStart = false;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\p{L}\p{N}_]/u.test(src[j])) j++;
      let suffix = '';
      if ('$%&!#@'.includes(src[j] ?? '') && !/[\p{L}\p{N}_(]/u.test(src[j + 1] ?? '') && src[j + 1] !== '"') suffix = src[j++];
      const v = src.slice(i, suffix ? j - 1 : j);
      // label at line start: "Name:"
      if (lineStart && src[j] === ':' && src[j + 1] !== '=') {
        push('label', v, i, j + 1);
        i = j + 1;
        lineStart = false;
        continue;
      }
      push('name', v, i, j, suffix ? { suffix } : undefined);
      i = j;
      lineStart = false;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ParseError(`Unbekanntes Zeichen "${c}".`, i);
    if (op === ':') {
      // statement separator
      push('nl', ':', i, i + 1);
      i++;
      continue;
    }
    push('op', op, i, i + op.length);
    i += op.length;
    lineStart = false;
  }
  push('nl', '', src.length, src.length);
  push('eof', '', src.length, src.length);
  return toks;
}

export function vbaTypeHint(type: string | null, suffix?: string): TypeName | null {
  const t = (type ?? '').toLowerCase();
  if (['long', 'integer', 'byte', 'longlong'].includes(t) || suffix === '%' || suffix === '&') return 'int';
  if (['double', 'single', 'currency', 'decimal'].includes(t) || suffix === '#' || suffix === '!' || suffix === '@') return 'double';
  if (t === 'string' || suffix === '$') return 'string';
  if (t === 'boolean') return 'bool';
  return null;
}

interface LoopCtx {
  gotos: Stmt[];
}

class VbaParser {
  p = 0;
  types: Record<string, TypeName> = {};
  locals: Record<string, string[]> = {};
  scope = '';
  fnName: string | null = null;
  functions: FunctionDef[] = [];
  main: Stmt[] | null = null;
  mainName?: string;
  globalStmts: Stmt[] = [];
  /** Variables per procedure ('' = module level) used to tell arrays from calls. */
  vars = new Map<string, Set<string>>();
  procs: { name: string; params: string[]; body: Stmt[]; isFunction: boolean; declared: Set<string>; comment?: string }[] = [];
  pendingComments: string[] = [];
  loops: LoopCtx[] = [];
  helpers = helperNames('vba');

  constructor(
    public src: string,
    public toks: Token[],
  ) {}

  get tok(): Token {
    return this.toks[this.p];
  }
  cur(): string {
    return this.toks[this.p].t;
  }
  peek(n = 1): Token {
    return this.toks[Math.min(this.p + n, this.toks.length - 1)];
  }
  kw(v: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.t === 'name' && t.v.toLowerCase() === v;
  }
  eatKw(v: string): boolean {
    if (this.kw(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  expectKw(v: string) {
    if (!this.eatKw(v)) this.fail(`"${v}" erwartet.`);
  }
  is(v: string): boolean {
    return this.cur() === 'op' && this.tok.v === v;
  }
  eat(v: string): boolean {
    if (this.is(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  expect(v: string) {
    if (!this.eat(v)) this.fail(`"${v}" erwartet, gefunden: "${this.tok.v}".`);
  }
  name(): string {
    if (this.cur() !== 'name') this.fail(`Name erwartet, gefunden: "${this.tok.v}".`);
    return this.toks[this.p++].v;
  }
  fail(msg: string): never {
    throw new ParseError(msg, this.tok.s);
  }
  endOfLine(): boolean {
    return this.cur() === 'nl' || this.cur() === 'eof' || this.cur() === 'comment';
  }
  skipNl() {
    while (this.cur() === 'nl') this.p++;
  }
  lineEnd() {
    if (this.cur() === 'comment') return;
    if (this.cur() !== 'nl' && this.cur() !== 'eof') this.fail(`Unerwartetes "${this.tok.v}".`);
    this.p++;
  }
  srcFrom(start: number): string {
    return this.src.slice(this.toks[start].s, this.toks[Math.max(start, this.p - 1)].e);
  }
  addVar(name: string) {
    const key = this.scope;
    if (!this.vars.has(key)) this.vars.set(key, new Set());
    this.vars.get(key)!.add(name.toLowerCase());
  }

  // ---- module ----------------------------------------------------------------------

  parseModule() {
    while (this.cur() !== 'eof') {
      if (this.cur() === 'nl') {
        this.p++;
        continue;
      }
      if (this.cur() === 'comment') {
        this.pendingComments.push(this.tok.v);
        this.p++;
        continue;
      }
      const start = this.p;
      const before = this.procs.length;
      try {
        this.topLevel();
        if (this.procs.length > before && this.pendingComments.length) this.procs[before].comment = this.pendingComments.join('\n');
        else for (const text of this.pendingComments) this.globalStmts.push({ k: 'comment', text });
        this.pendingComments = [];
      } catch (err) {
        if (!(err instanceof ParseError)) throw err;
        this.p = start;
        this.globalStmts.push(this.recoverLine(start));
      }
    }
  }

  recoverLine(start: number): Stmt {
    while (this.cur() !== 'nl' && this.cur() !== 'eof') this.p++;
    const text = this.src.slice(this.toks[start].s, this.toks[Math.max(start, this.p - 1)].e);
    this.p++;
    return rawStmt(text, 'vba');
  }

  topLevel() {
    if (this.kw('option') || this.kw('attribute') || this.kw('declare') || this.kw('deftype')) {
      while (!this.endOfLine()) this.p++;
      this.lineEnd();
      return;
    }
    while (this.kw('public') || this.kw('private') || this.kw('friend') || this.kw('static') || this.kw('global')) this.p++;
    if (this.kw('sub') || this.kw('function')) {
      this.procedure();
      return;
    }
    if (this.kw('dim') || this.kw('const') || this.cur() === 'name') {
      const isConst = this.kw('const');
      if (this.kw('dim') || isConst) this.p++;
      this.declList(this.globalStmts, isConst || true);
      this.lineEnd();
      return;
    }
    this.fail('Diese Zeile hat noch keinen Block.');
  }

  declList(out: Stmt[], allowInit: boolean) {
    do {
      const nameTok = this.tok;
      const name = this.name();
      if (this.is('(')) {
        // dynamic array "Dim a()" or fixed "Dim a(10)"
        this.p++;
        if (!this.is(')')) this.fail('Arrays mit fester Größe haben noch keinen Block.');
        this.p++;
        out.push({ k: 'set', name, value: { k: 'list', items: [] } });
      }
      let type: string | null = null;
      if (this.eatKw('as')) {
        if (this.eatKw('new')) this.fail('Objekte haben noch keinen Block.');
        type = this.name();
        while (this.eat('.')) type += '.' + this.name();
      }
      const hint = vbaTypeHint(type, nameTok.x?.suffix);
      if (hint) this.types[`${this.scope}:${name}`] = hint;
      this.addVar(name);
      if (allowInit && this.eat('=')) out.push({ k: 'set', name, value: this.expr() });
    } while (this.eat(','));
  }

  procedure() {
    const isFunction = this.kw('function');
    this.p++;
    const name = this.name();
    const params: string[] = [];
    this.scope = name;
    if (this.eat('(')) {
      while (!this.is(')')) {
        if (this.kw('optional') || this.kw('paramarray')) this.fail('Optionale Parameter haben noch keinen Block.');
        this.eatKw('byval');
        this.eatKw('byref');
        const pTok = this.tok;
        const pn = this.name();
        if (this.eat('(')) this.expect(')');
        let type: string | null = null;
        if (this.eatKw('as')) type = this.name();
        const hint = vbaTypeHint(type, pTok.x?.suffix);
        if (hint) this.types[`${name}:${pn}`] = hint;
        params.push(pn);
        this.addVar(pn);
        if (!this.eat(',')) break;
      }
      this.expect(')');
    }
    if (isFunction && this.eatKw('as')) {
      const rt = this.name();
      const hint = vbaTypeHint(rt);
      if (hint) this.types[`${name}:return`] = hint;
    }
    this.lineEnd();
    const savedFn = this.fnName;
    this.fnName = isFunction ? name : null;
    const body = this.statements(() => this.kw('end') && (this.kw('sub', 1) || this.kw('function', 1)));
    this.expectKw('end');
    this.p++;
    this.lineEnd();
    this.fnName = savedFn;
    const declared = this.vars.get(name) ?? new Set();
    this.scope = '';
    if (this.helpers.has(name) || [...this.helpers].some((h) => h.toLowerCase() === name.toLowerCase())) return;
    this.procs.push({ name, params, body, isFunction, declared });
  }

  // ---- statements -------------------------------------------------------------------

  statements(stop: () => boolean): Stmt[] {
    const out: Stmt[] = [];
    while (true) {
      this.skipNl();
      if (this.cur() === 'eof') this.fail('"End" fehlt.');
      if (stop()) break;
      const start = this.p;
      try {
        out.push(...this.statement());
      } catch (err) {
        if (!(err instanceof ParseError)) throw err;
        this.p = start;
        out.push(this.recoverStatement(start));
      }
    }
    return mergeListAdds(out);
  }

  /** Skips a line, or a whole block statement (If ... End If etc.), that cannot be parsed. */
  recoverStatement(start: number): Stmt {
    const opens: Record<string, string> = { if: 'if', for: 'next', do: 'loop', while: 'wend', select: 'select', with: 'with' };
    const first = this.tok.v.toLowerCase();
    const blockKw = first in opens && !(first === 'if' && this.isSingleLineIf());
    if (!blockKw) {
      while (this.cur() !== 'nl' && this.cur() !== 'eof') this.p++;
    } else {
      let depth = 0;
      while (this.cur() !== 'eof') {
        const atLineStart = this.p === start || this.toks[this.p - 1].t === 'nl';
        const v = this.cur() === 'name' ? this.tok.v.toLowerCase() : '';
        if (atLineStart && v in opens && !(v === 'if' && this.isSingleLineIf())) depth++;
        if (atLineStart && (v === 'next' || v === 'loop' || v === 'wend' || (v === 'end' && ['if', 'select', 'with'].includes(this.peek().v.toLowerCase())))) {
          depth--;
          if (depth === 0) {
            while (this.cur() !== 'nl' && this.cur() !== 'eof') this.p++;
            break;
          }
        }
        this.p++;
      }
    }
    let s = this.toks[start].s;
    while (s > 0 && /[ \t]/.test(this.src[s - 1])) s--;
    return rawStmt(this.src.slice(s, this.toks[Math.max(start, this.p - 1)].e), 'vba');
  }

  isSingleLineIf(): boolean {
    let j = this.p;
    while (this.toks[j].t !== 'nl' && this.toks[j].t !== 'eof') {
      if (this.toks[j].t === 'name' && this.toks[j].v.toLowerCase() === 'then') {
        const next = this.toks[j + 1];
        return next.t !== 'nl' && next.t !== 'comment' && next.t !== 'eof';
      }
      j++;
    }
    return false;
  }

  statement(): Stmt[] {
    const t = this.tok;
    if (t.t === 'comment') {
      this.p++;
      return [{ k: 'comment', text: t.v }];
    }
    if (t.t === 'label') {
      this.p++;
      return [{ k: 'raw', code: `${t.v}:`, lang: 'vba', src: `__label__${t.v.toLowerCase()}` }];
    }
    if (t.t !== 'name') this.fail(`Unerwartetes "${t.v}".`);
    const kw = t.v.toLowerCase();
    switch (kw) {
      case 'dim':
      case 'static': {
        this.p++;
        const out: Stmt[] = [];
        this.declList(out, false);
        this.lineEnd();
        return out;
      }
      case 'const': {
        this.p++;
        const out: Stmt[] = [];
        this.declList(out, true);
        this.lineEnd();
        return out;
      }
      case 'if':
        return [this.ifStmt()];
      case 'for':
        return [this.forStmt()];
      case 'do':
        return [this.doStmt()];
      case 'while': {
        this.p++;
        const cond = this.expr();
        this.lineEnd();
        const body = this.loopBody(() => this.kw('wend'));
        this.p++;
        this.lineEnd();
        return [{ k: 'while', until: false, cond, body }];
      }
      case 'exit': {
        this.p++;
        const what = this.name().toLowerCase();
        this.lineEnd();
        if (what === 'for' || what === 'do') return [{ k: 'break' }];
        if (what === 'sub' || what === 'function') return [{ k: 'return', value: null }];
        this.fail('Exit hat hier noch keinen Block.');
        break;
      }
      case 'goto': {
        this.p++;
        const label = this.name();
        this.lineEnd();
        const s: Stmt = { k: 'raw', code: `GoTo ${label}`, lang: 'vba', src: `__goto__${label.toLowerCase()}` };
        this.loops[this.loops.length - 1]?.gotos.push(s);
        return [s];
      }
      case 'randomize':
        this.p++;
        while (!this.endOfLine()) this.p++;
        this.lineEnd();
        return [];
      case 'redim': {
        this.p++;
        const preserve = this.eatKw('preserve');
        const name = this.name();
        this.expect('(');
        const size = this.expr();
        this.expect(')');
        this.lineEnd();
        if (preserve && size?.k === 'bin' && size.op === 'ADD' && size.b?.k === 'num' && size.b.v === 1 && isUbound(size.a, name)) {
          return [{ k: 'raw', code: '', lang: 'vba', src: `__redim__${name.toLowerCase()}` }];
        }
        this.fail('ReDim hat hier noch keinen Block.');
        break;
      }
      case 'debug':
        if (this.peek().v === '.' && this.peek(2).v.toLowerCase() === 'print') {
          this.p += 3;
          const parts: Ex[] = [];
          let newline = true;
          while (!this.endOfLine()) {
            if (this.eat(';') || this.eat(',')) {
              newline = false;
              continue;
            }
            newline = true;
            if (parts.length) parts.push({ k: 'str', v: '' });
            parts.push(this.expr());
          }
          this.lineEnd();
          const items = parts.filter((p) => !(p?.k === 'str' && p.v === ''));
          return [{ k: 'print', value: items.length === 0 ? { k: 'str', v: '' } : items.length === 1 ? items[0] : { k: 'join', parts: items }, newline }];
        }
        break;
      case 'call': {
        this.p++;
        const start = this.p;
        const e = this.postfix();
        this.lineEnd();
        if (e?.k === 'var') return [{ k: 'pexpr', e: { k: 'pcall', callee: e, args: [], src: this.srcFrom(start) } }];
        return [{ k: 'pexpr', e: e! }];
      }
      case 'set':
        this.p++;
        break;
      case 'select':
      case 'with':
      case 'on':
      case 'resume':
      case 'open':
      case 'close':
      case 'input':
      case 'line':
      case 'print':
      case 'error':
      case 'stop':
      case 'end':
        this.fail(`"${t.v}" hat noch keinen Block.`);
    }
    // assignment or call
    const start = this.p;
    const target = this.postfix();
    if (this.eat('=')) {
      const value = this.expr();
      this.lineEnd();
      if (target?.k === 'var') {
        if (this.fnName && target.name.toLowerCase() === this.fnName.toLowerCase()) return [{ k: 'return', value, src: '__fnassign__' }];
        this.addVar(target.name);
        // x = x + 1  ->  change
        if (value?.k === 'bin' && (value.op === 'ADD' || value.op === 'SUB') && value.a?.k === 'var' && value.a.name.toLowerCase() === target.name.toLowerCase() && value.b?.k === 'num') {
          return [{ k: 'change', name: target.name, by: value.op === 'ADD' ? value.b : negate(value.b) }];
        }
        return [{ k: 'set', name: target.name, value }];
      }
      if (target?.k === 'pcall' && target.callee.k === 'var' && target.args.length === 1) {
        return [{ k: 'listset', list: target.callee, index: target.args[0], value }];
      }
      this.fail('Diese Zuweisung hat noch keinen Block.');
    }
    // call without parentheses: "Name a, b"
    if (target?.k === 'var' || target?.k === 'member') {
      const args: Ex[] = [];
      while (!this.endOfLine()) {
        args.push(this.expr());
        if (!this.eat(',')) break;
      }
      this.lineEnd();
      return [{ k: 'pexpr', e: { k: 'pcall', callee: target, args, src: this.srcFrom(start) } }];
    }
    this.lineEnd();
    return [{ k: 'pexpr', e: target! }];
  }

  ifStmt(): Stmt {
    this.expectKw('if');
    const cond = this.expr();
    this.expectKw('then');
    if (!this.endOfLine()) {
      // single-line If
      const body = this.inlineStatements(() => this.kw('else'));
      let elseBody: Stmt[] | null = null;
      if (this.eatKw('else')) elseBody = this.inlineStatements(() => false);
      this.lineEnd();
      return { k: 'if', branches: [{ cond, body }], else: elseBody };
    }
    this.lineEnd();
    const branches: { cond: Ex; body: Stmt[] }[] = [];
    let elseBody: Stmt[] | null = null;
    let body = this.statements(() => this.kw('elseif') || this.kw('else') || (this.kw('end') && this.kw('if', 1)));
    branches.push({ cond, body });
    while (true) {
      if (this.eatKw('elseif')) {
        const c = this.expr();
        this.expectKw('then');
        this.lineEnd();
        body = this.statements(() => this.kw('elseif') || this.kw('else') || (this.kw('end') && this.kw('if', 1)));
        branches.push({ cond: c, body });
      } else if (this.eatKw('else')) {
        this.lineEnd();
        elseBody = this.statements(() => this.kw('end') && this.kw('if', 1));
      } else break;
    }
    this.expectKw('end');
    this.expectKw('if');
    this.lineEnd();
    return { k: 'if', branches, else: elseBody };
  }

  inlineStatements(stop: () => boolean): Stmt[] {
    const out: Stmt[] = [];
    // single-line If bodies are separated by ":" which the lexer turns into "nl"
    while (!this.endOfLine() && !stop()) {
      const saveNl = this.toks.findIndex((tk, idx) => idx >= this.p && (tk.t === 'nl' || tk.t === 'eof'));
      const sub = this.toks.slice(this.p, saveNl + 1);
      void sub;
      const s = this.statementInline(stop);
      out.push(...s);
      if (this.cur() === 'nl' && this.tok.v === ':') this.p++;
      else break;
    }
    return out;
  }

  statementInline(stop: () => boolean): Stmt[] {
    // Parse one statement that ends at "Else", ":" or end of line.
    const end = this.findInlineEnd(stop);
    const saved = this.toks;
    const patched = [...saved.slice(0, end), { t: 'nl', v: '', s: saved[end].s, e: saved[end].s }, ...saved.slice(end)];
    this.toks = patched;
    try {
      const r = this.statement();
      return r;
    } finally {
      const consumed = this.p;
      this.toks = saved;
      this.p = consumed - 1;
    }
  }

  findInlineEnd(stop: () => boolean): number {
    const save = this.p;
    let j = this.p;
    while (this.toks[j].t !== 'nl' && this.toks[j].t !== 'eof' && this.toks[j].t !== 'comment') {
      this.p = j;
      if (j > save && stop()) break;
      j++;
    }
    this.p = save;
    return j;
  }

  loopBody(stop: () => boolean): Stmt[] {
    const ctx: LoopCtx = { gotos: [] };
    this.loops.push(ctx);
    const body = this.statements(stop);
    this.loops.pop();
    // "GoTo X" followed by "X:" at the very end of the loop -> continue
    const last = body[body.length - 1];
    if (last?.k === 'raw' && last.src?.startsWith('__label__')) {
      const label = last.src.slice(9);
      body.pop();
      const replace = (stmts: Stmt[]) => {
        for (let i = 0; i < stmts.length; i++) {
          const s = stmts[i];
          if (s.k === 'raw' && s.src === `__goto__${label}`) stmts[i] = { k: 'continue' };
          if (s.k === 'if') {
            s.branches.forEach((b) => replace(b.body));
            if (s.else) replace(s.else);
          }
        }
      };
      replace(body);
    }
    return body;
  }

  forStmt(): Stmt {
    this.expectKw('for');
    if (this.eatKw('each')) {
      const v = this.name();
      this.expectKw('in');
      const list = this.expr();
      this.lineEnd();
      this.addVar(v);
      const body = this.loopBody(() => this.kw('next'));
      this.p++;
      while (!this.endOfLine()) this.p++;
      this.lineEnd();
      return { k: 'foreach', var: v, list, body };
    }
    const v = this.name();
    this.expect('=');
    const from = this.expr();
    this.expectKw('to');
    const to = this.expr();
    let by: Ex = { k: 'num', v: 1 };
    if (this.eatKw('step')) by = this.expr();
    this.lineEnd();
    this.addVar(v);
    const body = this.loopBody(() => this.kw('next'));
    this.p++;
    while (!this.endOfLine()) this.p++;
    this.lineEnd();
    const used = JSON.stringify(body).toLowerCase().includes(`"name":${JSON.stringify(v.toLowerCase())}`) || JSON.stringify(body).toLowerCase().includes(`"var":${JSON.stringify(v.toLowerCase())}`);
    if (!used && from?.k === 'num' && from.v === 1 && by?.k === 'num' && by.v === 1) return { k: 'repeat', times: to, body, src: `__counter__${v}` };
    return { k: 'for', var: v, from, to, by, body };
  }

  doStmt(): Stmt {
    this.expectKw('do');
    let until = false;
    let cond: Ex = { k: 'bool', v: true };
    if (this.kw('while') || this.kw('until')) {
      until = this.kw('until');
      this.p++;
      cond = this.expr();
    }
    this.lineEnd();
    const body = this.loopBody(() => this.kw('loop'));
    this.expectKw('loop');
    if (this.kw('while') || this.kw('until')) this.fail('Do ... Loop While hat noch keinen Block.');
    this.lineEnd();
    return { k: 'while', until, cond, body };
  }

  // ---- expressions -------------------------------------------------------------------

  mk(e: Expr, start: number): Expr {
    if (e.k !== 'num' && e.k !== 'str' && e.k !== 'var' && e.k !== 'bool') e.src = this.srcFrom(start);
    return e;
  }

  level(next: () => Ex, ops: Record<string, any>): Ex {
    const start = this.p;
    let a = next();
    while (true) {
      const t = this.tok;
      const key = t.t === 'name' ? t.v.toLowerCase() : t.t === 'op' ? t.v : '';
      if (!(key in ops)) break;
      this.p++;
      const b = next();
      const op = ops[key];
      a = this.mk(op ? { k: 'bin', op, a, b } : { k: 'pbin', op: key, a, b }, start);
    }
    return a;
  }

  expr = (): Ex => this.level(this.and, { or: 'OR', xor: null, eqv: null, imp: null });
  and = (): Ex => this.level(this.not, { and: 'AND' });
  not = (): Ex => {
    const start = this.p;
    if (this.eatKw('not')) return this.mk({ k: 'not', a: this.not() }, start);
    return this.comparison();
  };
  comparison = (): Ex => this.level(this.concat, { '=': 'EQ', '<>': 'NEQ', '<': 'LT', '<=': 'LTE', '>': 'GT', '>=': 'GTE', like: null, is: null });
  concat = (): Ex => {
    const start = this.p;
    let a = this.additive();
    if (!this.is('&')) return a;
    const parts: Ex[] = [a];
    while (this.eat('&')) parts.push(this.additive());
    a = this.mk({ k: 'join', parts }, start);
    return a;
  };
  additive = (): Ex => this.level(this.mod, { '+': 'ADD', '-': 'SUB' });
  mod = (): Ex => this.level(this.idiv, { mod: 'MOD' });
  idiv = (): Ex => this.level(this.mul, { '\\': 'IDIV' });
  mul = (): Ex => this.level(this.unary, { '*': 'MUL', '/': 'DIV' });
  unary = (): Ex => {
    const start = this.p;
    if (this.eat('-')) {
      const a = this.unary();
      if (a?.k === 'num') return { ...a, v: -a.v };
      return this.mk({ k: 'math', fn: 'neg', a }, start);
    }
    if (this.eat('+')) return this.unary();
    return this.power();
  };
  power = (): Ex => {
    const start = this.p;
    const base = this.postfix();
    if (this.eat('^')) {
      const exp = this.unary();
      return this.mk({ k: 'bin', op: 'POW', a: base, b: exp }, start);
    }
    return base;
  };

  postfix(): Ex {
    const start = this.p;
    let e = this.primary();
    while (true) {
      if (this.is('(')) {
        this.p++;
        const args: Ex[] = [];
        while (!this.is(')')) {
          args.push(this.expr());
          if (!this.eat(',')) break;
        }
        this.expect(')');
        e = this.mk({ k: 'pcall', callee: e!, args }, start);
      } else if (this.is('.')) {
        this.p++;
        e = this.mk({ k: 'member', obj: e, name: this.name() }, start);
      } else if (this.is('!')) {
        this.fail('"!" hat noch keinen Block.');
      } else break;
    }
    return e;
  }

  primary(): Ex {
    const t = this.tok;
    if (t.t === 'num') {
      this.p++;
      if (/^&H/i.test(t.v)) return { k: 'num', v: parseInt(t.v.slice(2), 16) };
      const v = parseFloat(t.v);
      return /[.eE]/.test(t.v) ? { k: 'num', v, float: true } : { k: 'num', v };
    }
    if (t.t === 'str') {
      this.p++;
      return { k: 'str', v: t.v };
    }
    if (t.t === 'name') {
      const low = t.v.toLowerCase();
      if (low === 'true' || low === 'false') {
        this.p++;
        return { k: 'bool', v: low === 'true' };
      }
      if (['vbnewline', 'vbcrlf', 'vblf', 'vbcr'].includes(low)) {
        this.p++;
        return { k: 'str', v: '\n' };
      }
      if (low === 'vbtab') {
        this.p++;
        return { k: 'str', v: '\t' };
      }
      if (['nothing', 'null', 'empty', 'me', 'new', 'addressof', 'typeof'].includes(low)) this.fail(`"${t.v}" hat noch keinen Block.`);
      this.p++;
      return { k: 'var', name: t.v };
    }
    if (this.eat('(')) {
      const e = this.expr();
      this.expect(')');
      return e;
    }
    this.fail(`Unerwartetes "${t.v || 'Zeilenende'}".`);
  }
}

function isUbound(e: Ex, name: string): boolean {
  return e?.k === 'pcall' && e.callee.k === 'var' && e.callee.name.toLowerCase() === 'ubound' && e.args.length === 1 && e.args[0]?.k === 'var' && e.args[0].name.toLowerCase() === name.toLowerCase();
}

/** "ReDim Preserve l(UBound(l) + 1)" + "l(UBound(l)) = v"  ->  listadd */
function mergeListAdds(stmts: Stmt[]): Stmt[] {
  const out: Stmt[] = [];
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    if (s.k === 'raw' && s.src?.startsWith('__redim__')) {
      const name = s.src.slice(9);
      const next = stmts[i + 1];
      if (next?.k === 'listset' && next.list?.k === 'var' && next.list.name.toLowerCase() === name && isUbound(next.index, name)) {
        out.push({ k: 'listadd', list: next.list, value: next.value });
        i++;
        continue;
      }
      out.push({ k: 'raw', code: `ReDim Preserve ${name}(UBound(${name}) + 1)`, lang: 'vba' });
      continue;
    }
    out.push(s);
  }
  return out;
}

export function parseVbaExpr(code: string): Expr {
  const p = new VbaParser(code, tokenizeVba(code));
  const e = p.expr();
  if (!e || (p.cur() !== 'nl' && p.cur() !== 'eof')) throw new ParseError('Ausdruck erwartet.', 0);
  return e;
}

export function parseVba(src: string): ParseResult {
  let toks: Token[];
  try {
    toks = tokenizeVba(src);
  } catch (err) {
    if (err instanceof ParseError) return { program: { main: [rawStmt(src, 'vba')], functions: [] }, diagnostics: [{ message: err.message, line: lineOf(src, err.pos) }] };
    throw err;
  }
  const p = new VbaParser(src, toks);
  p.parseModule();
  for (const text of p.pendingComments) p.globalStmts.push({ k: 'comment', text });

  // Which procedure is the main program?
  let mainProc = p.procs.find((x) => x.name.toLowerCase() === 'main' && !x.params.length && !x.isFunction);
  if (!mainProc) mainProc = p.procs.find((x) => !x.params.length && !x.isFunction);
  const moduleVars = p.vars.get('') ?? new Set();
  const functions: FunctionDef[] = [];
  const locals: Record<string, string[]> = {};
  let main: Stmt[] = [...p.globalStmts];
  const procNames = new Set(p.procs.map((x) => x.name.toLowerCase()));

  for (const proc of p.procs) {
    const known = new Set([...moduleVars, ...(p.vars.get(proc.name) ?? [])]);
    const body = fixProc(proc.body, known, procNames, proc.isFunction ? proc.name : null);
    if (proc === mainProc) {
      main = [...main, ...(proc.comment ? [{ k: 'comment', text: proc.comment } as Stmt] : []), ...body];
      // locals of Main are main variables
      for (const key of Object.keys(p.types)) {
        if (key.startsWith(`${proc.name}:`)) {
          p.types[`:${key.slice(proc.name.length + 1)}`] = p.types[key];
          delete p.types[key];
        }
      }
      continue;
    }
    const returns = proc.isFunction;
    functions.push({ name: proc.name, params: proc.params, body, returns, ...(proc.comment ? { comment: proc.comment } : {}) });
    locals[proc.name] = [...(p.vars.get(proc.name) ?? [])]
      .filter((v) => !proc.params.some((x) => x.toLowerCase() === v) && !moduleVars.has(v))
      .map((v) => originalCase(body, v));
  }
  const program: Program = {
    main,
    functions,
    meta: { types: p.types, locals, mainName: mainProc && mainProc.name.toLowerCase() !== 'main' ? mainProc.name : undefined },
  };
  return normalize(program, 'vba');
}

function originalCase(body: Stmt[], lower: string): string {
  let found = lower;
  walkStmts(body, (s) => {
    if ((s.k === 'set' || s.k === 'change') && s.name.toLowerCase() === lower) found = s.name;
    if ((s.k === 'for' || s.k === 'foreach') && s.var.toLowerCase() === lower) found = s.var;
  });
  return found;
}

/** Array access vs. call, function-name assignment -> return, raw leftovers. */
function fixProc(body: Stmt[], known: Set<string>, procs: Set<string>, fnName: string | null): Stmt[] {
  const fixExpr = (e: Ex): Ex => {
    if (!e) return e;
    const out: any = { ...e };
    for (const [k, v] of Object.entries(e)) {
      if (Array.isArray(v)) out[k] = v.map((x) => (x && typeof x === 'object' && 'k' in x ? fixExpr(x) : x));
      else if (v && typeof v === 'object' && 'k' in (v as any)) out[k] = fixExpr(v as Expr);
    }
    if (out.k === 'pcall' && out.callee.k === 'var' && out.args.length === 1 && known.has(out.callee.name.toLowerCase()) && !procs.has(out.callee.name.toLowerCase())) {
      return { k: 'index', list: out.callee, index: out.args[0], src: out.src };
    }
    return out;
  };
  const fix = (stmts: Stmt[], top: boolean): Stmt[] => {
    const out: Stmt[] = [];
    stmts.forEach((s0, i) => {
      let s: any = { ...s0 };
      for (const [k, v] of Object.entries(s0)) {
        if (k === 'body' || k === 'else') s[k] = v ? fix(v as Stmt[], false) : v;
        else if (k === 'branches') s[k] = (v as any[]).map((b) => ({ cond: fixExpr(b.cond), body: fix(b.body, false) }));
        else if (k === 'args') s[k] = (v as Ex[]).map(fixExpr);
        else if (v && typeof v === 'object' && 'k' in (v as any)) s[k] = fixExpr(v as Expr);
      }
      if (s.k === 'listset' && s.list?.k === 'var' && !known.has(s.list.name.toLowerCase())) {
        s = { k: 'raw', code: `${s.list.name}(...) = ...`, lang: 'vba' };
      }
      if (s.k === 'return' && s.src === '__fnassign__') {
        // "f = value" followed by "Exit Function" or at the end -> return value
        const next = stmts[i + 1];
        const isEnd = top && i === stmts.length - 1;
        delete s.src;
        if (next?.k === 'return' && !next.value) {
          next.value = s.value;
          return;
        }
        if (!isEnd && !fnName) return;
      }
      if (s.k === 'raw' && s.src?.startsWith('__label__')) return;
      if (s.k === 'raw' && s.src?.startsWith('__goto__')) delete s.src;
      out.push(s);
    });
    return out;
  };
  return fix(body, true);
}
