// Python source -> IR

import type { Ex, Expr, FunctionDef, ImportInfo, Program, Stmt } from '../ir';
import { assignedNames, walkAllExprs, walkStmts } from '../ir';
import { ParseError, type ParseResult, type Token, caseCondition, errorVarToMessage, isIdentChar, isIdentStart, isTrailing, lineOf, mapTree, markGap, negate, rawStmt, unescape } from './common';
import { foldPlus } from '../generators/base';
import { normalize } from './normalize';

const OPS = [
  '**=', '//=', '>>=', '<<=', '...', '**', '//', '==', '!=', '<=', '>=', '->', '+=', '-=', '*=', '/=', '%=', '&=', '|=',
  '^=', ':=', '<<', '>>', '+', '-', '*', '/', '%', '@', '&', '|', '^', '~', '<', '>', '(', ')', '[', ']', '{', '}',
  ',', ':', '.', ';', '=',
];
const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'if', 'else', 'elif', 'for', 'while', 'def', 'return', 'lambda', 'None', 'True', 'False']);

export function tokenizePython(src: string): Token[] {
  const toks: Token[] = [];
  const indents = [0];
  let i = 0;
  let depth = 0;
  let atLineStart = true;
  let pendingComments: Token[] = [];
  const push = (t: string, v: string, s: number, e: number, x?: any) => toks.push({ t, v, s, e, x });
  const flushComments = () => {
    for (const c of pendingComments) {
      toks.push(c);
      push('nl', '', c.e, c.e);
    }
    pendingComments = [];
  };

  while (i <= src.length) {
    if (atLineStart && depth === 0) {
      // measure indentation
      let col = 0;
      let j = i;
      while (j < src.length && (src[j] === ' ' || src[j] === '\t')) {
        col = src[j] === '\t' ? col + 8 - (col % 8) : col + 1;
        j++;
      }
      if (j >= src.length) {
        i = j;
        break;
      }
      if (src[j] === '\n' || src[j] === '\r') {
        i = src[j] === '\r' && src[j + 1] === '\n' ? j + 2 : j + 1;
        continue;
      }
      if (src[j] === '#') {
        let e = j;
        while (e < src.length && src[e] !== '\n') e++;
        pendingComments.push({ t: 'comment', v: src.slice(j + 1, e).replace(/\r$/, ''), s: j, e });
        i = e + 1;
        continue;
      }
      const cur = indents[indents.length - 1];
      if (col > cur) {
        indents.push(col);
        push('indent', '', j, j);
      } else {
        while (col < indents[indents.length - 1]) {
          indents.pop();
          push('dedent', '', j, j);
        }
        if (col !== indents[indents.length - 1]) throw new ParseError('Die Einrückung passt nicht zu den vorherigen Zeilen.', j);
      }
      flushComments();
      i = j;
      atLineStart = false;
    }
    if (i >= src.length) break;
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\f') {
      i++;
      continue;
    }
    if (c === '\\' && (src[i + 1] === '\n' || src[i + 1] === '\r')) {
      i += src[i + 1] === '\r' && src[i + 2] === '\n' ? 3 : 2;
      continue;
    }
    if (c === '\n' || c === '\r') {
      const s = i;
      i = c === '\r' && src[i + 1] === '\n' ? i + 2 : i + 1;
      if (depth === 0) {
        if (toks.length && toks[toks.length - 1].t !== 'nl') push('nl', '', s, s);
        flushComments();
        atLineStart = true;
      }
      continue;
    }
    if (c === '#') {
      let e = i;
      while (e < src.length && src[e] !== '\n') e++;
      // trailing comment: emitted after the end of the line
      pendingComments.push({ t: 'comment', v: src.slice(i + 1, e).replace(/\r$/, ''), s: i, e });
      i = e;
      continue;
    }
    // strings (with optional prefix)
    const strMatch = /^([rRbBfFuU]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5));
    if (strMatch && (strMatch[1] === '' || /^[rbfu]{1,2}$/i.test(strMatch[1]))) {
      const prefix = strMatch[1].toLowerCase();
      const quote = strMatch[2];
      const s = i;
      let j = i + strMatch[0].length;
      let body = '';
      while (true) {
        if (j >= src.length) throw new ParseError('Ein Text (String) wird nicht geschlossen.', s);
        if (src.startsWith(quote, j)) break;
        if (src[j] === '\\' && !prefix.includes('r')) {
          body += src[j] + src[j + 1];
          j += 2;
          continue;
        }
        if ((src[j] === '\n') && quote.length === 1) throw new ParseError('Ein Text (String) wird nicht geschlossen.', s);
        body += src[j++];
      }
      i = j + quote.length;
      const value = prefix.includes('r') ? body : unescape(body);
      push('str', value, s, i, { prefix, raw: body });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:[0-9][0-9_]*)?\.?[0-9_]*(?:[eE][+-]?[0-9]+)?)[jJ]?/.exec(src.slice(i))!;
      push('num', m[0], i, i + m[0].length);
      i += m[0].length;
      continue;
    }
    if (isIdentStart(c) && c !== '$') {
      let j = i + 1;
      while (j < src.length && isIdentChar(src[j]) && src[j] !== '$') j++;
      push('name', src.slice(i, j), i, j);
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ParseError(`Unbekanntes Zeichen "${c}".`, i);
    if ('([{'.includes(op)) depth++;
    if (')]}'.includes(op)) depth = Math.max(0, depth - 1);
    push('op', op, i, i + op.length);
    i += op.length;
  }
  if (toks.length && toks[toks.length - 1].t !== 'nl') push('nl', '', src.length, src.length);
  flushComments();
  while (indents.length > 1) {
    indents.pop();
    push('dedent', '', src.length, src.length);
  }
  push('eof', '', src.length, src.length);
  return toks;
}

class PyParser {
  p = 0;
  imports: ImportInfo[] = [];
  globalsDecl = new Map<string, Set<string>>();
  currentFn: string | null = null;

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
  is(v: string, t = 'op'): boolean {
    return this.cur() === t && this.tok.v === v;
  }
  isKw(v: string): boolean {
    return this.cur() === 'name' && this.tok.v === v;
  }
  eat(v: string, t = 'op'): boolean {
    if (this.is(v, t)) {
      this.p++;
      return true;
    }
    return false;
  }
  eatKw(v: string): boolean {
    return this.eat(v, 'name');
  }
  expect(v: string, t = 'op'): Token {
    if (!this.is(v, t)) throw new ParseError(`"${v}" erwartet, gefunden: "${this.tok.v || this.cur()}".`, this.tok.s);
    return this.toks[this.p++];
  }
  expectKw(v: string) {
    return this.expect(v, 'name');
  }
  name(): string {
    if (this.cur() !== 'name' || KEYWORDS.has(this.tok.v)) throw new ParseError(`Name erwartet, gefunden: "${this.tok.v}".`, this.tok.s);
    return this.toks[this.p++].v;
  }
  srcFrom(startTok: number): string {
    const s = this.toks[startTok].s;
    const e = this.toks[Math.max(startTok, this.p - 1)].e;
    return this.src.slice(s, e);
  }

  // ---- statements -------------------------------------------------------------

  parseFile(): Stmt[] {
    const out: Stmt[] = [];
    while (this.cur() !== 'eof') {
      if (this.cur() === 'nl' || this.cur() === 'indent' || this.cur() === 'dedent') {
        this.p++;
        continue;
      }
      out.push(...this.statementSafe());
    }
    return out;
  }

  /** Parses one statement; on error the statement becomes a raw code block. */
  statementSafe(): Stmt[] {
    const start = this.p;
    const pos = this.toks[start].s;
    const out = markGap(this.statementInner(), this.src, pos);
    // comment at the end of the line belongs to the statement
    if (out.length && this.cur() === 'comment' && isTrailing(this.src, this.tok.s)) {
      const last = out[out.length - 1];
      if (last.k !== 'comment' && last.k !== 'if' && last.k !== 'while' && last.k !== 'for' && last.k !== 'foreach' && last.k !== 'repeat') {
        out[out.length - 1] = { ...last, trail: this.tok.v.replace(/^ /, '') };
        this.p++;
        this.eat('', 'nl');
      }
    }
    return out;
  }

  statementInner(): Stmt[] {
    const start = this.p;
    try {
      return this.statement();
    } catch (err) {
      if (!(err instanceof ParseError)) throw err;
      this.p = start;
      // skip to the end of the logical line, plus an indented block
      while (this.cur() !== 'nl' && this.cur() !== 'eof') this.p++;
      const lineEnd = this.toks[Math.max(start, this.p - 1)].e;
      this.eat('', 'nl');
      let end = lineEnd;
      if (this.cur() === 'indent') {
        let d = 0;
        do {
          if (this.cur() === 'indent') d++;
          if (this.cur() === 'dedent') d--;
          if (this.cur() !== 'dedent' && this.cur() !== 'indent') end = Math.max(end, this.tok.e);
          this.p++;
        } while (d > 0 && this.cur() !== 'eof');
      }
      let s = this.toks[start].s;
      while (s > 0 && this.src[s - 1] !== '\n') s--;
      return [rawStmt(this.src.slice(s, end), 'python')];
    }
  }

  nesting = 0;

  block(): Stmt[] {
    this.nesting++;
    try {
      return this.blockInner();
    } finally {
      this.nesting--;
    }
  }

  blockInner(): Stmt[] {
    this.expect(':');
    if (this.cur() !== 'nl') {
      // single-line suite: "if x: y = 1"
      const out = this.simpleStatements();
      return out;
    }
    this.expect('', 'nl');
    const pre: Stmt[] = [];
    while (this.cur() === 'comment') {
      pre.push({ k: 'comment', text: this.tok.v.replace(/^ /, '') });
      this.p++;
      this.eat('', 'nl');
    }
    this.expect('', 'indent');
    const body: Stmt[] = [...pre];
    while (this.cur() !== 'dedent' && this.cur() !== 'eof') {
      if (this.cur() === 'nl') {
        this.p++;
        continue;
      }
      body.push(...this.statementSafe());
    }
    this.eat('', 'dedent');
    return body;
  }

  statement(): Stmt[] {
    const t = this.tok;
    if (t.t === 'comment') {
      this.p++;
      this.eat('', 'nl');
      return [{ k: 'comment', text: t.v.replace(/^ /, '') }];
    }
    if (t.t === 'name') {
      switch (t.v) {
        case 'if':
          return [this.ifStmt()];
        case 'while': {
          this.p++;
          const cond = this.expr();
          const body = this.block();
          // "while True: ... if not c: break" at the end is a loop that checks afterwards
          const last = body[body.length - 1];
          if (cond?.k === 'bool' && cond.v && last?.k === 'if' && last.branches.length === 1 && !last.else && last.branches[0].body.length === 1 && last.branches[0].body[0].k === 'break' && !containsContinue(body)) {
            const c = last.branches[0].cond;
            const rest = body.slice(0, -1);
            if (c?.k === 'not') return [{ k: 'while', until: false, cond: c.a, body: rest, post: true }];
            return [{ k: 'while', until: true, cond: c, body: rest, post: true }];
          }
          if (cond?.k === 'not') return [{ k: 'while', until: true, cond: cond.a, body }];
          return [{ k: 'while', until: false, cond, body }];
        }
        case 'try':
          return [this.tryStmt()];
        case 'match':
          if (this.peek().t === 'name' || this.peek().t === 'num' || this.peek().t === 'str' || this.peek().v === '(') return this.matchStmt();
          break;
        case 'for':
          return [this.forStmt()];
        case 'def':
          return [this.defStmt()];
        case 'class':
        case 'with':
        case 'async':
          throw new ParseError(`"${t.v}" hat noch keinen Block.`, t.s);
      }
      if (t.v === '@') throw new ParseError('Dekoratoren haben noch keinen Block.', t.s);
    }
    if (this.is('@')) throw new ParseError('Dekoratoren haben noch keinen Block.', t.s);
    return this.simpleStatements();
  }

  simpleStatements(): Stmt[] {
    const out: Stmt[] = [];
    do {
      if (this.cur() === 'nl' || this.cur() === 'eof') break;
      out.push(...this.simple());
    } while (this.eat(';'));
    if (this.cur() !== 'eof') this.expect('', 'nl');
    return out;
  }

  simple(): Stmt[] {
    const t = this.tok;
    if (t.t === 'name') {
      switch (t.v) {
        case 'pass':
          this.p++;
          return [];
        case 'break':
          this.p++;
          return [{ k: 'break' }];
        case 'continue':
          this.p++;
          return [{ k: 'continue' }];
        case 'return': {
          this.p++;
          const value = this.cur() === 'nl' || this.is(';') ? null : this.exprList();
          return [{ k: 'return', value }];
        }
        case 'raise': {
          this.p++;
          if (this.cur() === 'nl') throw new ParseError('"raise" ohne Fehler hat noch keinen Block.', t.s);
          const e = this.expr();
          // raise ValueError("...") / raise Exception(msg)
          if (e?.k === 'pcall' && e.args.length <= 1) return [{ k: 'throw', value: e.args[0] ?? { k: 'str', v: 'Fehler' } }];
          return [{ k: 'throw', value: e }];
        }
        case 'del': {
          this.p++;
          const target = this.expr();
          if (target?.k !== 'index') throw new ParseError('"del" hat hier noch keinen Block.', t.s);
          return [{ k: 'pexpr', e: { k: 'pcall', callee: { k: 'member', obj: target.list!, name: 'pop' }, args: [target.index] } }];
        }
        case 'global':
        case 'nonlocal': {
          this.p++;
          const names = [this.name()];
          while (this.eat(',')) names.push(this.name());
          const key = this.currentFn ?? '';
          if (!this.globalsDecl.has(key)) this.globalsDecl.set(key, new Set());
          for (const n of names) this.globalsDecl.get(key)!.add(n);
          return [];
        }
        case 'import': {
          this.p++;
          do {
            let module = this.name();
            while (this.eat('.')) module += '.' + this.name();
            const alias = this.eatKw('as') ? this.name() : module;
            if (!['math', 'random', 'time'].includes(module) || alias !== module) this.imports.push({ lang: 'python', module, alias });
          } while (this.eat(','));
          return [];
        }
        case 'from':
        case 'assert':
        case 'yield':
          throw new ParseError(`"${t.v}" hat noch keinen Block.`, t.s);
      }
    }
    const start = this.p;
    const target = this.exprList();
    if (this.is('=')) {
      this.p++;
      if (target?.k === 'list' && target.src === '__tuple__') return this.multiAssign(target.items, this.exprList());
      // list comprehension -> loop
      const valueStart = this.p;
      if (target?.k === 'var' && this.is('[')) {
        const comp = this.tryComprehension();
        if (comp) return this.expandComprehension(target.name, comp);
        this.p = valueStart;
      }
      const value = this.exprList();
      if (this.is('=')) throw new ParseError('Mehrfachzuweisungen haben noch keinen Block.', this.tok.s);
      return [this.assign(target, value)];
    }
    const aug = ['+=', '-=', '*=', '/=', '//=', '%=', '**='].find((o) => this.is(o));
    if (aug) {
      this.p++;
      const value = this.expr();
      if (target?.k !== 'var') throw new ParseError('Diese Zuweisung hat noch keinen Block.', this.toks[start].s);
      if (aug === '+=') return [{ k: 'change', name: target.name, by: value }];
      if (aug === '-=') return [{ k: 'change', name: target.name, by: negate(value) }];
      const op = { '*=': 'MUL', '/=': 'DIV', '//=': 'IDIV', '%=': 'MOD', '**=': 'POW' }[aug] as any;
      return [{ k: 'set', name: target.name, value: { k: 'bin', op, a: target, b: value } }];
    }
    if (!target) throw new ParseError('Ausdruck erwartet.', this.tok.s);
    return [this.exprStatement(target)];
  }

  /** Expression or bare tuple "a, b" (a tuple becomes a list). */
  exprList(): Ex {
    const first = this.expr();
    if (!this.is(',')) return first;
    const items: Ex[] = [first];
    while (this.eat(',')) {
      if (this.cur() === 'nl' || this.is('=') || this.is(')')) break;
      items.push(this.expr());
    }
    return { k: 'list', items, src: '__tuple__' };
  }

  /** a, b = b, a + b  ->  assignments in an order that keeps the old values. */
  multiAssign(targets: Ex[], value: Ex): Stmt[] {
    const names = targets.map((t) => {
      if (t?.k !== 'var') throw new ParseError('Diese Mehrfachzuweisung hat noch keinen Block.', this.tok.s);
      return t.name;
    });
    const out: Stmt[] = [];
    if (value?.k === 'list' && value.items.length === names.length) {
      const values = [...value.items];
      names.forEach((n, i) => {
        // a later value needs the old value of this variable: keep it in a helper variable
        if (values.slice(i + 1).some((v) => mentions(v, n))) {
          const tmp = `${n}_alt`;
          out.push({ k: 'set', name: tmp, value: { k: 'var', name: n } });
          for (let j = i + 1; j < values.length; j++) values[j] = renameVar(values[j], n, tmp);
        }
      });
      names.forEach((n, i) => out.push({ k: 'set', name: n, value: values[i] }));
      return out;
    }
    const tmp = names.join('_');
    out.push({ k: 'set', name: tmp, value });
    names.forEach((n, i) => out.push({ k: 'set', name: n, value: { k: 'index', list: { k: 'var', name: tmp }, index: { k: 'num', v: i } } }));
    return out;
  }

  tryStmt(): Stmt {
    this.expectKw('try');
    const body = this.block();
    while (this.cur() === 'nl') this.p++;
    this.expectKw('except');
    let name = '';
    if (!this.is(':')) {
      this.expr(); // error type
      if (this.eatKw('as')) name = this.name();
    }
    let handler = this.block();
    while (this.cur() === 'nl') this.p++;
    if (this.isKw('except') || this.isKw('else') || this.isKw('finally')) throw new ParseError('Mehrere except-, else- oder finally-Teile haben noch keinen Block.', this.tok.s);
    handler = errorVarToMessage(handler, name, 'python');
    return { k: 'try', body, handler };
  }

  /** match x: case 1: ... case 2 | 3: ... case _: ...  ->  if-chain */
  matchStmt(): Stmt[] {
    this.expectKw('match');
    const subject = this.expr();
    this.expect(':');
    this.expect('', 'nl');
    this.expect('', 'indent');
    const branches: { cond: Ex; body: Stmt[] }[] = [];
    let elseBody: Stmt[] | null = null;
    while (!this.is('', 'dedent') && this.cur() !== 'eof') {
      if (this.cur() === 'nl') {
        this.p++;
        continue;
      }
      this.expectKw('case');
      if (this.isKw('_')) {
        this.p++;
        elseBody = this.block();
        continue;
      }
      const values: Ex[] = [this.atom()];
      while (this.eat('|')) values.push(this.atom());
      if (this.isKw('if')) throw new ParseError('case mit "if" hat noch keinen Block.', this.tok.s);
      branches.push({ cond: caseCondition(subject, values), body: this.block() });
    }
    this.eat('', 'dedent');
    if (!branches.length) return elseBody ?? [];
    return [{ k: 'if', branches, else: elseBody }];
  }

  assign(target: Ex, value: Ex): Stmt {
    if (target?.k === 'var') return { k: 'set', name: target.name, value };
    if (target?.k === 'index') return { k: 'listset', list: target.list, index: target.index, value };
    throw new ParseError('Diese Zuweisung hat noch keinen Block.', this.tok.s);
  }

  exprStatement(e: Expr): Stmt {
    if (e.k === 'pcall' && e.callee.k === 'var' && e.callee.name === 'print') {
      const kw = e.kwargs ?? {};
      for (const k of Object.keys(kw)) if (k !== 'end' && k !== 'sep') throw new ParseError(`print(${k}=...) hat noch keinen Block.`, this.tok.s);
      const sep = kw.sep ?? { k: 'str', v: ' ' };
      let parts: Ex[] = [];
      e.args.forEach((a, i) => {
        if (i > 0) parts.push(sep);
        parts.push(a);
      });
      let newline = true;
      if (kw.end) {
        if (kw.end.k === 'str' && kw.end.v === '\n') newline = true;
        else if (kw.end.k === 'str' && kw.end.v === '') newline = false;
        else {
          parts.push(kw.end);
          newline = false;
        }
      }
      parts = parts.filter((p) => !(p?.k === 'str' && p.v === '' && parts.length > 1));
      const value: Ex = parts.length === 0 ? { k: 'str', v: '' } : parts.length === 1 ? parts[0] : { k: 'join', parts };
      return { k: 'print', value, newline };
    }
    return { k: 'pexpr', e };
  }

  ifStmt(): Stmt {
    this.expectKw('if');
    const branches: { cond: Ex; body: Stmt[] }[] = [];
    const cond = this.expr();
    branches.push({ cond, body: this.block() });
    let elseBody: Stmt[] | null = null;
    while (true) {
      while (this.cur() === 'nl') this.p++;
      if (this.isKw('elif')) {
        this.p++;
        const c = this.expr();
        branches.push({ cond: c, body: this.block() });
      } else if (this.isKw('else')) {
        this.p++;
        elseBody = this.block();
        break;
      } else break;
    }
    return { k: 'if', branches, else: elseBody };
  }

  forStmt(): Stmt {
    const start = this.toks[this.p].s;
    this.expectKw('for');
    const name = this.name();
    if (this.eat(',')) {
      // for i, x in enumerate(list) / for k, v in d.items()
      const second = this.name();
      this.expectKw('in');
      const iter = this.expr();
      const body = this.block();
      if (iter?.k === 'pcall' && iter.callee.k === 'var' && iter.callee.name === 'enumerate' && iter.args.length === 1) {
        const list = iter.args[0];
        const set: Stmt = { k: 'set', name: second, value: { k: 'index', list, index: { k: 'var', name } } };
        return { k: 'for', var: name, from: { k: 'num', v: 0 }, to: foldPlus({ k: 'len', of: 'auto', a: list }, -1), by: { k: 'num', v: 1 }, body: [set, ...body] };
      }
      if (iter?.k === 'pcall' && iter.callee.k === 'member' && iter.callee.name === 'items' && !iter.args.length) {
        const dict = iter.callee.obj;
        const set: Stmt = { k: 'set', name: second, value: { k: 'dget', dict, key: { k: 'var', name } } };
        return { k: 'foreach', var: name, list: dict, body: [set, ...body] };
      }
      throw new ParseError('Schleifen über mehrere Variablen haben noch keinen Block.', start);
    }
    this.expectKw('in');
    const iter = this.expr();
    const body = this.block();
    if (iter?.k === 'pcall' && iter.callee.k === 'var' && iter.callee.name === 'range' && !iter.kwargs) {
      const a = iter.args;
      const used = usesName(body, name);
      if (a.length === 1 || (a.length === 2 && a[0]?.k === 'num' && a[0].v === 0)) {
        const n = a.length === 1 ? a[0] : a[1];
        if (!used) return { k: 'repeat', times: n, body };
        return { k: 'for', var: name, from: { k: 'num', v: 0 }, to: foldPlus(n, -1), by: { k: 'num', v: 1 }, body };
      }
      if (a.length === 2) return { k: 'for', var: name, from: a[0], to: foldPlus(a[1], -1), by: { k: 'num', v: 1 }, body };
      if (a.length === 3) {
        const step = a[2];
        if (step?.k === 'num') return { k: 'for', var: name, from: a[0], to: foldPlus(a[1], step.v > 0 ? -1 : 1), by: step, body };
        return { k: 'for', var: name, from: a[0], to: foldPlus(a[1], -1), by: step, body };
      }
    }
    return { k: 'foreach', var: name, list: iter, body };
  }

  defStmt(): Stmt {
    if (this.nesting > 0) throw new ParseError('Funktionen innerhalb von Blöcken haben noch keinen Block.', this.tok.s);
    this.expectKw('def');
    const name = this.name();
    this.expect('(');
    const params: string[] = [];
    const defaults: Ex[] = [];
    while (!this.is(')')) {
      if (this.is('*') || this.is('**') || this.is('/')) throw new ParseError('*args / **kwargs haben noch keinen Block.', this.tok.s);
      params.push(this.name());
      if (this.eat(':')) this.expr(); // type annotation (ignored)
      if (this.eat('=')) defaults[params.length - 1] = this.expr();
      if (!this.eat(',')) break;
    }
    this.expect(')');
    if (this.eat('->')) this.expr();
    const savedFn = this.currentFn;
    this.currentFn = name;
    const body = this.block();
    this.currentFn = savedFn;
    // marker statement; turned into a function by parsePython()
    return { k: 'raw', code: '', lang: 'python', src: '__def__', id: JSON.stringify({ name, params }), ...({ body, defaults } as any) };
  }

  tryComprehension(): { expr: Ex; v: string; iter: Ex; cond: Ex } | null {
    const save = this.p;
    try {
      this.expect('[');
      const e = this.expr();
      if (!this.isKw('for')) {
        this.p = save;
        return null;
      }
      this.p++;
      const v = this.name();
      this.expectKw('in');
      const iter = this.orTest();
      const cond = this.eatKw('if') ? this.orTest() : null;
      this.expect(']');
      return { expr: e, v, iter, cond };
    } catch {
      this.p = save;
      return null;
    }
  }

  expandComprehension(target: string, c: { expr: Ex; v: string; iter: Ex; cond: Ex }): Stmt[] {
    const add: Stmt = { k: 'listadd', list: { k: 'var', name: target }, value: c.expr };
    const inner: Stmt[] = c.cond ? [{ k: 'if', branches: [{ cond: c.cond, body: [add] }], else: null }] : [add];
    const loop = this.forFromIter(c.v, c.iter, inner);
    return [{ k: 'set', name: target, value: { k: 'list', items: [] } }, loop];
  }

  forFromIter(name: string, iter: Ex, body: Stmt[]): Stmt {
    if (iter?.k === 'pcall' && iter.callee.k === 'var' && iter.callee.name === 'range') {
      const a = iter.args;
      if (a.length === 1) return { k: 'for', var: name, from: { k: 'num', v: 0 }, to: foldPlus(a[0], -1), by: { k: 'num', v: 1 }, body };
      if (a.length === 2) return { k: 'for', var: name, from: a[0], to: foldPlus(a[1], -1), by: { k: 'num', v: 1 }, body };
    }
    return { k: 'foreach', var: name, list: iter, body };
  }

  // ---- expressions ----------------------------------------------------------------

  expr(): Ex {
    const start = this.p;
    if (this.isKw('lambda')) throw new ParseError('lambda hat noch keinen Block.', this.tok.s);
    const a = this.orTest();
    if (this.isKw('if')) {
      this.p++;
      const cond = this.orTest();
      this.expectKw('else');
      const b = this.expr();
      return this.mk({ k: 'cond', cond, a, b }, start);
    }
    return a;
  }

  mk(e: Expr, start: number): Expr {
    if (e.k !== 'num' && e.k !== 'str' && e.k !== 'var' && e.k !== 'bool') e.src = this.srcFrom(start);
    return e;
  }

  orTest(): Ex {
    const start = this.p;
    let a = this.andTest();
    while (this.isKw('or')) {
      this.p++;
      a = this.mk({ k: 'bin', op: 'OR', a, b: this.andTest() }, start);
    }
    return a;
  }

  andTest(): Ex {
    const start = this.p;
    let a = this.notTest();
    while (this.isKw('and')) {
      this.p++;
      a = this.mk({ k: 'bin', op: 'AND', a, b: this.notTest() }, start);
    }
    return a;
  }

  notTest(): Ex {
    const start = this.p;
    if (this.isKw('not')) {
      this.p++;
      return this.mk({ k: 'not', a: this.notTest() }, start);
    }
    return this.comparison();
  }

  comparison(): Ex {
    const start = this.p;
    const first = this.bitOr();
    const parts: Ex[] = [];
    let left = first;
    while (true) {
      let op: string | null = null;
      for (const o of ['==', '!=', '<=', '>=', '<', '>']) if (this.is(o)) op = o;
      if (op) this.p++;
      else if (this.isKw('in')) {
        this.p++;
        op = 'in';
      } else if (this.isKw('not') && this.peek().t === 'name' && this.peek().v === 'in') {
        this.p += 2;
        op = 'not in';
      } else if (this.isKw('is')) {
        this.p++;
        op = this.eatKw('not') ? '!=' : '==';
      } else break;
      const right = this.bitOr();
      let e: Expr;
      if (op === 'in') e = { k: 'pin', a: left, b: right };
      else if (op === 'not in') e = { k: 'not', a: { k: 'pin', a: left, b: right } };
      else e = { k: 'bin', op: ({ '==': 'EQ', '!=': 'NEQ', '<': 'LT', '<=': 'LTE', '>': 'GT', '>=': 'GTE' } as any)[op], a: left, b: right };
      parts.push(this.mk(e, start));
      left = right;
    }
    if (!parts.length) return first;
    return parts.reduce((acc, p) => this.mk({ k: 'bin', op: 'AND', a: acc, b: p }, start));
  }

  bitOr(): Ex {
    const start = this.p;
    let a = this.arith();
    while (['|', '^', '&', '<<', '>>'].some((o) => this.is(o))) {
      const op = this.toks[this.p++].v;
      a = this.mk({ k: 'pbin', op, a, b: this.arith() }, start);
    }
    return a;
  }

  arith(): Ex {
    const start = this.p;
    let a = this.term();
    while (this.is('+') || this.is('-')) {
      const op = this.toks[this.p++].v === '+' ? 'ADD' : 'SUB';
      a = this.mk({ k: 'bin', op, a, b: this.term() }, start);
    }
    return a;
  }

  term(): Ex {
    const start = this.p;
    let a = this.factor();
    while (['*', '/', '//', '%', '@'].some((o) => this.is(o))) {
      const t = this.toks[this.p++].v;
      if (t === '@') throw new ParseError('@ hat noch keinen Block.', this.tok.s);
      const op = ({ '*': 'MUL', '/': 'DIV', '//': 'IDIV', '%': 'MOD' } as any)[t];
      a = this.mk({ k: 'bin', op, a, b: this.factor() }, start);
    }
    return a;
  }

  factor(): Ex {
    const start = this.p;
    if (this.is('-')) {
      this.p++;
      const a = this.factor();
      if (a?.k === 'num') return { ...a, v: -a.v };
      return this.mk({ k: 'math', fn: 'neg', a }, start);
    }
    if (this.is('+')) {
      this.p++;
      return this.factor();
    }
    if (this.is('~')) {
      this.p++;
      return this.mk({ k: 'punary', op: '~', a: this.factor() }, start);
    }
    return this.power();
  }

  power(): Ex {
    const start = this.p;
    const base = this.primary();
    if (this.is('**')) {
      this.p++;
      const exp = this.factor();
      if (base?.k === 'num' && base.v === 10) return this.mk({ k: 'math', fn: 'pow10', a: exp }, start);
      return this.mk({ k: 'bin', op: 'POW', a: base, b: exp }, start);
    }
    return base;
  }

  primary(): Ex {
    const start = this.p;
    let e = this.atom();
    while (true) {
      if (this.is('(')) {
        this.p++;
        const args: Ex[] = [];
        const kwargs: Record<string, Expr> = {};
        let hasKw = false;
        while (!this.is(')')) {
          if (this.is('*') || this.is('**')) throw new ParseError('*args hat noch keinen Block.', this.tok.s);
          if (this.cur() === 'name' && this.peek().t === 'op' && this.peek().v === '=') {
            const k = this.name();
            this.p++;
            kwargs[k] = this.expr()!;
            hasKw = true;
          } else {
            const save = this.p;
            const a = this.expr();
            if (this.isKw('for')) {
              this.p = save;
              throw new ParseError('Generator-Ausdrücke haben noch keinen Block.', this.tok.s);
            }
            args.push(a);
          }
          if (!this.eat(',')) break;
        }
        this.expect(')');
        e = this.mk({ k: 'pcall', callee: e!, args, ...(hasKw ? { kwargs } : {}) }, start);
      } else if (this.is('[')) {
        this.p++;
        let from: Ex = null;
        if (!this.is(':')) from = this.expr();
        if (this.is(':')) {
          this.p++;
          const to = this.is(']') || this.is(':') ? null : this.expr();
          let step: Ex = null;
          if (this.eat(':')) step = this.is(']') ? null : this.expr();
          this.expect(']');
          e = this.mk({ k: 'pslice', obj: e, from, to, step }, start);
        } else {
          this.expect(']');
          e = this.mk({ k: 'index', list: e, index: from }, start);
        }
      } else if (this.is('.')) {
        this.p++;
        const n = this.name();
        e = this.mk({ k: 'member', obj: e, name: n }, start);
      } else break;
    }
    return e;
  }

  atom(): Ex {
    const t = this.tok;
    const start = this.p;
    if (t.t === 'num') {
      this.p++;
      const text = t.v.replace(/_/g, '');
      if (/[jJ]$/.test(text)) throw new ParseError('Komplexe Zahlen haben noch keinen Block.', t.s);
      const v = /^0[xob]/i.test(text) ? Number(text) : parseFloat(text);
      return /[.eE]/.test(text) && !/^0x/i.test(text) ? { k: 'num', v, float: true } : { k: 'num', v };
    }
    if (t.t === 'str') {
      const parts: Ex[] = [];
      while (this.cur() === 'str') {
        const st = this.toks[this.p++];
        if (st.x?.prefix.includes('f')) parts.push(...this.fstring(st));
        else if (st.x?.prefix.includes('b')) throw new ParseError('Bytes haben noch keinen Block.', st.s);
        else parts.push({ k: 'str', v: st.v });
      }
      const merged = mergeStrings(parts);
      if (merged.length === 1 && merged[0]?.k === 'str') return merged[0];
      return this.mk({ k: 'join', parts: merged }, start);
    }
    if (t.t === 'name') {
      if (t.v === 'True' || t.v === 'False') {
        this.p++;
        return { k: 'bool', v: t.v === 'True' };
      }
      if (t.v === 'None') throw new ParseError('None hat noch keinen Block.', t.s);
      return { k: 'var', name: this.name() };
    }
    if (this.is('(')) {
      this.p++;
      if (this.is(')')) {
        this.p++;
        return this.mk({ k: 'list', items: [] }, start);
      }
      const e = this.expr();
      if (this.is(',')) {
        // tuple -> list
        const items: Ex[] = [e];
        while (this.eat(',')) {
          if (this.is(')')) break;
          items.push(this.expr());
        }
        this.expect(')');
        return this.mk({ k: 'list', items }, start);
      }
      this.expect(')');
      return e;
    }
    if (this.is('[')) {
      this.p++;
      const items: Ex[] = [];
      while (!this.is(']')) {
        items.push(this.expr());
        if (this.isKw('for')) throw new ParseError('Listen-Abstraktionen haben hier noch keinen Block.', this.tok.s);
        if (!this.eat(',')) break;
      }
      this.expect(']');
      return this.mk({ k: 'list', items }, start);
    }
    if (this.is('{')) {
      this.p++;
      const entries: { key: Ex; value: Ex }[] = [];
      while (!this.is('}')) {
        const key = this.expr();
        if (!this.is(':')) throw new ParseError('Mengen (set) haben noch keinen Block.', this.tok.s);
        this.p++;
        const value = this.expr();
        if (this.isKw('for')) throw new ParseError('Dictionary-Abstraktionen haben noch keinen Block.', this.tok.s);
        entries.push({ key, value });
        if (!this.eat(',')) break;
      }
      this.expect('}');
      return this.mk({ k: 'dict', entries }, start);
    }
    throw new ParseError(`Unerwartetes "${t.v || t.t}".`, t.s);
  }

  fstring(tok: Token): Ex[] {
    const raw: string = tok.x.raw;
    const parts: Ex[] = [];
    let text = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '{' && raw[i + 1] === '{') {
        text += '{';
        i++;
      } else if (c === '}' && raw[i + 1] === '}') {
        text += '}';
        i++;
      } else if (c === '{') {
        if (text) parts.push({ k: 'str', v: tok.x.prefix.includes('r') ? text : unescape(text) });
        text = '';
        let depth = 1;
        let j = i + 1;
        while (j < raw.length && depth > 0) {
          if (raw[j] === '{') depth++;
          if (raw[j] === '}') depth--;
          if (depth > 0) j++;
        }
        const inner = raw.slice(i + 1, j);
        if (/![rsa]$|:[^\]\)]*$/.test(inner) && !/\[.*:.*\]/.test(inner)) throw new ParseError('Formatangaben in f-Strings haben noch keinen Block.', tok.s);
        parts.push(parsePythonExpr(inner.replace(/=$/, '')));
        i = j;
      } else text += c;
    }
    if (text) parts.push({ k: 'str', v: tok.x.prefix.includes('r') ? text : unescape(text) });
    return parts;
  }
}

function mergeStrings(parts: Ex[]): Ex[] {
  const out: Ex[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (p?.k === 'str' && last?.k === 'str') out[out.length - 1] = { k: 'str', v: last.v + p.v };
    else out.push(p);
  }
  return out;
}

function mentions(e: Ex, name: string): boolean {
  return JSON.stringify(e ?? null).includes(`"k":"var","name":${JSON.stringify(name)}`);
}

function renameVar(e: Ex, from: string, to: string): Ex {
  return mapTree(e, (x) => (x.k === 'var' && x.name === from ? { k: 'var', name: to } : undefined));
}

function containsContinue(body: Stmt[]): boolean {
  let found = false;
  const visit = (list: Stmt[]) =>
    list.forEach((s) => {
      if (s.k === 'continue') found = true;
      if (s.k === 'if') {
        s.branches.forEach((b) => visit(b.body));
        if (s.else) visit(s.else);
      }
      if (s.k === 'try') {
        visit(s.body);
        visit(s.handler);
      }
    });
  visit(body);
  return found;
}

function usesName(body: Stmt[], name: string): boolean {
  let used = false;
  walkAllExprs(body, (e) => {
    if (e.k === 'var' && e.name === name) used = true;
  });
  if (assignedNames(body).has(name)) used = true;
  return used;
}

export function parsePythonExpr(code: string): Expr {
  const p = new PyParser(code, tokenizePython(code));
  const e = p.expr();
  if (!e) throw new ParseError('Ausdruck erwartet.', 0);
  return e;
}

export function parsePython(src: string): ParseResult {
  let toks: Token[];
  try {
    toks = tokenizePython(src);
  } catch (err) {
    if (err instanceof ParseError) {
      return { program: { main: [rawStmt(src, 'python')], functions: [] }, diagnostics: [{ message: err.message, line: lineOf(src, err.pos) }] };
    }
    throw err;
  }
  const parser = new PyParser(src, toks);
  const stmts = parser.parseFile();
  const functions: FunctionDef[] = [];
  let main: Stmt[] = [];
  const meta: Program['meta'] = { locals: {} };
  let pending: string[] = [];
  const flush = () => {
    for (const text of pending) main.push({ k: 'comment', text });
    pending = [];
  };
  for (const s of stmts) {
    if (s.k === 'comment') {
      pending.push(s.text);
      continue;
    }
    if (s.k === 'raw' && s.src === '__def__') {
      const { name, params } = JSON.parse(s.id!);
      const body: Stmt[] = (s as any).body;
      const defaults: Ex[] = (s as any).defaults;
      const returns = hasReturnValue(body);
      functions.push({ name, params, body, returns, ...(pending.length ? { comment: pending.join('\n') } : {}), ...(defaults.length ? { defaults } : {}) });
      pending = [];
      const globals = parser.globalsDecl.get(name) ?? new Set();
      meta.locals![name] = [...assignedNames(body)].filter((n) => !globals.has(n) && !params.includes(n));
    } else if (isMainGuard(s)) {
      flush();
      main.push(...(s as any).branches[0].body);
    } else {
      flush();
      main.push(s);
    }
  }
  flush();
  // "def main(): ... ; main()" -> use the body of main() as the start block
  const mainFn = functions.find((f) => f.name === 'main' && f.params.length === 0 && !f.returns);
  if (mainFn && main.length === 1 && main[0].k === 'pexpr' && main[0].e.k === 'pcall' && main[0].e.callee.k === 'var' && main[0].e.callee.name === 'main') {
    main = mainFn.body;
    functions.splice(functions.indexOf(mainFn), 1);
  }
  meta.imports = parser.imports;
  const program: Program = { main, functions, meta };
  return normalize(program, 'python');
}

function isMainGuard(s: Stmt): boolean {
  if (s.k !== 'if' || s.branches.length !== 1 || s.else) return false;
  const c = s.branches[0].cond;
  return c?.k === 'bin' && c.op === 'EQ' && c.a?.k === 'var' && c.a.name === '__name__' && c.b?.k === 'str' && c.b.v === '__main__';
}

export function hasReturnValue(body: Stmt[]): boolean {
  let found = false;
  walkStmts(body, (s) => {
    if (s.k === 'return' && s.value) found = true;
  });
  return found;
}
