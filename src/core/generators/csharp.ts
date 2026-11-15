import { MAIN, type Ty, elemOf, isList } from '../analysis';
import type { Ex, Expr } from '../ir';
import { ATOM, type Code, type GenResult, foldPlus } from './base';
import { C, CLikeGen } from './clike';

export class CSharpGen extends CLikeGen {
  readonly lang = 'csharp' as const;
  protected readonly indentUnit = '    ';
  protected override allman = true;

  protected typeName(t: Ty): string {
    if (isList(t)) return `List<${this.typeName(elemOf(t))}>`;
    return { int: 'int', double: 'double', string: 'string', bool: 'bool' }[t] ?? 'object';
  }

  protected printCode(value: Ex, newline: boolean): string {
    return `Console.${newline ? 'WriteLine' : 'Write'}(${this.sub(this.listsAsText(value), 0, { k: 'str', v: '' })})`;
  }

  protected emptyLine(): string {
    return 'Console.WriteLine()';
  }

  protected listLiteral(e: Expr & { k: 'list' }, elem: Ty): Code {
    const type = `List<${this.typeName(elem === '?' ? 'int' : elem)}>`;
    if (!e.items.length) return [`new ${type}()`, ATOM];
    return [`new ${type} { ${this.args(e.items)} }`, ATOM];
  }

  protected lenCode(e: Expr & { k: 'len' }, ofList: boolean): Code {
    return [`${this.sub(e.a, ATOM)}.${ofList ? 'Count' : 'Length'}`, ATOM];
  }

  protected indexCode(list: Ex, index: Ex): Code {
    if (this.typeOf(list) === 'string') return [`${this.sub(list, ATOM)}[${this.sub(index)}].ToString()`, ATOM];
    return [`${this.sub(list, ATOM)}[${this.sub(index, 0, { k: 'num', v: 0 })}]`, ATOM];
  }

  protected listAddCode(list: Ex, value: Ex): string {
    return `${this.sub(list, ATOM)}.Add(${this.sub(value)})`;
  }

  protected listSetCode(list: Ex, index: Ex, value: Ex): string {
    return `${this.sub(list, ATOM)}[${this.sub(index)}] = ${this.sub(value)}`;
  }

  protected askCode(prompt: Ex, as: 'text' | 'int' | 'float'): Code {
    const call = `Input(${this.sub(prompt, 0, { k: 'str', v: '' })})`;
    return [as === 'int' ? `int.Parse(${call})` : as === 'float' ? `double.Parse(${call})` : call, ATOM];
  }

  protected convertCode(e: Expr & { k: 'convert' }): Code {
    const t = this.typeOf(e.a);
    if (e.to === 'text') return t === 'string' ? this.expr(e.a!) : [`${this.sub(e.a, ATOM)}.ToString()`, ATOM];
    if (e.to === 'int') {
      if (t === 'int') return this.expr(e.a!);
      if (t === 'double') return [`(int) ${this.sub(e.a, C.unary)}`, C.unary];
      return [`int.Parse(${this.sub(e.a)})`, ATOM];
    }
    if (t === 'double') return this.expr(e.a!);
    if (t === 'int') return [`(double) ${this.sub(e.a, C.unary)}`, C.unary];
    return [`double.Parse(${this.sub(e.a)})`, ATOM];
  }

  protected mathCode(e: Expr & { k: 'math' }): Code {
    const a = this.sub(e.a, 0);
    switch (e.fn) {
      case 'neg':
        return [`-${this.sub(e.a, C.unary)}`, C.unary];
      case 'round':
        return [`(int) Math.Round(${a})`, C.unary];
      case 'ceil':
        return [`(int) Math.Ceiling(${a})`, C.unary];
      case 'floor':
        return [`(int) Math.Floor(${a})`, C.unary];
      case 'pow10':
        return [`Math.Pow(10, ${a})`, ATOM];
      default:
        return [`Math.${{ sqrt: 'Sqrt', abs: 'Abs', ln: 'Log', log10: 'Log10', exp: 'Exp' }[e.fn]}(${a})`, ATOM];
    }
  }

  protected randomCode(from: Ex, to: Ex): Code {
    this.usesRandom = true;
    return [`random.Next(${this.sub(from, 0, { k: 'num', v: 1 })}, ${this.sub(foldPlus(to ?? { k: 'num', v: 10 }, 1), 0)})`, ATOM];
  }

  protected joinCode(parts0: Ex[]): Code {
    const parts = (this.listsAsText({ k: 'join', parts: parts0 }) as Expr & { k: 'join' }).parts;
    if (!parts.length) return ['""', ATOM];
    if (parts.length === 1) return this.isStringy(parts[0]) ? this.expr(parts[0]!) : [`${this.sub(parts[0], ATOM)}.ToString()`, ATOM];
    const codes = parts.map((p, i) => this.sub(p, i === 0 ? C.add : C.add + 1, { k: 'str', v: '' }));
    if (!this.isStringy(parts[0]) && !this.isStringy(parts[1])) codes.unshift('""');
    return [codes.join(' + '), C.add];
  }

  protected powCode(a: Ex, b: Ex): Code {
    return [`Math.Pow(${this.sub(a)}, ${this.sub(b)})`, ATOM];
  }

  protected foreachHead(type: string, name: string, list: string): string {
    return `foreach (${type} ${name} in ${list})`;
  }

  generate(): GenResult {
    this.depth = 1;
    const fns = this.program.functions.map((f) => this.capture(() => this.emitFunction(f, 'static ')));
    this.place = MAIN;
    const main = this.capture(() =>
      this.withId(this.program.mainId, () => this.open('static void Main()', () => {
        const body = this.capture(() => this.functionBody(this.a.place(MAIN)));
        // decimal point instead of the comma of the system language (also for double.Parse)
        if (/\bdouble\b|\d\.\d/.test([...body, ...fns.flat()].join('\n'))) {
          this.emit('CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;');
          this.imports.add('System.Globalization');
        }
        this.lines.push(...body);
      })),
    );
    const fields = this.capture(() => {
      if (this.usesRandom) this.emit('static Random random = new Random();');
      for (const g of [...this.a.globals].sort()) {
        const t = this.a.varType(g, MAIN);
        this.emit(`static ${this.typeName(t)} ${this.id(g)}${this.defaultInit(t)};`);
      }
    });
    const helpers = this.capture(() => {
      if (this.usesInput) {
        this.emit('static string Input(string prompt)\n{\n    Console.Write(prompt);\n    return Console.ReadLine() ?? "";\n}');
        this.blank();
      }
      for (const h of this.helperCode()) {
        this.emit(h);
        this.blank();
      }
    });
    const inner: string[] = [];
    [fields, helpers, ...fns, main]
      .filter((p) => p.length)
      .forEach((p, i) => {
        if (i > 0 && inner[inner.length - 1] !== '') inner.push('');
        inner.push(...p);
      });
    const text = inner.join('\n');
    const usings = new Set(['System']);
    if (/\bList</.test(text)) usings.add('System.Collections.Generic');
    for (const imp of this.imports) usings.add(imp);
    for (const imp of this.program.meta?.imports ?? []) if (imp.lang === 'csharp') usings.add(imp.module);
    const out = [...[...usings].sort().map((u) => `using ${u};`), ''];
    const meta = this.program.meta;
    const className = this.opts.className ?? (meta?.sourceLang === 'csharp' ? meta.className : undefined) ?? 'Program';
    out.push(`class ${className}`, '{', ...inner, '}');
    return this.result(out.join('\n'));
  }
}
