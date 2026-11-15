import { MAIN, type PlaceInfo, type Ty, isDict, isList, namesIn } from '../analysis';
import type { ClassDef, Ex, Expr, FunctionDef } from '../ir';
import { ATOM, type Code, type GenResult } from './base';
import { C, CLikeGen } from './clike';

export class JavaScriptGen extends CLikeGen {
  readonly lang = 'javascript' as const;
  protected readonly indentUnit = '  ';
  protected override typed = false;

  protected typeName(): string {
    return 'let';
  }

  protected defaultValue(t: Ty): string | null {
    if (t === 'double') return '0';
    if (isList(t)) return '[]';
    if (isDict(t)) return 'new Map()';
    return super.defaultValue(t);
  }

  protected declaredLocals(place: PlaceInfo): Set<string> {
    const set = new Set(place.locals);
    // The main program is top-level code: globals it uses are declared there.
    if (place.name === MAIN) for (const g of this.a.globals) if (this.usedInMain(g)) set.add(g);
    return set;
  }

  private usedInMain(name: string): boolean {
    return this.mentionsInMain.has(name);
  }

  private mentionsInMain = new Set<string>();

  protected printCode(value: Ex, newline: boolean): string {
    if (newline) return `console.log(${this.sub(value, 0, { k: 'str', v: '' })})`;
    const v = this.isStringy(value) ? this.sub(value, 0) : `String(${this.sub(value)})`;
    return `process.stdout.write(${v})`;
  }

  protected fieldDecl(): string | null {
    return null;
  }

  protected ctorHead(_c: ClassDef, params: string): string {
    return `constructor(${params})`;
  }

  protected methodHead(_c: ClassDef, m: FunctionDef, _ret: string, params: string): string {
    return `${m.name}(${params})`;
  }

  protected catchDecl(name: string): string {
    return name;
  }

  protected errorMessage(name: string): Code {
    return [`${name}.message`, ATOM];
  }

  protected throwCode(message: string): string {
    return `throw new Error(${message})`;
  }

  protected dictLiteral(e: Expr & { k: 'dict' }): Code {
    if (!e.entries.length) return ['new Map()', ATOM];
    return [`new Map([${e.entries.map((x) => `[${this.sub(x.key)}, ${this.sub(x.value)}]`).join(', ')}])`, ATOM];
  }

  protected dgetCode(dict: Ex, key: Ex): Code {
    return [`${this.sub(dict, ATOM)}.get(${this.sub(key)})`, ATOM];
  }

  protected dsetCode(dict: Ex, key: Ex, value: Ex): string {
    return `${this.sub(dict, ATOM)}.set(${this.sub(key)}, ${this.sub(value)})`;
  }

  protected keysCode(dict: Ex): string {
    return `${this.sub(dict, ATOM)}.keys()`;
  }

  protected emptyLine(): string {
    return 'console.log()';
  }

  protected listLiteral(e: Expr & { k: 'list' }): Code {
    return [`[${this.args(e.items)}]`, ATOM];
  }

  protected lenCode(e: Expr & { k: 'len' }): Code {
    return [`${this.sub(e.a, ATOM)}.length`, ATOM];
  }

  protected indexCode(list: Ex, index: Ex): Code {
    return [`${this.sub(list, ATOM)}[${this.sub(index, 0, { k: 'num', v: 0 })}]`, ATOM];
  }

  protected listAddCode(list: Ex, value: Ex): string {
    return `${this.sub(list, ATOM)}.push(${this.sub(value)})`;
  }

  protected listSetCode(list: Ex, index: Ex, value: Ex): string {
    return `${this.sub(list, ATOM)}[${this.sub(index)}] = ${this.sub(value)}`;
  }

  protected askCode(prompt: Ex, as: 'text' | 'int' | 'float'): Code {
    const call = `input(${this.sub(prompt, 0, { k: 'str', v: '' })})`;
    if (as === 'text') return [call, ATOM];
    return [`${this.parseFn(as)}(${call})`, ATOM];
  }

  /** parseInt / parseFloat do not raise errors; inside "versuche" a checking helper is used. */
  private parseFn(as: 'int' | 'float'): string {
    if (this.tryDepth > 0) {
      const name = as === 'int' ? 'toInt' : 'toFloat';
      this.useHelper(name);
      return name;
    }
    return as === 'int' ? 'parseInt' : 'parseFloat';
  }

  protected convertCode(e: Expr & { k: 'convert' }): Code {
    const t = this.typeOf(e.a);
    if (e.to === 'text') return t === 'string' ? this.expr(e.a!) : [`String(${this.sub(e.a)})`, ATOM];
    if (e.to === 'int') {
      if (t === 'int') return this.expr(e.a!);
      if (t === 'double') return [`Math.trunc(${this.sub(e.a)})`, ATOM];
      return [`${this.parseFn('int')}(${this.sub(e.a)})`, ATOM];
    }
    if (t === 'double' || t === 'int') return this.expr(e.a!);
    return [`${this.parseFn('float')}(${this.sub(e.a)})`, ATOM];
  }

  protected mathCode(e: Expr & { k: 'math' }): Code {
    const a = this.sub(e.a, 0);
    switch (e.fn) {
      case 'neg':
        return [`-${this.sub(e.a, C.unary)}`, C.unary];
      case 'pow10':
        return [`10 ** ${this.sub(e.a, C.pow)}`, C.pow];
      default:
        return [`Math.${{ sqrt: 'sqrt', abs: 'abs', ln: 'log', log10: 'log10', exp: 'exp', round: 'round', ceil: 'ceil', floor: 'floor' }[e.fn]}(${a})`, ATOM];
    }
  }

  protected randomCode(from: Ex, to: Ex): Code {
    const size = this.sub(this.rangeSize(from, to), C.mul + 1);
    const start = from ?? { k: 'num', v: 1 };
    const base = `Math.floor(Math.random() * ${size})`;
    if (start.k === 'num' && start.v === 0) return [base, ATOM];
    return [`${base} + ${this.sub(start, C.add + 1)}`, C.add];
  }

  protected joinCode(parts: Ex[]): Code {
    if (!parts.length) return ['""', ATOM];
    if (parts.length === 1) return this.isStringy(parts[0]) ? this.expr(parts[0]!) : [`String(${this.sub(parts[0])})`, ATOM];
    const codes = parts.map((p, i) => this.sub(p, i === 0 ? C.add : C.add + 1, { k: 'str', v: '' }));
    if (!this.isStringy(parts[0]) && !this.isStringy(parts[1])) codes.unshift('""');
    return [codes.join(' + '), C.add];
  }

  protected eqCode(a: Ex, b: Ex, neg: boolean): Code {
    return [`${this.sub(a, C.eq + 1)} ${neg ? '!==' : '==='} ${this.sub(b, C.eq + 1)}`, C.eq];
  }

  protected divCode(a: Ex, b: Ex): Code {
    return [`${this.sub(a, C.mul)} / ${this.sub(b, C.mul + 1)}`, C.mul];
  }

  protected idivCode(e: Expr & { k: 'bin' }): Code {
    const fn = e.trunc ? 'Math.trunc' : 'Math.floor';
    return [`${fn}(${this.sub(e.a, C.mul)} / ${this.sub(e.b, C.mul + 1)})`, ATOM];
  }

  protected powCode(a: Ex, b: Ex): Code {
    return [`${this.sub(a, C.pow + 1)} ** ${this.sub(b, C.pow)}`, C.pow];
  }

  protected foreachHead(type: string, name: string, list: string): string {
    return `for (${type ? 'const ' : ''}${name} of ${list})`;
  }

  protected mainReturn(): string {
    return 'process.exit(0);';
  }

  protected functionHead(f: FunctionDef): string {
    return `function ${this.id(f.name)}(${f.params.map((p) => this.id(p)).join(', ')})`;
  }

  generate(): GenResult {
    const main = this.a.place(MAIN);
    for (const n of namesIn(this.program.main ?? [])) this.mentionsInMain.add(n);

    const classes = this.classes.map((c) => this.capture(() => this.emitClass(c)));
    const fns = this.program.functions.map((f) => this.capture(() => this.emitFunction(f, '')));
    this.place = MAIN;
    const mainLines = this.capture(() => this.withId(this.program.mainId, () => this.functionBody(main)));
    const globals = this.capture(() => {
      for (const g of [...this.a.globals].sort()) {
        if (this.mentionsInMain.has(g)) continue;
        const t = this.a.varType(g, MAIN);
        this.emit(`let ${this.id(g)}${this.defaultInit(t)};`);
      }
    });
    const helpers = this.capture(() => {
      if (this.usesInput) {
        this.emit(`function input(prompt) {
  const fs = require("fs");
  process.stdout.write(prompt);
  const bytes = [];
  const buffer = Buffer.alloc(1);
  try {
    while (fs.readSync(0, buffer, 0, 1) > 0 && buffer[0] !== 10) bytes.push(buffer[0]);
  } catch (error) {}
  return Buffer.from(bytes).toString("utf8").replace("\\r", "");
}`);
        this.blank();
      }
      for (const h of this.helperCode()) {
        this.emit(h);
        this.blank();
      }
    });
    const out: string[] = [];
    for (const imp of this.program.meta?.imports ?? []) {
      if (imp.lang === 'javascript') out.push(`const ${imp.alias} = require(${JSON.stringify(imp.module)});`);
    }
    if (out.length) out.push('');
    for (const part of [globals, helpers, ...classes, ...fns]) if (part.length) out.push(...part, '');
    out.push(...mainLines);
    return this.result(out.join('\n'));
  }
}
