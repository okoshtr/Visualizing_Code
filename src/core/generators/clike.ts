// Shared generator for the C-like languages: Java, C#, C++ and JavaScript.

import { MAIN, type PlaceInfo, type Ty, dictParts, elemOf, isDict, isList } from '../analysis';
import type { ClassDef, Ex, Expr, FunctionDef, Stmt } from '../ir';
import { CTOR, methodPlace } from '../ir';
import { stmtExprs, walkExpr } from '../ir';
import { ATOM, BaseGen, type Code, foldPlus } from './base';

export const C = { cond: 1, or: 2, and: 3, eq: 5, rel: 6, add: 7, mul: 8, unary: 9, pow: 10 };

const BIN: Record<string, [string, number]> = {
  ADD: ['+', C.add],
  SUB: ['-', C.add],
  MUL: ['*', C.mul],
  DIV: ['/', C.mul],
  MOD: ['%', C.mul],
  EQ: ['==', C.eq],
  NEQ: ['!=', C.eq],
  LT: ['<', C.rel],
  LTE: ['<=', C.rel],
  GT: ['>', C.rel],
  GTE: ['>=', C.rel],
  AND: ['&&', C.and],
  OR: ['||', C.or],
};

interface DeclPlan {
  inline: Set<string>;
  top: string[];
  declared: Set<string>;
}

export abstract class CLikeGen extends BaseGen {
  protected readonly commentPrefix = '//';
  protected allman = false;
  protected typed = true;
  private plan: DeclPlan = { inline: new Set(), top: [], declared: new Set() };
  private counters: string[] = [];
  /** > 0 while generating the body of a "versuche" block. */
  protected tryDepth = 0;

  // ---- language hooks -------------------------------------------------------------
  /** Type name for declarations; ctx 'param' is used for function parameters. */
  protected abstract typeName(t: Ty, ctx?: 'decl' | 'param' | 'ret'): string;
  protected abstract printCode(value: Ex, newline: boolean): string;
  protected abstract listLiteral(e: Expr & { k: 'list' }, elem: Ty, inDecl: boolean): Code;
  protected abstract lenCode(e: Expr & { k: 'len' }, ofList: boolean): Code;
  protected abstract indexCode(list: Ex, index: Ex): Code;
  protected abstract listAddCode(list: Ex, value: Ex): string;
  protected abstract listSetCode(list: Ex, index: Ex, value: Ex): string;
  protected abstract askCode(prompt: Ex, as: 'text' | 'int' | 'float'): Code;
  protected abstract convertCode(e: Expr & { k: 'convert' }): Code;
  protected abstract mathCode(e: Expr & { k: 'math' }): Code;
  protected abstract randomCode(from: Ex, to: Ex): Code;
  protected abstract joinCode(parts: Ex[]): Code;
  protected abstract foreachHead(type: string, name: string, list: string): string;
  protected declKeyword(t: Ty): string {
    return this.typeName(t, 'decl');
  }

  protected stringLiteral(s: string): string {
    return JSON.stringify(s);
  }

  // ---- blocks -----------------------------------------------------------------------

  protected open(head: string, fn: () => void, close = true) {
    if (this.allman) {
      this.emit(head);
      this.emit('{');
    } else this.emit(`${head} {`);
    this.indented(fn);
    if (close) this.emit('}');
  }

  /** Emits a function body with declarations. */
  protected functionBody(place: PlaceInfo, extraTop: string[] = []) {
    const saved = this.place;
    this.place = place.name;
    this.plan = this.makePlan(place);
    for (const line of extraTop) this.emit(line);
    for (const name of this.plan.top) {
      const t = this.varType(name);
      this.emit(`${this.declKeyword(t)} ${this.id(name)}${this.defaultInit(t)};`);
      this.plan.declared.add(name);
    }
    this.body(place.body);
    this.place = saved;
  }

  /** " = 0" etc. for a declaration without a value. */
  protected defaultInit(t: Ty): string {
    const d = this.defaultValue(t);
    return d === null ? '' : ` = ${d}`;
  }

  protected defaultValue(t: Ty): string | null {
    if (t === 'int') return '0';
    if (t === 'double') return '0.0';
    if (t === 'string') return '""';
    if (t === 'bool') return 'false';
    if (isList(t)) return this.listLiteral({ k: 'list', items: [] }, elemOf(t), true)[0];
    if (isDict(t)) return this.dictLiteral({ k: 'dict', entries: [] }, ...dictParts(t))[0];
    if (t.startsWith('obj<')) return this.lang === 'cpp' ? null : 'null';
    return null;
  }

  // ---- errors & dictionaries (language hooks) ------------------------------------------
  protected abstract catchDecl(name: string): string;
  protected abstract errorMessage(name: string): Code;
  protected abstract throwCode(message: string): string;
  protected abstract dictLiteral(e: Expr & { k: 'dict' }, keyType: Ty, valueType: Ty): Code;
  protected abstract dgetCode(dict: Ex, key: Ex): Code;
  protected abstract dsetCode(dict: Ex, key: Ex, value: Ex): string;
  /** Code that iterates over the keys of a dictionary. */
  protected abstract keysCode(dict: Ex): string;

  /** Locals that are declared inside this place (JS main also declares the globals it uses). */
  protected declaredLocals(place: PlaceInfo): Set<string> {
    return new Set(place.locals);
  }

  private makePlan(place: PlaceInfo): DeclPlan {
    const candidates = this.declaredLocals(place);
    for (const n of place.loopOnly) if (!this.a.globals.has(n)) candidates.delete(n);
    const inline = new Set<string>();
    const seen = new Set<string>();
    const visit = (stmts: Stmt[], depth: number) => {
      for (const s of stmts) {
        const mentioned = new Set<string>();
        for (const e of stmtExprs(s)) walkExpr(e, (x) => x.k === 'var' && mentioned.add(x.name));
        if (s.k === 'set' && depth === 0 && !seen.has(s.name) && !mentioned.has(s.name) && candidates.has(s.name)) {
          inline.add(s.name);
        }
        if (s.k === 'set' || s.k === 'change') mentioned.add(s.name);
        if (s.k === 'for' || s.k === 'foreach') mentioned.add(s.var);
        for (const n of mentioned) seen.add(n);
        if (s.k === 'if') {
          for (const b of s.branches) visit(b.body, depth + 1);
          if (s.else) visit(s.else, depth + 1);
        } else if (s.k === 'repeat' || s.k === 'while' || s.k === 'for' || s.k === 'foreach') visit(s.body, depth + 1);
      }
    };
    visit(place.body, 0);
    const top = [...candidates].filter((n) => !inline.has(n) && !place.params.includes(n));
    return { inline, top, declared: new Set() };
  }

  // ---- statements ---------------------------------------------------------------------

  protected stmt(s: Stmt): void {
    switch (s.k) {
      case 'print':
        if (s.newline && s.value?.k === 'str' && s.value.v === '') this.emit(this.emptyLine() + ';');
        else this.emit(this.printCode(s.value, s.newline) + ';');
        break;
      case 'set': {
        const name = this.id(s.name);
        if (this.plan.inline.has(s.name) && !this.plan.declared.has(s.name)) {
          this.plan.declared.add(s.name);
          const t = this.varType(s.name);
          const value = s.value?.k === 'list' && this.typed ? this.listLiteral(s.value, elemOf(t), true)[0] : this.sub(s.value, 0, this.placeholder(t));
          this.emit(`${this.declKeyword(t)} ${name} = ${value};`);
        } else {
          const t = this.varType(s.name);
          const value = s.value?.k === 'list' && this.typed ? this.listLiteral(s.value, elemOf(t), false)[0] : this.sub(s.value, 0, this.placeholder(t));
          this.emit(`${name} = ${value};`);
        }
        break;
      }
      case 'change': {
        const name = this.id(s.name);
        if (s.by?.k === 'num' && Math.abs(s.by.v) === 1 && !s.by.float) this.emit(`${name}${s.by.v > 0 ? '++' : '--'};`);
        else if (s.by?.k === 'num' && s.by.v < 0) this.emit(`${name} -= ${this.numberLiteral(-s.by.v, s.by.float)};`);
        else this.emit(`${name} += ${this.sub(s.by, 0, { k: 'num', v: 1 })};`);
        break;
      }
      case 'if':
        this.ifStmt(s);
        break;
      case 'repeat': {
        const i = this.counter();
        const n = this.sub(s.times, C.rel + 1, { k: 'num', v: 10 });
        this.open(`for (${this.typed ? this.typeName('int', 'decl') : 'let'} ${i} = 0; ${i} < ${n}; ${i}++)`, () => this.body(s.body));
        this.counters.pop();
        break;
      }
      case 'while': {
        const cond = s.until ? `!${this.sub(s.cond, C.unary, { k: 'bool', v: false })}` : this.sub(s.cond, 0, { k: 'bool', v: false });
        if (s.post) {
          this.open('do', () => this.body(s.body), false);
          this.emit(`} while (${cond});`);
        } else this.open(`while (${cond})`, () => this.body(s.body));
        break;
      }
      case 'try':
        this.tryDepth++;
        try {
          this.open('try', () => this.body(s.body), false);
        } finally {
          this.tryDepth--;
        }
        this.withCatch((name) => {
          if (this.allman) {
            this.emit('}');
            this.open(`catch (${this.catchDecl(name)})`, () => this.body(s.handler));
          } else {
            this.emit(`} catch (${this.catchDecl(name)}) {`);
            this.indented(() => this.body(s.handler));
            this.emit('}');
          }
        });
        break;
      case 'throw':
        this.emit(this.throwCode(this.sub(s.value, 0, { k: 'str', v: 'Fehler' })) + ';');
        break;
      case 'dset':
        this.emit(this.dsetCode(s.dict, s.key, s.value) + ';');
        break;
      case 'for':
        this.forStmt(s);
        break;
      case 'foreach': {
        const loopOnly = this.a.place(this.place).loopOnly.has(s.var) && !this.a.globals.has(s.var);
        const t = this.varType(s.var);
        const list = isDict(this.typeOf(s.list)) ? this.keysCode(s.list) : this.sub(s.list, 0, { k: 'list', items: [] });
        if (loopOnly) {
          this.open(this.foreachHead(this.declKeyword(t), this.id(s.var), list), () => this.body(s.body));
        } else if (!this.typed) {
          this.open(this.foreachHead('', this.id(s.var), list), () => this.body(s.body));
        } else {
          const tmp = this.fresh(`${this.id(s.var)}Wert`);
          this.open(this.foreachHead(this.declKeyword(t), tmp, list), () => {
            this.emit(`${this.id(s.var)} = ${tmp};`);
            this.body(s.body);
          });
        }
        break;
      }
      case 'break':
        this.emit('break;');
        break;
      case 'continue':
        this.emit('continue;');
        break;
      case 'listadd':
        this.emit(this.listAddCode(s.list, s.value) + ';');
        break;
      case 'listset':
        this.emit(this.listSetCode(s.list, s.index, s.value) + ';');
        break;
      case 'callstmt':
        this.emit(`${this.id(s.name)}(${this.args(s.args)});`);
        break;
      case 'libstmt':
        this.emit(this.libCode(s.lib, s.fn, s.args)[0] + ';');
        break;
      case 'methodstmt':
        this.emit(`${this.memberPrefix(s.obj)}${s.name}(${this.args(s.args)});`);
        break;
      case 'fset':
        this.emit(`${this.memberPrefix(s.obj)}${s.name} = ${this.sub(s.value)};`);
        break;
      case 'return':
        if (this.place === MAIN) this.emit(this.mainReturn());
        else this.emit(s.value ? `return ${this.sub(s.value)};` : 'return;');
        break;
      case 'comment':
        this.comment(s.text);
        break;
      case 'raw':
        this.rawStmt(s.code, s.lang);
        break;
      case 'pexpr':
        this.emit(this.sub(s.e) + ';');
        break;
    }
  }

  protected mainReturn(): string {
    return 'return;';
  }

  protected abstract emptyLine(): string;

  protected placeholder(t: Ty): Expr {
    if (t === 'string') return { k: 'str', v: '' };
    if (t === 'bool') return { k: 'bool', v: false };
    if (isList(t)) return { k: 'list', items: [] };
    return { k: 'num', v: 0 };
  }

  private ifStmt(s: Stmt & { k: 'if' }) {
    s.branches.forEach((b, i) => {
      const cond = this.sub(b.cond, 0, { k: 'bool', v: false });
      const head = i === 0 ? `if (${cond})` : `else if (${cond})`;
      if (i > 0 && !this.allman) {
        // "} else if (...) {"
        this.lines[this.lines.length - 1] += ` ${head} {`;
        this.indented(() => this.body(b.body));
        this.emit('}');
      } else this.open(head, () => this.body(b.body));
    });
    if (s.else) {
      if (this.allman) this.open('else', () => this.body(s.else!));
      else {
        this.lines[this.lines.length - 1] += ' else {';
        this.indented(() => this.body(s.else!));
        this.emit('}');
      }
    }
  }

  private counter(): string {
    const candidates = ['i', 'j', 'k', 'l', 'm', 'n'];
    let name = candidates.find((c) => !this.a.allNames.has(c) && !this.counters.includes(c));
    if (!name) name = this.fresh('zaehler');
    this.counters.push(name);
    return name;
  }

  private forStmt(s: Stmt & { k: 'for' }) {
    const v = this.id(s.var);
    const place = this.a.place(this.place);
    const declare = place.loopOnly.has(s.var) && !this.a.globals.has(s.var);
    const t = this.varType(s.var);
    const init = `${declare ? (this.typed ? this.typeName(t, 'decl') : 'let') + ' ' : ''}${v} = ${this.sub(s.from, 0, { k: 'num', v: 0 })}`;
    const { step, positive } = this.loopStep(s.by);
    let cond: string;
    let update: string;
    if (step === null) {
      const by = this.sub(s.by, C.rel + 1);
      cond = `${by} > 0 ? ${v} <= ${this.sub(s.to, C.rel + 1)} : ${v} >= ${this.sub(s.to, C.rel + 1)}`;
      update = `${v} += ${this.sub(s.by, 0)}`;
    } else {
      const to = s.to ?? { k: 'num', v: 0 };
      const plus = foldPlus(to, positive ? 1 : -1);
      // Prefer "i < n" over "i <= n - 1".
      // "i < n" for loops from 0 and for "bis n - 1"; otherwise "i <= n"
      const fromZero = s.from?.k === 'num' && s.from.v === 0;
      const nicer = !!plus && (plus.k === 'var' || (plus.k === 'num' && fromZero));
      if (positive) cond = nicer ? `${v} < ${this.sub(plus, C.rel + 1)}` : `${v} <= ${this.sub(to, C.rel + 1)}`;
      else cond = `${v} >= ${this.sub(to, C.rel + 1)}`;
      if (step === 1) update = `${v}++`;
      else if (step === -1) update = `${v}--`;
      else update = positive ? `${v} += ${this.numberLiteral(step)}` : `${v} -= ${this.numberLiteral(-step)}`;
    }
    this.open(`for (${init}; ${cond}; ${update})`, () => this.body(s.body));
  }

  // ---- functions -----------------------------------------------------------------------

  protected functionHead(f: FunctionDef, prefix: string): string {
    const ret = f.returns ? this.typeName(this.a.returnType(f.name), 'ret') : 'void';
    const types = this.a.paramTypes(f.name);
    const params = f.params.map((p, i) => `${this.typeName(types[i], 'param')} ${this.id(p)}`).join(', ');
    return `${prefix}${ret} ${this.id(f.name)}(${params})`;
  }

  // ---- classes ----------------------------------------------------------------------------

  protected classHead(c: ClassDef): string {
    return `class ${c.name}`;
  }
  protected classEnd(): string {
    return '}';
  }
  /** Declaration of a property (null: properties are set in the constructor, as in JavaScript). */
  protected fieldDecl(t: Ty, name: string, value: string | null): string | null {
    return `${this.typeName(t, 'decl')} ${name}${value !== null ? ` = ${value}` : this.defaultInit(t)};`;
  }
  protected ctorHead(c: ClassDef, params: string): string {
    return `${c.name}(${params})`;
  }
  protected methodHead(_c: ClassDef, m: FunctionDef, ret: string, params: string): string {
    return `${ret} ${m.name}(${params})`;
  }
  /** "obj." / "this->" before a property or method name. */
  protected memberPrefix(obj: Ex): string {
    return `${this.sub(obj, ATOM)}.`;
  }

  protected paramList(place: string, params: string[]): string {
    const types = this.a.paramTypes(place);
    return params.map((p, i) => (this.typed ? `${this.typeName(types[i], 'param')} ${this.id(p)}` : this.id(p))).join(', ');
  }

  protected emitClass(c: ClassDef) {
    this.withId(c.id, () => {
      if (c.comment) this.comment(c.comment);
      this.open(this.classHead(c), () => {
        const ctorPlace = methodPlace(c.name, CTOR);
        this.place = ctorPlace;
        const fieldInits: string[] = [];
        const start = this.lines.length;
        for (const name of this.classFields(c)) {
          const t = this.a.fieldType(c.name, name);
          const f = c.fields.find((x) => x.name === name);
          const value = f?.value ? this.sub(f.value) : null;
          const line = this.fieldDecl(t, name, value);
          if (line) this.emit(line);
          // JavaScript: properties are created in the constructor (only the ones with a start value)
          else if (f) fieldInits.push(`this.${name} = ${value ?? this.defaultValue(t) ?? 'null'};`);
        }
        const gap = () => {
          if (this.lines.length > start) this.blank();
        };
        if (c.ctorParams.length || c.ctor.length || fieldInits.length) {
          gap();
          this.open(this.ctorHead(c, this.paramList(ctorPlace, c.ctorParams)), () => {
            for (const l of fieldInits) this.emit(l);
            this.functionBody(this.a.place(ctorPlace));
          });
          if (c.ctorParams.length && this.lang === 'cpp') this.emit(`${c.name}() {}`);
        }
        for (const m of c.methods) {
          const place = methodPlace(c.name, m.name);
          this.place = place;
          gap();
          this.withId(m.id, () => {
            if (m.comment) this.comment(m.comment);
            const ret = m.returns ? this.typeName(this.a.returnType(place), 'ret') : 'void';
            this.open(this.methodHead(c, m, ret, this.paramList(place, m.params)), () => this.functionBody(this.a.place(place)));
          });
        }
      }, false);
      this.emit(this.classEnd());
    });
    this.place = MAIN;
  }

  protected emitFunction(f: FunctionDef, prefix: string) {
    this.place = f.name;
    this.withId(f.id, () => {
      if (f.comment) this.comment(f.comment);
      this.open(this.functionHead(f, prefix), () => this.functionBody(this.a.place(f.name)));
    });
    this.place = MAIN;
  }

  // ---- expressions --------------------------------------------------------------------

  protected eqCode(a: Ex, b: Ex, neg: boolean): Code {
    return [`${this.sub(a, C.eq + 1)} ${neg ? '!=' : '=='} ${this.sub(b, C.eq + 1)}`, C.eq];
  }

  protected divCode(a: Ex, b: Ex): Code {
    if (this.bothInt(a, b)) return [`(double) ${this.sub(a, C.unary)} / ${this.sub(b, C.mul + 1)}`, C.mul];
    return [`${this.sub(a, C.mul)} / ${this.sub(b, C.mul + 1)}`, C.mul];
  }

  /** Integer division. The block rounds down; e.trunc means "toward zero" (C-style). */
  protected idivCode(e: Expr & { k: 'bin' }): Code {
    const { a, b } = e;
    if (this.bothInt(a, b)) {
      if (this.nativeDivOk(e, true)) return [`${this.sub(a, C.mul)} / ${this.sub(b, C.mul + 1)}`, C.mul];
      return this.floorDivInts(a, b);
    }
    if (e.trunc) return [`(int) (${this.sub(a, C.mul)} / ${this.sub(b, C.mul + 1)})`, C.unary];
    return [`(int) ${this.floorFn()}(${this.sub(a, C.mul)} / ${this.sub(b, C.mul + 1)})`, C.unary];
  }

  protected modCode(e: Expr & { k: 'bin' }): Code {
    const { a, b } = e;
    if (this.nativeDivOk(e, true)) return [`${this.sub(a, C.mul)} % ${this.sub(b, C.mul + 1)}`, C.mul];
    const x = this.sub(a, C.mul);
    const y = this.sub(b, C.mul + 1);
    return [`((${x} % ${y}) + ${y}) % ${y}`, C.mul];
  }

  /** Name of the "round down" function (Math.Floor, floor, ...). */
  protected floorFn(): string {
    return 'Math.Floor';
  }

  protected floorDivInts(a: Ex, b: Ex): Code {
    return [`(int) ${this.floorFn()}((double) ${this.sub(a, C.unary)} / ${this.sub(b, C.mul + 1)})`, C.unary];
  }

  protected abstract powCode(a: Ex, b: Ex): Code;

  /** Range size b - a + 1 with constant folding. */
  protected rangeSize(from: Ex, to: Ex): Ex {
    const a = from ?? { k: 'num', v: 1 };
    const b = to ?? { k: 'num', v: 10 };
    if (a.k === 'num') return foldPlus(b, 1 - a.v);
    return foldPlus({ k: 'bin', op: 'SUB', a: b, b: a }, 1);
  }

  protected expr(e: Expr): Code {
    switch (e.k) {
      case 'num':
        return [this.numberLiteral(e.v, e.float), e.v < 0 ? C.unary : ATOM];
      case 'str':
        return [this.stringLiteral(e.v), ATOM];
      case 'bool':
        return [e.v ? 'true' : 'false', ATOM];
      case 'var':
        return [this.id(e.name), ATOM];
      case 'bin':
        switch (e.op) {
          case 'ADD':
            if (this.isStringy(e.a) || this.isStringy(e.b)) return this.joinCode([e.a, e.b]);
            break;
          case 'DIV':
            return this.divCode(e.a, e.b);
          case 'IDIV':
            return this.idivCode(e);
          case 'MOD':
            return this.modCode(e);
          case 'POW':
            if (this.typeOf(e) === 'int' && this.lang !== 'javascript') {
              const [code] = this.powCode(e.a, e.b);
              return [`(int) ${code}`, C.unary];
            }
            return this.powCode(e.a, e.b);
          case 'EQ':
          case 'NEQ':
            return this.eqCode(e.a, e.b, e.op === 'NEQ');
        }
        {
          const [op, prec] = BIN[e.op];
          const nonAssoc = prec === C.eq || prec === C.rel;
          return [`${this.sub(e.a, nonAssoc ? prec + 1 : prec)} ${op} ${this.sub(e.b, prec + 1)}`, prec];
        }
      case 'not':
        return [`!${this.sub(e.a, C.unary, { k: 'bool', v: false })}`, C.unary];
      case 'math':
        return this.mathCode(e);
      case 'random':
        return this.randomCode(e.from, e.to);
      case 'join':
        return this.joinCode(e.parts);
      case 'len': {
        const t = this.typeOf(e.a);
        return this.lenCode(e, e.of === 'list' || (e.of === 'auto' && isList(t)));
      }
      case 'ask':
        this.usesInput = true;
        return this.askCode(e.prompt, e.as);
      case 'convert':
        return this.convertCode(e);
      case 'list':
        return this.listLiteral(e, elemOf(this.typeOf(e)), false);
      case 'index':
        return this.indexCode(e.list, e.index);
      case 'call':
        return [`${this.id(e.name)}(${this.args(e.args)})`, ATOM];
      case 'lib':
        return this.libCode(e.lib, e.fn, e.args, e.get);
      case 'method':
        return [`${this.memberPrefix(e.obj)}${e.name}(${this.args(e.args)})`, ATOM];
      case 'member':
        return [`${this.memberPrefix(e.obj)}${e.name}`, ATOM];
      case 'self':
        return [this.lang === 'cpp' ? '(*this)' : 'this', this.lang === 'cpp' ? ATOM : ATOM];
      case 'new':
        return [`${this.lang === 'cpp' ? '' : 'new '}${e.cls}(${this.args(e.args)})`, ATOM];
      case 'cond':
        return [`${this.sub(e.cond, C.cond + 1)} ? ${this.sub(e.a, C.cond + 1)} : ${this.sub(e.b, C.cond)}`, C.cond];
      case 'errmsg': {
        const n = this.currentCatch();
        return n ? this.errorMessage(n) : ['""', ATOM];
      }
      case 'dict': {
        const [kt, vt] = dictParts(this.typeOf(e));
        return this.dictLiteral(e, kt, vt);
      }
      case 'dget':
        return this.dgetCode(e.dict, e.key);
      case 'raw':
        return this.rawCode(e.code, e.lang);
      default:
        this.warn(`Interner Fehler: unbekannter Ausdruck ${e.k}`);
        return ['0', ATOM];
    }
  }
}
