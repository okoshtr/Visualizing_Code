import { MAIN } from '../analysis';
import type { Ex, Expr, Stmt } from '../ir';
import { ATOM, BaseGen, type Code, type GenResult, foldPlus } from './base';

// Python precedences
const P = { cond: 1, or: 2, and: 3, not: 4, cmp: 5, add: 7, mul: 8, unary: 9, pow: 10 };

const BIN: Record<string, [string, number]> = {
  ADD: ['+', P.add],
  SUB: ['-', P.add],
  MUL: ['*', P.mul],
  DIV: ['/', P.mul],
  IDIV: ['//', P.mul],
  MOD: ['%', P.mul],
  EQ: ['==', P.cmp],
  NEQ: ['!=', P.cmp],
  LT: ['<', P.cmp],
  LTE: ['<=', P.cmp],
  GT: ['>', P.cmp],
  GTE: ['>=', P.cmp],
  AND: ['and', P.and],
  OR: ['or', P.or],
};

export class PythonGen extends BaseGen {
  readonly lang = 'python' as const;
  protected readonly indentUnit = '    ';
  protected readonly commentPrefix = '#';

  generate(): GenResult {
    const fnLines = this.program.functions.map((f) =>
      this.capture(() =>
        this.withId(f.id, () => {
          this.place = f.name;
          if (f.comment) this.comment(f.comment);
          this.emit(`def ${this.id(f.name)}(${f.params.map((p) => this.id(p)).join(', ')}):`);
          this.indented(() => {
            const globals = [...this.a.place(f.name).assignedGlobals].map((g) => this.id(g));
            if (globals.length) this.emit(`global ${globals.join(', ')}`);
            this.suite(f.body);
          });
        }),
      ),
    );
    this.place = MAIN;
    const mainLines = this.capture(() => this.withId(this.program.mainId, () => this.body(this.program.main ?? [])));

    const out: string[] = [];
    const imports = [...this.imports].sort();
    for (const imp of imports) out.push(`import ${imp}`);
    for (const imp of this.program.meta?.imports ?? []) {
      if (imp.lang !== 'python') continue;
      out.push(imp.alias === imp.module ? `import ${imp.module}` : `import ${imp.module} as ${imp.alias}`);
    }
    if (out.length) out.push('', '');
    for (const f of fnLines) out.push(...f, '', '');
    out.push(...mainLines);
    return this.result(out.join('\n'));
  }

  private suite(stmts: Stmt[]) {
    const before = this.lines.length;
    this.body(stmts);
    if (this.lines.length === before) this.emit('pass');
  }

  protected stringLiteral(s: string): string {
    return JSON.stringify(s);
  }

  protected stmt(s: Stmt): void {
    switch (s.k) {
      case 'print':
        if (s.newline && s.value?.k === 'str' && s.value.v === '') {
          this.emit('print()');
          break;
        }
        this.emit(s.newline ? `print(${this.sub(s.value, 0, { k: 'str', v: '' })})` : `print(${this.sub(s.value, 0, { k: 'str', v: '' })}, end="")`);
        break;
      case 'set':
        this.emit(`${this.id(s.name)} = ${this.sub(s.value)}`);
        break;
      case 'change':
        if (s.by?.k === 'num' && s.by.v < 0) this.emit(`${this.id(s.name)} -= ${this.numberLiteral(-s.by.v, s.by.float)}`);
        else this.emit(`${this.id(s.name)} += ${this.sub(s.by, 0, { k: 'num', v: 1 })}`);
        break;
      case 'if':
        s.branches.forEach((b, i) => {
          this.emit(`${i === 0 ? 'if' : 'elif'} ${this.sub(b.cond, 0, { k: 'bool', v: false })}:`);
          this.indented(() => this.suite(b.body));
        });
        if (s.else) {
          this.emit('else:');
          this.indented(() => this.suite(s.else!));
        }
        break;
      case 'repeat':
        this.emit(`for _ in range(${this.sub(s.times, 0, { k: 'num', v: 10 })}):`);
        this.indented(() => this.suite(s.body));
        break;
      case 'while':
        this.emit(s.until ? `while not ${this.sub(s.cond, P.not + 1, { k: 'bool', v: false })}:` : `while ${this.sub(s.cond, 0, { k: 'bool', v: false })}:`);
        this.indented(() => this.suite(s.body));
        break;
      case 'for':
        this.emit(`for ${this.id(s.var)} in ${this.range(s.from, s.to, s.by)}:`);
        this.indented(() => this.suite(s.body));
        break;
      case 'foreach':
        this.emit(`for ${this.id(s.var)} in ${this.sub(s.list, 0, { k: 'list', items: [] })}:`);
        this.indented(() => this.suite(s.body));
        break;
      case 'break':
        this.emit('break');
        break;
      case 'continue':
        this.emit('continue');
        break;
      case 'listadd':
        this.emit(`${this.sub(s.list, ATOM)}.append(${this.sub(s.value)})`);
        break;
      case 'listset':
        this.emit(`${this.sub(s.list, ATOM)}[${this.sub(s.index)}] = ${this.sub(s.value)}`);
        break;
      case 'callstmt':
        this.emit(`${this.id(s.name)}(${this.args(s.args)})`);
        break;
      case 'libstmt':
        this.emit(this.libCode(s.lib, s.fn, s.args)[0]);
        break;
      case 'methodstmt':
        this.emit(`${this.sub(s.obj, ATOM)}.${s.name}(${this.args(s.args)})`);
        break;
      case 'return':
        if (this.place === MAIN) this.emit('raise SystemExit');
        else this.emit(s.value ? `return ${this.sub(s.value)}` : 'return');
        break;
      case 'comment':
        this.comment(s.text);
        break;
      case 'raw':
        this.rawStmt(s.code, s.lang);
        break;
      case 'pexpr':
        this.emit(this.sub(s.e));
        break;
    }
  }

  private range(from: Ex, to: Ex, by: Ex): string {
    const { step, positive } = this.loopStep(by);
    const start = this.sub(from, 0, { k: 'num', v: 0 });
    if (step === null) {
      const s = this.sub(by);
      return `range(${start}, ${this.sub(to, P.add + 1)} + (1 if ${s} > 0 else -1), ${s})`;
    }
    const end = this.sub(foldPlus(to ?? { k: 'num', v: 0 }, positive ? 1 : -1), 0);
    const isZero = !from || (from.k === 'num' && from.v === 0);
    if (step === 1) return isZero ? `range(${end})` : `range(${start}, ${end})`;
    return `range(${start}, ${end}, ${this.numberLiteral(step)})`;
  }

  private str(e: Ex, minPrec = P.add + 1): string {
    if (this.isStringy(e)) return this.sub(e, minPrec, { k: 'str', v: '' });
    if (e?.k === 'convert' && e.to === 'text') return this.sub(e);
    return `str(${this.sub(e, 0)})`;
  }

  protected expr(e: Expr): Code {
    switch (e.k) {
      case 'num':
        return e.v < 0 ? [this.numberLiteral(e.v, e.float), P.unary] : [this.numberLiteral(e.v, e.float), ATOM];
      case 'str':
        return [this.stringLiteral(e.v), ATOM];
      case 'bool':
        return [e.v ? 'True' : 'False', ATOM];
      case 'var':
        return [this.id(e.name), ATOM];
      case 'bin': {
        if (e.op === 'POW') return [`${this.sub(e.a, P.pow + 1)} ** ${this.sub(e.b, P.unary)}`, P.pow];
        if (e.op === 'ADD' && (this.isStringy(e.a) || this.isStringy(e.b))) {
          return [`${this.str(e.a, P.add)} + ${this.str(e.b)}`, P.add];
        }
        if ((e.op === 'IDIV' || e.op === 'MOD') && !this.nativeDivOk(e, false)) {
          // round toward zero (as in Java, C#, C++, JavaScript, VBA)
          if (e.op === 'IDIV') return [`int(${this.sub(e.a, P.mul)} / ${this.sub(e.b, P.mul + 1)})`, ATOM];
          this.imports.add('math');
          const call = `math.fmod(${this.sub(e.a)}, ${this.sub(e.b)})`;
          return [this.bothInt(e.a, e.b) ? `int(${call})` : call, ATOM];
        }
        const [op, prec] = BIN[e.op];
        const cmp = prec === P.cmp;
        return [`${this.sub(e.a, cmp ? prec + 1 : prec)} ${op} ${this.sub(e.b, prec + 1)}`, prec];
      }
      case 'not':
        return [`not ${this.sub(e.a, P.not, { k: 'bool', v: false })}`, P.not];
      case 'math':
        switch (e.fn) {
          case 'sqrt':
          case 'ln':
          case 'log10':
          case 'exp':
          case 'ceil':
          case 'floor': {
            this.imports.add('math');
            const fn = { sqrt: 'sqrt', ln: 'log', log10: 'log10', exp: 'exp', ceil: 'ceil', floor: 'floor' }[e.fn];
            return [`math.${fn}(${this.sub(e.a)})`, ATOM];
          }
          case 'abs':
            return [`abs(${this.sub(e.a)})`, ATOM];
          case 'round':
            return [`round(${this.sub(e.a)})`, ATOM];
          case 'neg':
            return [`-${this.sub(e.a, P.unary)}`, P.unary];
          case 'pow10':
            return [`10 ** ${this.sub(e.a, P.unary)}`, P.pow];
        }
        break;
      case 'random':
        this.imports.add('random');
        return [`random.randint(${this.sub(e.from, 0, { k: 'num', v: 1 })}, ${this.sub(e.to, 0, { k: 'num', v: 10 })})`, ATOM];
      case 'join':
        if (e.parts.length === 0) return ['""', ATOM];
        if (e.parts.length === 1) return [this.str(e.parts[0]), this.isStringy(e.parts[0]) ? 0 : ATOM];
        return [e.parts.map((p, i) => this.str(p, i === 0 ? P.add : P.add + 1)).join(' + '), P.add];
      case 'len':
        return [`len(${this.sub(e.a)})`, ATOM];
      case 'ask': {
        const call = `input(${this.sub(e.prompt, 0, { k: 'str', v: '' })})`;
        return [e.as === 'int' ? `int(${call})` : e.as === 'float' ? `float(${call})` : call, ATOM];
      }
      case 'convert':
        return [`${{ int: 'int', float: 'float', text: 'str' }[e.to]}(${this.sub(e.a)})`, ATOM];
      case 'list':
        return [`[${this.args(e.items)}]`, ATOM];
      case 'index':
        return [`${this.sub(e.list, ATOM)}[${this.sub(e.index)}]`, ATOM];
      case 'call':
        return [`${this.id(e.name)}(${this.args(e.args)})`, ATOM];
      case 'lib':
        return this.libCode(e.lib, e.fn, e.args);
      case 'method':
        return [`${this.sub(e.obj, ATOM)}.${e.name}(${this.args(e.args)})`, ATOM];
      case 'member':
        return [`${this.sub(e.obj, ATOM)}.${e.name}`, ATOM];
      case 'cond':
        return [`${this.sub(e.a, P.cond + 1)} if ${this.sub(e.cond, P.cond + 1)} else ${this.sub(e.b, P.cond)}`, P.cond];
      case 'raw':
        return this.rawCode(e.code, e.lang);
      default:
        this.warn(`Interner Fehler: unbekannter Ausdruck ${e.k}`);
        return ['None', ATOM];
    }
    return ['None', ATOM];
  }
}
