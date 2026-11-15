import { MAIN, type Ty, elemOf, isList } from '../analysis';
import type { Ex, Expr } from '../ir';
import { ATOM, type Code, type GenResult } from './base';
import { C, CLikeGen } from './clike';

export class CppGen extends CLikeGen {
  readonly lang = 'cpp' as const;
  protected readonly indentUnit = '    ';

  protected typeName(t: Ty, ctx: 'decl' | 'param' | 'ret' = 'decl'): string {
    if (isList(t)) return `vector<${this.typeName(elemOf(t), 'ret')}>${ctx === 'param' ? '&' : ''}`;
    const basic = { int: 'int', double: 'double', string: 'string', bool: 'bool' }[t];
    if (basic) return basic;
    if (ctx === 'decl') return 'auto';
    this.warn('C++ braucht feste Typen: eine Variable mit wechselnden Werten wurde als "string" angelegt.');
    return 'string';
  }

  protected defaultValue(t: Ty): string | null {
    if (isList(t)) return null;
    return super.defaultValue(t);
  }

  protected printCode(value: Ex, newline: boolean): string {
    const v = this.listsAsText(value);
    const parts = v?.k === 'join' ? v.parts : [v];
    const items = parts.map((p) => (this.typeOf(p) === 'bool' ? `(${this.sub(p, C.cond + 1)} ? "true" : "false")` : this.sub(p, C.add, { k: 'str', v: '' })));
    return `cout << ${items.join(' << ')}${newline ? ' << endl' : ''}`;
  }

  protected emptyLine(): string {
    return 'cout << endl';
  }

  protected listLiteral(e: Expr & { k: 'list' }, elem: Ty, inDecl: boolean): Code {
    const items = this.args(e.items);
    if (inDecl) return [`{${items}}`, ATOM];
    return [`vector<${this.typeName(elem === '?' ? 'int' : elem, 'ret')}>{${items}}`, ATOM];
  }

  protected lenCode(e: Expr & { k: 'len' }, ofList: boolean): Code {
    return [`(int) ${this.sub(e.a, ATOM)}.${ofList ? 'size' : 'length'}()`, C.unary];
  }

  protected indexCode(list: Ex, index: Ex): Code {
    if (this.typeOf(list) === 'string') return [`string(1, ${this.sub(list, ATOM)}[${this.sub(index)}])`, ATOM];
    return [`${this.sub(list, ATOM)}[${this.sub(index, 0, { k: 'num', v: 0 })}]`, ATOM];
  }

  protected listAddCode(list: Ex, value: Ex): string {
    return `${this.sub(list, ATOM)}.push_back(${this.sub(value)})`;
  }

  protected listSetCode(list: Ex, index: Ex, value: Ex): string {
    return `${this.sub(list, ATOM)}[${this.sub(index)}] = ${this.sub(value)}`;
  }

  protected askCode(prompt: Ex, as: 'text' | 'int' | 'float'): Code {
    const call = `input(${this.sub(prompt, 0, { k: 'str', v: '' })})`;
    return [as === 'int' ? `stoi(${call})` : as === 'float' ? `stod(${call})` : call, ATOM];
  }

  protected convertCode(e: Expr & { k: 'convert' }): Code {
    const t = this.typeOf(e.a);
    if (e.to === 'text') {
      if (t === 'string') return this.expr(e.a!);
      if (t === 'int') return [`to_string(${this.sub(e.a)})`, ATOM];
      if (isList(t)) return this.joinCode([e.a]);
      this.useHelper('toText');
      return [`toText(${this.sub(e.a)})`, ATOM];
    }
    if (e.to === 'int') {
      if (t === 'int') return this.expr(e.a!);
      if (t === 'double') return [`(int) ${this.sub(e.a, C.unary)}`, C.unary];
      return [`stoi(${this.sub(e.a)})`, ATOM];
    }
    if (t === 'double') return this.expr(e.a!);
    if (t === 'int') return [`(double) ${this.sub(e.a, C.unary)}`, C.unary];
    return [`stod(${this.sub(e.a)})`, ATOM];
  }

  protected mathCode(e: Expr & { k: 'math' }): Code {
    this.imports.add('<cmath>');
    const a = this.sub(e.a, 0);
    switch (e.fn) {
      case 'neg':
        return [`-${this.sub(e.a, C.unary)}`, C.unary];
      case 'round':
      case 'ceil':
      case 'floor':
        return [`(int) ${e.fn}(${a})`, C.unary];
      case 'pow10':
        return [`pow(10, ${a})`, ATOM];
      default:
        return [`${{ sqrt: 'sqrt', abs: 'abs', ln: 'log', log10: 'log10', exp: 'exp' }[e.fn]}(${a})`, ATOM];
    }
  }

  protected randomCode(from: Ex, to: Ex): Code {
    this.usesRandom = true;
    const size = this.sub(this.rangeSize(from, to), C.mul + 1);
    const start = from ?? { k: 'num', v: 1 };
    if (start.k === 'num' && start.v === 0) return [`rand() % ${size}`, C.mul];
    return [`rand() % ${size} + ${this.sub(start, C.add + 1)}`, C.add];
  }

  private asString(p: Ex, first: boolean): string {
    const t = this.typeOf(p);
    if (t === 'string') {
      if (first && (p?.k === 'str' || p?.k === 'raw')) return `string(${this.sub(p)})`;
      return this.sub(p, first ? C.add : C.add + 1, { k: 'str', v: '' });
    }
    if (t === 'bool') return `string(${this.sub(p, C.cond + 1)} ? "true" : "false")`;
    if (t === 'int') return `to_string(${this.sub(p)})`;
    // doubles: same format as "cout <<" (to_string would print 3.500000)
    this.useHelper('toText');
    return `toText(${this.sub(p)})`;
  }

  protected joinCode(parts0: Ex[]): Code {
    const j = this.listsAsText({ k: 'join', parts: parts0 }) as Expr & { k: 'join' };
    const parts = j.parts;
    if (!parts.length) return ['string("")', ATOM];
    if (parts.length === 1) return [this.asString(parts[0], true), this.isStringy(parts[0]) ? this.expr(parts[0]!)[1] : ATOM];
    return [parts.map((p, i) => this.asString(p, i === 0)).join(' + '), C.add];
  }

  protected floorFn(): string {
    this.imports.add('<cmath>');
    return 'floor';
  }

  protected modCode(e: Expr & { k: 'bin' }): Code {
    const { a, b } = e;
    if (!this.bothInt(a, b)) {
      this.imports.add('<cmath>');
      if (this.nativeDivOk(e, true)) return [`fmod(${this.sub(a)}, ${this.sub(b)})`, ATOM];
      return [`fmod(fmod(${this.sub(a)}, ${this.sub(b)}) + ${this.sub(b, C.add + 1)}, ${this.sub(b)})`, ATOM];
    }
    return super.modCode(e);
  }

  protected powCode(a: Ex, b: Ex): Code {
    this.imports.add('<cmath>');
    return [`pow(${this.sub(a)}, ${this.sub(b)})`, ATOM];
  }

  protected foreachHead(type: string, name: string, list: string): string {
    return `for (${type} ${name} : ${list})`;
  }

  protected mainReturn(): string {
    return 'return 0;';
  }

  generate(): GenResult {
    const fns = this.program.functions.map((f) => this.capture(() => this.emitFunction(f, '')));
    const protos = this.program.functions.length > 1 ? this.program.functions.map((f) => `${this.functionHead(f, '')};`) : [];
    this.place = MAIN;
    const main = this.capture(() =>
      this.open('int main()', () => {
        const body = this.capture(() => this.functionBody(this.a.place(MAIN)));
        if (this.usesRandom) this.emit('srand(time(0));');
        this.lines.push(...body);
        this.emit('return 0;');
      }),
    );
    const globals = this.capture(() => {
      for (const g of [...this.a.globals].sort()) {
        const t = this.a.varType(g, MAIN);
        this.emit(`${this.typeName(t)} ${this.id(g)}${this.defaultInit(t)};`);
      }
    });
    const helpers = this.capture(() => {
      if (this.usesInput) {
        this.emit('string input(const string& prompt) {\n    cout << prompt;\n    string line;\n    getline(cin, line);\n    return line;\n}');
        this.blank();
      }
      for (const h of this.helperCode()) {
        this.emit(h);
        this.blank();
      }
    });
    const parts = [globals, helpers, protos, ...fns, main].filter((p) => p.length);
    const text = parts.map((p) => p.join('\n')).join('\n');
    const includes = new Set(['<iostream>', '<string>']);
    if (/\bvector</.test(text)) includes.add('<vector>');
    if (this.usesRandom) {
      includes.add('<cstdlib>');
      includes.add('<ctime>');
    }
    for (const imp of this.imports) includes.add(imp);
    for (const imp of this.program.meta?.imports ?? []) if (imp.lang === 'cpp') includes.add(imp.module);
    const out = [...[...includes].sort().map((i) => `#include ${i}`), 'using namespace std;', ''];
    parts.forEach((p) => out.push(...p, ''));
    return this.result(out.join('\n'));
  }
}
