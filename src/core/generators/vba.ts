import { MAIN, type PlaceInfo, type Ty, isDict, isList } from '../analysis';
import type { ClassDef, Ex, Expr, FunctionDef, Stmt } from '../ir';
import { CTOR, methodPlace } from '../ir';
import { walkStmts } from '../ir';
import { ATOM, BaseGen, type Code, type GenResult, foldPlus } from './base';

// VBA precedences: ^ > unary - > * / > \ > Mod > + - > & > comparison > Not > And > Or
const V = { or: 1, and: 2, not: 3, cmp: 4, concat: 5, add: 6, mod: 7, idiv: 8, mul: 9, unary: 10, pow: 11 };

const BIN: Record<string, [string, number]> = {
  ADD: ['+', V.add],
  SUB: ['-', V.add],
  MUL: ['*', V.mul],
  DIV: ['/', V.mul],
  IDIV: ['\\', V.idiv],
  MOD: ['Mod', V.mod],
  POW: ['^', V.pow],
  EQ: ['=', V.cmp],
  NEQ: ['<>', V.cmp],
  LT: ['<', V.cmp],
  LTE: ['<=', V.cmp],
  GT: ['>', V.cmp],
  GTE: ['>=', V.cmp],
  AND: ['And', V.and],
  OR: ['Or', V.or],
};

interface Loop {
  kind: 'For' | 'Do';
  label?: string;
}

export class VbaGen extends BaseGen {
  readonly lang = 'vba' as const;
  protected readonly indentUnit = '    ';
  protected readonly commentPrefix = "'";
  private loops: Loop[] = [];
  private counters: string[] = [];
  private extraDims: string[] = [];
  private fn: FunctionDef | null = null;
  private labelCount = 0;

  /** VBA ignores case: a variable "konto" would clash with the Type "Konto". */
  id(name: string): string {
    const base = super.id(name);
    return this.classes.some((c) => c.name.toLowerCase() === base.toLowerCase()) ? `${base}Obj` : base;
  }

  typeName(t: Ty): string {
    if (t.startsWith('obj<')) return t.slice(4, -1);
    if (isList(t)) return 'Variant';
    if (isDict(t)) return 'Object';
    return { int: 'Long', double: 'Double', string: 'String', bool: 'Boolean' }[t] ?? 'Variant';
  }

  protected stringLiteral(s: string): string {
    const parts = s.split(/\r?\n/).map((p) => `"${p.replace(/"/g, '""')}"`);
    return parts.join(' & vbNewLine & ');
  }

  // ---- program -----------------------------------------------------------------------

  generate(): GenResult {
    // classes: VBA has class modules only as separate files, so a class becomes a Type
    // plus a function "NeuKlasse" (constructor) and procedures "Klasse_methode"
    const classProcs = this.classes.map((c) =>
      this.capture(() =>
        this.withId(c.id, () => {
          if (c.comment) this.comment(c.comment);
          this.procedure({ name: `Neu${c.name}`, params: c.ctorParams, body: c.ctor, returns: true }, { cls: c, ctor: true });
          for (const m of c.methods) {
            this.blank();
            this.withId(m.id, () => this.procedure(m, { cls: c, ctor: false }));
          }
        }),
      ),
    );
    const fns = this.program.functions.map((f) => this.capture(() => this.withId(f.id, () => this.procedure(f))));
    const main = this.capture(() => this.withId(this.program.mainId, () => this.procedure(null)));
    const out = ['Option Explicit', ''];
    for (const c of this.classes) {
      out.push(`Type ${c.name}`);
      for (const name of this.classFields(c)) out.push(`    ${name} As ${this.typeName(this.a.fieldType(c.name, name))}`);
      out.push('End Type', '');
      if (JSON.stringify(this.program).includes(`list<obj<${c.name}>>`)) this.warn('VBA: Listen von Objekten werden nicht unterstützt.');
    }
    const globals = [...this.a.globals].sort();
    for (const g of globals) out.push(`Dim ${this.id(g)} As ${this.typeName(this.a.varType(g, MAIN))}`);
    if (globals.length) out.push('');
    for (const h of this.helperCode()) out.push(h, '');
    for (const c of classProcs) out.push(...c, '');
    for (const f of fns) out.push(...f, '');
    out.push(...main);
    return this.result(out.join('\n'));
  }

  /** VBA name of the running procedure (for "name = value" returns) and its analysis place. */
  private fnVba = '';
  private fnPlace = '';

  private procedure(f: FunctionDef | null, cls?: { cls: ClassDef; ctor: boolean }) {
    this.fn = f;
    const c = cls?.cls;
    this.place = c ? methodPlace(c.name, cls!.ctor ? CTOR : f!.name) : f ? f.name : MAIN;
    this.fnPlace = this.place;
    this.fnVba = c ? (cls!.ctor ? `Neu${c.name}` : `${c.name}_${f!.name}`) : f ? this.id(f.name) : '';
    const place = this.a.place(this.place);
    this.extraDims = [];
    this.labelCount = 0;
    const bodyLines = this.capture(() =>
      this.indented(() => {
        if (c && cls!.ctor) for (const fld of c.fields) this.emit(`self.${fld.name} = ${this.sub(fld.value, 0, { k: 'num', v: 0 })}`);
        this.body(place.body);
        if (c && cls!.ctor) this.emit(`${this.fnVba} = self`);
      }),
    );
    if (f?.comment) this.comment(f.comment);
    if (f) {
      const types = this.a.paramTypes(this.place);
      const list = f.params.map((p, i) =>
        isList(types[i]) || types[i] === 'any' || types[i].startsWith('obj<') ? `${this.id(p)} As ${this.typeName(types[i])}` : `ByVal ${this.id(p)} As ${this.typeName(types[i])}`,
      );
      if (c && !cls!.ctor) list.unshift(`self As ${c.name}`);
      const params = list.join(', ');
      const ret = c && cls!.ctor ? c.name : this.typeName(this.a.returnType(this.place));
      if (f.returns) this.emit(`Function ${this.fnVba}(${params}) As ${ret}`);
      else this.emit(`Sub ${this.fnVba}(${params})`);
    } else this.emit(`Sub ${(this.program.meta?.sourceLang === 'vba' && this.program.meta.mainName) || 'Main'}()`);
    this.indented(() => {
      if (c && cls!.ctor) this.emit(`Dim self As ${c.name}`);
      for (const line of this.dims(place)) this.emit(line);
      if (!f && this.usesRandom) this.emit('Randomize');
    });
    this.lines.push(...bodyLines);
    this.emit(f ? (f.returns ? 'End Function' : 'End Sub') : 'End Sub');
    this.fn = null;
  }

  private dims(place: PlaceInfo): string[] {
    const names = [...place.locals].filter((n) => !place.params.includes(n));
    const eachVars = new Set<string>();
    walkStmts(place.body, (s) => {
      if (s.k === 'foreach') eachVars.add(s.var);
    });
    const lines = names.map((n) => `Dim ${this.id(n)} As ${eachVars.has(n) ? 'Variant' : this.typeName(this.varType(n))}`);
    for (const c of this.extraDims) lines.push(`Dim ${c} As Long`);
    return lines;
  }

  // ---- statements ----------------------------------------------------------------------

  protected stmt(s: Stmt): void {
    switch (s.k) {
      case 'print':
        if (s.newline && s.value?.k === 'str' && s.value.v === '') {
          this.emit('Debug.Print');
          break;
        }
        this.emit(`Debug.Print ${this.sub(this.listsAsText(this.printValue(s)), 0, { k: 'str', v: '' })}${s.newline ? '' : ';'}`);
        break;
      case 'set':
        // objects (dictionaries) are assigned with "Set"
        this.emit(`${isDict(this.varType(s.name)) ? 'Set ' : ''}${this.id(s.name)} = ${this.sub(s.value, 0, { k: 'num', v: 0 })}`);
        break;
      case 'try': {
        const n = ++this.labelCount;
        if (this.catchNames.length) this.warn('VBA: verschachtelte "versuche"-Blöcke werden nicht richtig unterstützt.');
        this.emit(`On Error GoTo Fehler${n}`);
        this.body(s.body);
        this.emit(`GoTo Weiter${n}`);
        this.lines.push(`Fehler${n}:`);
        this.withCatch(() => this.body(s.handler));
        this.emit(`Resume Weiter${n}`);
        this.lines.push(`Weiter${n}:`);
        this.emit('On Error GoTo 0');
        break;
      }
      case 'throw':
        this.emit(`Err.Raise vbObjectError + 1, , ${this.sub(s.value, 0, { k: 'str', v: 'Fehler' })}`);
        break;
      case 'dset':
        this.emit(`${this.sub(s.dict, ATOM)}(${this.sub(s.key)}) = ${this.sub(s.value)}`);
        break;
      case 'change': {
        const n = this.id(s.name);
        if (s.by?.k === 'num' && s.by.v < 0) this.emit(`${n} = ${n} - ${this.numberLiteral(-s.by.v, s.by.float)}`);
        else this.emit(`${n} = ${n} + ${this.sub(s.by, V.add + 1, { k: 'num', v: 1 })}`);
        break;
      }
      case 'if':
        s.branches.forEach((b, i) => {
          this.emit(`${i === 0 ? 'If' : 'ElseIf'} ${this.sub(b.cond, 0, { k: 'bool', v: false })} Then`);
          this.indented(() => this.body(b.body));
        });
        if (s.else) {
          this.emit('Else');
          this.indented(() => this.body(s.else!));
        }
        this.emit('End If');
        break;
      case 'repeat': {
        const c = this.counter();
        this.loop('For', `For ${c} = 1 To ${this.sub(s.times, 0, { k: 'num', v: 10 })}`, `Next ${c}`, s.body);
        this.counters.pop();
        break;
      }
      case 'while':
        if (s.post) this.loop('Do', 'Do', `Loop ${s.until ? 'Until' : 'While'} ${this.sub(s.cond, 0, { k: 'bool', v: false })}`, s.body);
        else this.loop('Do', `Do ${s.until ? 'Until' : 'While'} ${this.sub(s.cond, 0, { k: 'bool', v: false })}`, 'Loop', s.body);
        break;
      case 'for': {
        const v = this.id(s.var);
        const { step } = this.loopStep(s.by);
        const stepText = step === 1 ? '' : ` Step ${step === null ? this.sub(s.by) : this.numberLiteral(step)}`;
        this.loop('For', `For ${v} = ${this.sub(s.from, 0, { k: 'num', v: 0 })} To ${this.sub(s.to, 0, { k: 'num', v: 0 })}${stepText}`, `Next ${v}`, s.body);
        break;
      }
      case 'foreach': {
        const v = this.id(s.var);
        const list = isDict(this.typeOf(s.list)) ? `${this.sub(s.list, ATOM)}.Keys` : this.sub(s.list, 0, { k: 'list', items: [] });
        this.loop('For', `For Each ${v} In ${list}`, `Next ${v}`, s.body);
        break;
      }
      case 'break': {
        const loop = this.loops[this.loops.length - 1];
        this.emit(loop ? `Exit ${loop.kind}` : "' (abbrechen außerhalb einer Schleife)");
        break;
      }
      case 'continue': {
        const loop = this.loops[this.loops.length - 1];
        if (!loop) break;
        loop.label ??= `Weiter${++this.labelCount}`;
        this.emit(`GoTo ${loop.label}`);
        break;
      }
      case 'listadd': {
        if (s.list?.k !== 'var') {
          this.warn('VBA: "füge hinzu" funktioniert nur mit einer Listen-Variable.');
          break;
        }
        const l = this.id(s.list.name);
        this.emit(`ReDim Preserve ${l}(UBound(${l}) + 1)`);
        this.emit(`${l}(UBound(${l})) = ${this.sub(s.value)}`);
        break;
      }
      case 'listset':
        this.emit(`${this.sub(s.list, ATOM)}(${this.sub(s.index)}) = ${this.sub(s.value)}`);
        break;
      case 'callstmt':
        this.emit(s.args.length ? `${this.id(s.name)} ${this.args(s.args)}` : this.id(s.name));
        break;
      case 'libstmt':
        if (s.lib.startsWith('ext:')) {
          this.emit(`${this.externalName(s.lib, s.fn)}${s.args.length ? ' ' + this.args(s.args) : ''}`);
        } else this.emit(this.libCode(s.lib, s.fn, s.args)[0]);
        break;
      case 'methodstmt': {
        const cls = this.isClassType(s.obj);
        if (cls) this.emit(`${cls}_${s.name} ${this.args([s.obj, ...s.args])}`);
        else this.emit(`${this.sub(s.obj, ATOM)}.${s.name}${s.args.length ? ' ' + this.args(s.args) : ''}`);
        break;
      }
      case 'fset':
        this.emit(`${this.sub(s.obj, ATOM)}.${s.name} = ${this.sub(s.value)}`);
        break;
      case 'return':
        if (this.fn?.returns) {
          const set = isDict(this.a.returnType(this.fnPlace)) ? 'Set ' : '';
          if (s.value) this.emit(`${set}${this.fnVba} = ${this.sub(s.value)}`);
          if (!this.isLastStatement(s)) this.emit('Exit Function');
        } else if (!this.isLastStatement(s)) this.emit('Exit Sub');
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

  private isLastStatement(s: Stmt): boolean {
    const body = this.fn ? this.fn.body : this.program.main ?? [];
    return body[body.length - 1] === s;
  }

  private loop(kind: 'For' | 'Do', head: string, end: string, body: Stmt[]) {
    const loop: Loop = { kind };
    this.loops.push(loop);
    this.emit(head);
    this.indented(() => this.body(body));
    if (loop.label) this.lines.push(`${loop.label}:`);
    this.emit(end);
    this.loops.pop();
  }

  private counter(): string {
    const candidates = ['i', 'j', 'k', 'l', 'm', 'n'];
    let name = candidates.find((c) => !this.a.allNames.has(c) && !this.counters.includes(c));
    if (!name) name = this.fresh('zaehler');
    this.counters.push(name);
    if (!this.extraDims.includes(name)) this.extraDims.push(name);
    return name;
  }

  // ---- expressions ------------------------------------------------------------------------

  private concatPart(p: Ex, first: boolean): string {
    return this.sub(p, first ? V.concat : V.concat + 1, { k: 'str', v: '' });
  }

  protected expr(e: Expr): Code {
    switch (e.k) {
      case 'num':
        return [this.numberLiteral(e.v), e.v < 0 ? V.unary : ATOM];
      case 'str':
        return [this.stringLiteral(e.v), e.v.includes('\n') ? V.concat : ATOM];
      case 'bool':
        return [e.v ? 'True' : 'False', ATOM];
      case 'var':
        return [this.id(e.name), ATOM];
      case 'bin': {
        if (e.op === 'ADD' && (this.isStringy(e.a) || this.isStringy(e.b))) {
          return [`${this.concatPart(e.a, true)} & ${this.concatPart(e.b, false)}`, V.concat];
        }
        if ((e.op === 'IDIV' || e.op === 'MOD') && !this.nativeDivOk(e, true)) {
          // round down (as in Python)
          if (e.op === 'IDIV') return [`Int(${this.sub(e.a, V.mul)} / ${this.sub(e.b, V.mul + 1)})`, ATOM];
          const x = this.sub(e.a, V.mod);
          const y = this.sub(e.b, V.mod + 1);
          return [`((${x} Mod ${y}) + ${y}) Mod ${y}`, V.mod];
        }
        const [op, prec] = BIN[e.op];
        if (e.op === 'POW') return [`${this.sub(e.a, prec + 1)} ^ ${this.sub(e.b, prec + 1)}`, prec];
        const nonAssoc = prec === V.cmp;
        return [`${this.sub(e.a, nonAssoc ? prec + 1 : prec)} ${op} ${this.sub(e.b, prec + 1)}`, prec];
      }
      case 'not':
        return [`Not ${this.sub(e.a, V.not, { k: 'bool', v: false })}`, V.not];
      case 'math': {
        const a = this.sub(e.a, 0);
        switch (e.fn) {
          case 'sqrt':
            return [`Sqr(${a})`, ATOM];
          case 'abs':
            return [`Abs(${a})`, ATOM];
          case 'neg':
            return [`-${this.sub(e.a, V.unary)}`, V.unary];
          case 'ln':
            return [`Log(${a})`, ATOM];
          case 'log10':
            return [`Log(${a}) / Log(10)`, V.mul];
          case 'exp':
            return [`Exp(${a})`, ATOM];
          case 'pow10':
            return [`10 ^ ${this.sub(e.a, V.pow + 1)}`, V.pow];
          case 'round':
            return [`Round(${a})`, ATOM];
          case 'ceil':
            return [`-Int(-${this.sub(e.a, V.unary)})`, V.unary];
          case 'floor':
            return [`Int(${a})`, ATOM];
        }
        break;
      }
      case 'random': {
        this.usesRandom = true;
        const from = e.from ?? { k: 'num', v: 1 };
        const size = from.k === 'num' ? foldPlus(e.to ?? { k: 'num', v: 10 }, 1 - from.v) : foldPlus({ k: 'bin', op: 'SUB', a: e.to, b: from }, 1);
        const base = `Int(Rnd() * ${this.sub(size, V.mul + 1)})`;
        if (from.k === 'num' && from.v === 0) return [base, ATOM];
        return [`${base} + ${this.sub(from, V.add + 1)}`, V.add];
      }
      case 'join':
        if (!e.parts.length) return ['""', ATOM];
        if (e.parts.length === 1) return this.isStringy(e.parts[0]) ? this.expr(e.parts[0]!) : [`CStr(${this.sub(e.parts[0])})`, ATOM];
        return [e.parts.map((p, i) => this.concatPart(p, i === 0)).join(' & '), V.concat];
      case 'len': {
        const ofList = e.of === 'list' || (e.of === 'auto' && isList(this.typeOf(e.a)));
        if (ofList) return [`(UBound(${this.sub(e.a)}) - LBound(${this.sub(e.a)}) + 1)`, ATOM];
        return [`Len(${this.sub(e.a)})`, ATOM];
      }
      case 'ask': {
        const call = `InputBox(${this.sub(e.prompt, 0, { k: 'str', v: '' })})`;
        return [e.as === 'int' ? `CLng(${call})` : e.as === 'float' ? `CDbl(${call})` : call, ATOM];
      }
      case 'convert': {
        const t = this.typeOf(e.a);
        if (e.to === 'text') return t === 'string' ? this.expr(e.a!) : [`CStr(${this.sub(e.a)})`, ATOM];
        if (e.to === 'int') {
          if (t === 'int') return this.expr(e.a!);
          if (t === 'double') return [`Fix(${this.sub(e.a)})`, ATOM];
          return [`CLng(${this.sub(e.a)})`, ATOM];
        }
        if (t === 'double') return this.expr(e.a!);
        return [`CDbl(${this.sub(e.a)})`, ATOM];
      }
      case 'list':
        return [`Array(${this.args(e.items)})`, ATOM];
      case 'index':
        if (this.typeOf(e.list) === 'string') return [`Mid(${this.sub(e.list)}, ${this.sub(e.index, V.add + 1)} + 1, 1)`, ATOM];
        return [`${this.sub(e.list, ATOM)}(${this.sub(e.index, 0, { k: 'num', v: 0 })})`, ATOM];
      case 'call':
        return [`${this.id(e.name)}(${this.args(e.args)})`, ATOM];
      case 'lib':
        return this.libCode(e.lib, e.fn, e.args, e.get);
      case 'method': {
        const cls = this.isClassType(e.obj);
        if (cls) return [`${cls}_${e.name}(${this.args([e.obj, ...e.args])})`, ATOM];
        return [`${this.sub(e.obj, ATOM)}.${e.name}(${this.args(e.args)})`, ATOM];
      }
      case 'self':
        return ['self', ATOM];
      case 'new':
        return [`Neu${e.cls}(${this.args(e.args)})`, ATOM];
      case 'member':
        return [`${this.sub(e.obj, ATOM)}.${e.name}`, ATOM];
      case 'cond':
        return [`IIf(${this.sub(e.cond)}, ${this.sub(e.a)}, ${this.sub(e.b)})`, ATOM];
      case 'errmsg':
        return this.currentCatch() ? ['Err.Description', ATOM] : ['""', ATOM];
      case 'dict':
        if (!e.entries.length) return ['CreateObject("Scripting.Dictionary")', ATOM];
        this.useHelper('NewDict');
        return [`NewDict(${e.entries.flatMap((x) => [this.sub(x.key), this.sub(x.value)]).join(', ')})`, ATOM];
      case 'dget':
        return [`${this.sub(e.dict, ATOM)}(${this.sub(e.key)})`, ATOM];
      case 'raw':
        return this.rawCode(e.code, e.lang);
      default:
        this.warn(`Interner Fehler: unbekannter Ausdruck ${e.k}`);
    }
    return ['0', ATOM];
  }
}
