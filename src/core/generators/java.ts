import { MAIN, type Ty, elemOf, isList } from '../analysis';
import type { Ex, Expr } from '../ir';
import { ATOM, type Code, type GenResult } from './base';
import { C, CLikeGen } from './clike';

const BOX: Record<string, string> = { int: 'Integer', double: 'Double', string: 'String', bool: 'Boolean', any: 'Object' };

export class JavaGen extends CLikeGen {
  readonly lang = 'java' as const;
  protected readonly indentUnit = '    ';

  protected typeName(t: Ty): string {
    if (isList(t)) return `ArrayList<${this.boxed(elemOf(t))}>`;
    return { int: 'int', double: 'double', string: 'String', bool: 'boolean' }[t] ?? 'Object';
  }

  private boxed(t: Ty): string {
    if (isList(t)) return `ArrayList<${this.boxed(elemOf(t))}>`;
    return BOX[t] ?? 'Object';
  }

  protected printCode(value: Ex, newline: boolean): string {
    return `System.out.${newline ? 'println' : 'print'}(${this.sub(value, 0, { k: 'str', v: '' })})`;
  }

  protected emptyLine(): string {
    return 'System.out.println()';
  }

  protected listLiteral(e: Expr & { k: 'list' }, elem: Ty): Code {
    if (!e.items.length) return ['new ArrayList<>()', ATOM];
    const items = e.items.map((it) => (it?.k === 'num' && elem === 'double' ? this.numberLiteral(it.v, true) : this.sub(it, 0)));
    return [`new ArrayList<>(List.of(${items.join(', ')}))`, ATOM];
  }

  protected lenCode(e: Expr & { k: 'len' }, ofList: boolean): Code {
    return [`${this.sub(e.a, ATOM)}.${ofList ? 'size' : 'length'}()`, ATOM];
  }

  protected indexCode(list: Ex, index: Ex): Code {
    if (this.typeOf(list) === 'string') return [`String.valueOf(${this.sub(list, ATOM)}.charAt(${this.sub(index)}))`, ATOM];
    return [`${this.sub(list, ATOM)}.get(${this.sub(index, 0, { k: 'num', v: 0 })})`, ATOM];
  }

  protected listAddCode(list: Ex, value: Ex): string {
    return `${this.sub(list, ATOM)}.add(${this.sub(value)})`;
  }

  protected listSetCode(list: Ex, index: Ex, value: Ex): string {
    return `${this.sub(list, ATOM)}.set(${this.sub(index)}, ${this.sub(value)})`;
  }

  protected askCode(prompt: Ex, as: 'text' | 'int' | 'float'): Code {
    const call = `input(${this.sub(prompt, 0, { k: 'str', v: '' })})`;
    return [as === 'int' ? `Integer.parseInt(${call})` : as === 'float' ? `Double.parseDouble(${call})` : call, ATOM];
  }

  protected convertCode(e: Expr & { k: 'convert' }): Code {
    const t = this.typeOf(e.a);
    if (e.to === 'text') return t === 'string' ? this.expr(e.a!) : [`String.valueOf(${this.sub(e.a)})`, ATOM];
    if (e.to === 'int') {
      if (t === 'int') return this.expr(e.a!);
      if (t === 'double') return [`(int) ${this.sub(e.a, C.unary)}`, C.unary];
      return [`Integer.parseInt(${this.sub(e.a)})`, ATOM];
    }
    if (t === 'double') return this.expr(e.a!);
    if (t === 'int') return [`(double) ${this.sub(e.a, C.unary)}`, C.unary];
    return [`Double.parseDouble(${this.sub(e.a)})`, ATOM];
  }

  protected mathCode(e: Expr & { k: 'math' }): Code {
    const a = this.sub(e.a, 0);
    switch (e.fn) {
      case 'neg':
        return [`-${this.sub(e.a, C.unary)}`, C.unary];
      case 'round':
        return [`(int) Math.round(${a})`, C.unary];
      case 'ceil':
        return [`(int) Math.ceil(${a})`, C.unary];
      case 'floor':
        return [`(int) Math.floor(${a})`, C.unary];
      case 'pow10':
        return [`Math.pow(10, ${a})`, ATOM];
      default:
        return [`Math.${{ sqrt: 'sqrt', abs: 'abs', ln: 'log', log10: 'log10', exp: 'exp' }[e.fn]}(${a})`, ATOM];
    }
  }

  protected randomCode(from: Ex, to: Ex): Code {
    this.usesRandom = true;
    const size = this.sub(this.rangeSize(from, to), 0);
    const start = from ?? { k: 'num', v: 1 };
    if (start.k === 'num' && start.v === 0) return [`random.nextInt(${size})`, ATOM];
    return [`random.nextInt(${size}) + ${this.sub(start, C.add + 1)}`, C.add];
  }

  protected joinCode(parts: Ex[]): Code {
    if (!parts.length) return ['""', ATOM];
    if (parts.length === 1) return this.isStringy(parts[0]) ? this.expr(parts[0]!) : [`String.valueOf(${this.sub(parts[0])})`, ATOM];
    const codes = parts.map((p, i) => this.sub(p, i === 0 ? C.add : C.add + 1, { k: 'str', v: '' }));
    if (!this.isStringy(parts[0]) && !this.isStringy(parts[1])) codes.unshift('""');
    return [codes.join(' + '), C.add];
  }

  protected eqCode(a: Ex, b: Ex, neg: boolean): Code {
    if (this.isStringy(a) || this.isStringy(b)) {
      const call = `${this.sub(a, ATOM)}.equals(${this.sub(b)})`;
      return neg ? [`!${call}`, C.unary] : [call, ATOM];
    }
    return super.eqCode(a, b, neg);
  }

  protected powCode(a: Ex, b: Ex): Code {
    return [`Math.pow(${this.sub(a)}, ${this.sub(b)})`, ATOM];
  }

  protected foreachHead(type: string, name: string, list: string): string {
    return `for (${type} ${name} : ${list})`;
  }

  generate(): GenResult {
    this.depth = 1;
    const fns = this.program.functions.map((f) => this.capture(() => this.emitFunction(f, 'static ')));
    this.place = MAIN;
    const main = this.capture(() =>
      this.open('public static void main(String[] args)', () => this.functionBody(this.a.place(MAIN))),
    );
    const fields = this.capture(() => {
      if (this.usesInput) this.emit('static Scanner scanner = new Scanner(System.in);');
      if (this.usesRandom) this.emit('static Random random = new Random();');
      for (const g of [...this.a.globals].sort()) {
        const t = this.a.varType(g, MAIN);
        this.emit(`static ${this.typeName(t)} ${this.id(g)}${this.defaultInit(t)};`);
      }
    });
    const helpers = this.capture(() => {
      if (this.usesInput) {
        this.emit('static String input(String prompt) {');
        this.emit('    System.out.print(prompt);');
        this.emit('    return scanner.nextLine();');
        this.emit('}');
        this.blank();
      }
      for (const h of this.helperCode()) {
        this.emit(h);
        this.blank();
      }
    });
    const className = this.opts.className ?? this.program.meta?.className ?? 'Main';
    const bodyParts = [fields, helpers, ...fns, main].filter((p) => p.length);
    const inner: string[] = [];
    bodyParts.forEach((p, i) => {
      if (i > 0 && inner[inner.length - 1] !== '') inner.push('');
      inner.push(...p);
    });
    const text = inner.join('\n');
    const out: string[] = [];
    if (/\b(ArrayList|List|Arrays|Collections|Scanner|Random)\b/.test(text)) out.push('import java.util.*;');
    for (const imp of [...this.imports].sort()) out.push(`import ${imp};`);
    for (const imp of this.program.meta?.imports ?? []) if (imp.lang === 'java') out.push(`import ${imp.module};`);
    if (out.length) out.push('');
    out.push(`public class ${className} {`, ...inner, '}');
    return this.result(out.join('\n'));
  }
}
