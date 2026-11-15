// Runs a program directly (the "green flag"). Works the same for all languages.

import { type Analysis, MAIN, type Ty, analyze, dictParts, elemOf, isList } from './analysis';
import type { Ex, Expr, Lang, Program, Stmt } from './ir';
import { CTOR, methodPlace } from './ir';
import { dictKeys, findLibFn, isExternalLib } from './library';

export interface RunHost {
  /** Text to show in the console (contains "\n" where a line ends). */
  write(text: string): void;
  input(prompt: string): Promise<string>;
  /** Called before every statement (used for highlighting / slow motion). */
  step?(blockId: string | undefined): Promise<void> | void;
  shouldStop(): boolean;
  /** Files the program can read and write (default: kept in memory while the page is open). */
  files?: Map<string, string>;
  /** Called whenever the drawing ("Zeichnen" library) changes. */
  draw?(drawing: Drawing): void;
}

export interface DrawLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

/** State of the drawing turtle (0, 0 is the centre, y points up, angle 0 points right). */
export interface Drawing {
  lines: DrawLine[];
  x: number;
  y: number;
  angle: number;
  down: boolean;
  color: string;
  width: number;
}

/** Files of the built-in runner when the host does not provide its own. */
export const memoryFiles = new Map<string, string>();

export class RunError extends Error {
  constructor(
    message: string,
    public blockId?: string,
  ) {
    super(message);
  }
}

class Stop extends Error {}
class Break {}
class Continue {}
class Return {
  constructor(public value: any) {}
}

type Frame = { place: string; vars: Map<string, any>; self?: Obj };

/** An object of a user-defined class. */
export class Obj {
  fields = new Map<string, any>();
  constructor(public cls: string) {}
}

/**
 * Formats a value the way the real program in `lang` would print it.
 * `ty` is the static type (int / double / list<...>) so that 7.0 prints as "7.0" in Java and Python.
 * `printed`: the value is printed directly (JavaScript prints lists differently than it converts them).
 */
export function formatValue(v: any, lang: Lang, ty: Ty = '', printed = false, nested = false): string {
  if (typeof v === 'boolean') return ['python', 'csharp', 'vba'].includes(lang) ? (v ? 'True' : 'False') : v ? 'true' : 'false';
  if (typeof v === 'number') return formatNumber(v, lang, ty === 'double' || (!Number.isInteger(v) && ty !== 'int'));
  if (Array.isArray(v)) {
    const el = elemOf(ty);
    if (lang === 'javascript') {
      if (!printed && !nested) return v.map((x) => formatValue(x, lang, el)).join(',');
      const items = v.map((x) => (typeof x === 'string' ? `'${x}'` : formatValue(x, lang, el, true, true)));
      return items.length ? `[ ${items.join(', ')} ]` : '[]';
    }
    return '[' + v.map((x) => formatValue(x, lang, el, printed, true)).join(', ') + ']';
  }
  if (v instanceof Map) {
    const [kt, vt] = dictParts(ty);
    const q = (x: any, t: Ty) => (typeof x === 'string' && (lang === 'python' || lang === 'javascript') ? `'${x}'` : formatValue(x, lang, t, printed, true));
    const items = [...v].map(([k, x]) => (lang === 'java' ? `${q(k, kt)}=${q(x, vt)}` : lang === 'javascript' ? `${q(k, kt)} => ${q(x, vt)}` : `${q(k, kt)}: ${q(x, vt)}`));
    if (lang === 'javascript') return `Map(${v.size}) {${items.length ? ' ' + items.join(', ') + ' ' : ''}}`;
    return `{${items.join(', ')}}`;
  }
  if (v instanceof Obj) return `${v.cls}(${[...v.fields].map(([k, x]) => `${k}=${formatValue(x, lang, '', printed, true)}`).join(', ')})`;
  if (typeof v === 'string' && nested && lang === 'python') return `'${v}'`;
  if (v === undefined || v === null) return '';
  return String(v);
}

function formatNumber(v: number, lang: Lang, isDouble: boolean): string {
  if (Number.isNaN(v)) return lang === 'python' ? 'nan' : 'NaN';
  if (!Number.isFinite(v)) return lang === 'python' ? (v > 0 ? 'inf' : '-inf') : v > 0 ? 'Infinity' : '-Infinity';
  if (!isDouble) return String(v);
  switch (lang) {
    case 'python':
      return Number.isInteger(v) && Math.abs(v) < 1e16 ? v.toFixed(1) : String(v).replace(/e\+?/, 'e+').replace('e+-', 'e-');
    case 'java': {
      const a = Math.abs(v);
      if (a !== 0 && (a >= 1e7 || a < 1e-3)) {
        const [m, ex] = v.toExponential().split('e');
        return `${m.includes('.') ? m : m + '.0'}E${Number(ex)}`;
      }
      return Number.isInteger(v) ? v.toFixed(1) : String(v);
    }
    case 'cpp':
      return formatG(v, 6);
    case 'vba':
      return String(Number(v.toPrecision(15)));
    default:
      return String(v);
  }
}

/** printf("%g") */
function formatG(v: number, digits: number): string {
  if (v === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(v)));
  if (exp < -4 || exp >= digits) {
    const [m, e] = v.toExponential(digits - 1).split('e');
    const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
    const n = Number(e);
    return `${mant}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  }
  const s = v.toFixed(Math.max(0, digits - 1 - exp));
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Rounding as the language's round function does it. */
function roundLike(x: number, lang: Lang): number {
  if (lang === 'python' || lang === 'csharp' || lang === 'vba') {
    const f = Math.floor(x);
    const diff = x - f;
    if (diff > 0.5) return f + 1;
    if (diff < 0.5) return f;
    return f % 2 === 0 ? f : f + 1; // half to even
  }
  if (lang === 'cpp') return Math.sign(x) * Math.round(Math.abs(x)); // half away from zero
  return Math.round(x); // Java, JavaScript: half up
}

export async function runProgram(program: Program, host: RunHost, lang: Lang): Promise<void> {
  const r = new Runner(program, host, lang);
  await r.run();
}

class Runner {
  a: Analysis;
  globals = new Map<string, any>();
  stack: Frame[] = [];
  steps = 0;
  current?: string;
  fns: Map<string, Program['functions'][number]>;

  constructor(
    public program: Program,
    public host: RunHost,
    public lang: Lang,
  ) {
    this.a = analyze(program);
    this.fns = new Map(program.functions.map((f) => [f.name, f]));
  }

  async run() {
    if (!this.program.main) throw new RunError('Es gibt keinen Block "Wenn Programm startet".');
    this.stack.push({ place: MAIN, vars: this.globals });
    try {
      await this.block(this.program.main);
    } catch (e) {
      if (e instanceof Stop) return;
      if (e instanceof Return) return;
      if (e instanceof Break || e instanceof Continue) return;
      throw e;
    }
  }

  /** Static type of an expression in the current function. */
  ty(e: Ex): Ty {
    return e ? this.a.typeOf(e, this.frame.place) : '';
  }

  drawing: Drawing = { lines: [], x: 0, y: 0, angle: 0, down: true, color: 'black', width: 1 };

  turtle(op: string, a: any[]) {
    const d = this.drawing;
    const moveTo = (x: number, y: number) => {
      if (d.down) d.lines.push({ x1: d.x, y1: d.y, x2: x, y2: y, color: d.color, width: d.width });
      d.x = x;
      d.y = y;
    };
    switch (op) {
      case 'forward': {
        const n = this.num(a[0]);
        const r = (d.angle * Math.PI) / 180;
        moveTo(d.x + n * Math.cos(r), d.y + n * Math.sin(r));
        break;
      }
      case 'right':
        d.angle -= this.num(a[0]);
        break;
      case 'left':
        d.angle += this.num(a[0]);
        break;
      case 'penup':
        d.down = false;
        break;
      case 'pendown':
        d.down = true;
        break;
      case 'pencolor':
        d.color = String(a[0]);
        break;
      case 'pensize':
        d.width = this.num(a[0]);
        break;
      case 'goto':
        moveTo(this.num(a[0]), this.num(a[1]));
        break;
      case 'clear':
        d.lines = [];
        break;
    }
    this.host.draw?.(d);
  }

  /** Messages of the errors caught by the surrounding "versuche" blocks. */
  errors: string[] = [];

  get frame(): Frame {
    return this.stack[this.stack.length - 1];
  }

  err(msg: string): never {
    throw new RunError(msg, this.current);
  }

  defaultFor(name: string, place: string): any {
    const t = this.a.varType(name, place);
    if (t === 'string') return '';
    if (t === 'bool') return false;
    if (isList(t)) return [];
    return 0;
  }

  scopeFor(name: string): Map<string, any> {
    const f = this.frame;
    if (f.place !== MAIN) {
      const p = this.a.place(f.place);
      if (p.params.includes(name) || p.locals.has(name)) return f.vars;
    }
    return this.globals;
  }

  get(name: string): any {
    const scope = this.scopeFor(name);
    if (!scope.has(name)) scope.set(name, this.defaultFor(name, this.frame.place));
    return scope.get(name);
  }

  set(name: string, value: any) {
    this.scopeFor(name).set(name, value);
  }

  async tick(id?: string) {
    if (id) this.current = id;
    if (this.host.shouldStop()) throw new Stop();
    if (this.host.step) await this.host.step(id);
    if (++this.steps % 400 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  async block(stmts: Stmt[]) {
    for (const s of stmts) await this.stmt(s);
  }

  async loopBody(body: Stmt[]): Promise<'break' | 'continue' | null> {
    try {
      await this.block(body);
    } catch (e) {
      if (e instanceof Break) return 'break';
      if (e instanceof Continue) return 'continue';
      throw e;
    }
    return null;
  }

  async stmt(s: Stmt): Promise<void> {
    await this.tick(s.id);
    switch (s.k) {
      case 'print': {
        const v = await this.expr(s.value);
        this.host.write(formatValue(v, this.lang, this.ty(s.value), true) + (s.newline ? '\n' : ''));
        return;
      }
      case 'set':
        this.set(s.name, await this.expr(s.value));
        return;
      case 'change': {
        const old = this.get(s.name);
        const by = await this.expr(s.by);
        this.set(s.name, this.num(old, s.name) + this.num(by));
        return;
      }
      case 'if':
        for (const b of s.branches) {
          if (this.truthy(await this.expr(b.cond))) {
            await this.block(b.body);
            return;
          }
        }
        if (s.else) await this.block(s.else);
        return;
      case 'repeat': {
        const n = this.num(await this.expr(s.times));
        for (let i = 0; i < n; i++) {
          const r = await this.loopBody(s.body);
          if (r === 'break') break;
          await this.tick();
        }
        return;
      }
      case 'while':
        while (true) {
          if (!s.post) {
            const c = this.truthy(await this.expr(s.cond));
            if (s.until ? c : !c) break;
          }
          const r = await this.loopBody(s.body);
          if (r === 'break') break;
          if (s.post) {
            const c = this.truthy(await this.expr(s.cond));
            if (s.until ? c : !c) break;
          }
          await this.tick();
        }
        return;
      case 'try':
        try {
          await this.block(s.body);
        } catch (e) {
          if (!(e instanceof RunError)) throw e;
          this.errors.push(e.message);
          try {
            await this.block(s.handler);
          } finally {
            this.errors.pop();
          }
        }
        return;
      case 'throw':
        this.err(formatValue(await this.expr(s.value), this.lang, this.ty(s.value)) || 'Fehler');
        break;
      case 'dset': {
        const d = await this.expr(s.dict);
        if (!(d instanceof Map)) this.err('Hier wird ein Wörterbuch erwartet.');
        d.set(await this.expr(s.key), await this.expr(s.value));
        return;
      }
      case 'for': {
        const from = this.num(await this.expr(s.from));
        const to = this.num(await this.expr(s.to));
        const by = s.by ? this.num(await this.expr(s.by)) : 1;
        if (by === 0) this.err('Die Schrittweite der Zählschleife darf nicht 0 sein.');
        for (let i = from; by > 0 ? i <= to : i >= to; i += by) {
          this.set(s.var, i);
          const r = await this.loopBody(s.body);
          if (r === 'break') break;
          i = this.num(this.get(s.var));
          await this.tick();
        }
        return;
      }
      case 'foreach': {
        let list = await this.expr(s.list);
        if (typeof list === 'string') list = [...list];
        if (list instanceof Map) list = dictKeys(list, this.lang === 'cpp');
        if (!Array.isArray(list)) this.err('"für jedes Element" braucht eine Liste.');
        for (let i = 0; i < list.length; i++) {
          this.set(s.var, list[i]);
          const r = await this.loopBody(s.body);
          if (r === 'break') break;
          await this.tick();
        }
        return;
      }
      case 'break':
        throw new Break();
      case 'continue':
        throw new Continue();
      case 'listadd': {
        const list = this.list(await this.expr(s.list));
        list.push(await this.expr(s.value));
        return;
      }
      case 'listset': {
        const list = this.list(await this.expr(s.list));
        const i = this.index(list, await this.expr(s.index));
        list[i] = await this.expr(s.value);
        return;
      }
      case 'callstmt':
        await this.call(s.name, s.args);
        return;
      case 'libstmt':
        await this.lib(s.lib, s.fn, s.args);
        return;
      case 'methodstmt':
        await this.callMethod(await this.expr(s.obj), s.name, s.args);
        return;
      case 'fset': {
        const obj = await this.expr(s.obj);
        if (!(obj instanceof Obj)) this.err(`"${s.name}" kann nur bei Objekten eigener Klassen gesetzt werden.`);
        obj.fields.set(s.name, await this.expr(s.value));
        return;
      }
      case 'return':
        throw new Return(s.value ? await this.expr(s.value) : undefined);
      case 'comment':
        return;
      case 'raw':
        this.err('Ein Code-Block kann in der eingebauten Ausführung nicht laufen.');
        break;
      case 'pexpr':
        await this.expr(s.e);
        return;
    }
  }

  /** Creates an object: start values of the properties, then the constructor. */
  async create(cls: string, argExprs: Ex[]): Promise<Obj> {
    const c = this.program.classes?.find((x) => x.name === cls);
    if (!c) this.err(`Die Klasse "${cls}" gibt es nicht.`);
    const obj = new Obj(cls);
    const args: any[] = [];
    for (const a of argExprs) args.push(await this.expr(a));
    const place = methodPlace(cls, CTOR);
    const vars = new Map<string, any>();
    c.ctorParams.forEach((p, i) => vars.set(p, args[i] ?? this.defaultFor(p, place)));
    this.stack.push({ place, vars, self: obj });
    const saved = this.current;
    try {
      for (const f of c.fields) obj.fields.set(f.name, await this.expr(f.value));
      await this.block(c.ctor);
    } catch (e) {
      if (!(e instanceof Return)) throw e;
    } finally {
      this.stack.pop();
      this.current = saved;
    }
    return obj;
  }

  async callMethod(obj: any, name: string, argExprs: Ex[]): Promise<any> {
    if (!(obj instanceof Obj)) this.err(`Die Methode "${name}" kann die eingebaute Ausführung nicht ausführen.`);
    const m = this.program.classes?.find((x) => x.name === obj.cls)?.methods.find((x) => x.name === name);
    if (!m) this.err(`Die Klasse "${obj.cls}" hat keine Methode "${name}".`);
    if (this.stack.length > 1500) this.err('Zu viele verschachtelte Aufrufe (endlose Rekursion?).');
    const args: any[] = [];
    for (const a of argExprs) args.push(await this.expr(a));
    const place = methodPlace(obj.cls, name);
    const vars = new Map<string, any>();
    m.params.forEach((p, i) => vars.set(p, args[i] ?? this.defaultFor(p, place)));
    this.stack.push({ place, vars, self: obj });
    const saved = this.current;
    try {
      await this.block(m.body);
    } catch (e) {
      if (e instanceof Return) return e.value;
      throw e;
    } finally {
      this.stack.pop();
      this.current = saved;
    }
    return undefined;
  }

  async call(name: string, argExprs: Ex[]): Promise<any> {
    const f = this.fns.get(name);
    if (!f) this.err(`Die Funktion "${name}" gibt es nicht.`);
    if (this.stack.length > 1500) this.err('Zu viele verschachtelte Funktionsaufrufe (endlose Rekursion?).');
    const args: any[] = [];
    for (const a of argExprs) args.push(await this.expr(a));
    const vars = new Map<string, any>();
    f.params.forEach((p, i) => vars.set(p, args[i] ?? this.defaultFor(p, f.name)));
    this.stack.push({ place: f.name, vars });
    const saved = this.current;
    try {
      await this.block(f.body);
    } catch (e) {
      if (e instanceof Return) return e.value;
      throw e;
    } finally {
      this.stack.pop();
      this.current = saved;
    }
    return f.returns ? this.defaultFor('__ret__', f.name) : undefined;
  }

  async lib(lib: string, fn: string, argExprs: Ex[]): Promise<any> {
    if (isExternalLib(lib)) {
      const mod = lib.slice(4);
      this.err(mod ? `Die Bibliothek "${mod}" kann die eingebaute Ausführung nicht ausführen.` : `Die Funktion "${fn}" kann die eingebaute Ausführung nicht ausführen.`);
    }
    const def = findLibFn(lib, fn);
    if (!def) this.err(`Unbekannte Bibliotheksfunktion ${lib}.${fn}.`);
    const args: any[] = [];
    for (const a of argExprs) args.push(await this.expr(a));
    return await def.run(args, {
      files: this.host.files ?? memoryFiles,
      turtle: (op, a) => this.turtle(op, a),
      random: Math.random,
      sleep: async (sec) => {
        const end = Date.now() + Math.max(0, sec) * 1000;
        while (Date.now() < end) {
          if (this.host.shouldStop()) throw new Stop();
          await new Promise((r) => setTimeout(r, Math.min(50, end - Date.now())));
        }
      },
      error: (m) => this.err(m),
      sortedKeys: this.lang === 'cpp',
    });
  }

  num(v: any, name?: string): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    this.err(name ? `"${name}" enthält keine Zahl, sondern "${formatValue(v, this.lang)}".` : `Hier wird eine Zahl erwartet, nicht "${formatValue(v, this.lang)}".`);
  }

  truthy(v: any): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v !== '';
    if (Array.isArray(v)) return v.length > 0;
    return !!v;
  }

  list(v: any): any[] {
    if (!Array.isArray(v)) this.err('Hier wird eine Liste erwartet.');
    return v;
  }

  index(list: any[], i: any): number {
    const n = this.num(i);
    if (!Number.isInteger(n) || n < 0 || n >= list.length) {
      this.err(`Position ${formatValue(i, this.lang)} gibt es nicht (die Liste hat ${list.length} Elemente, gezählt ab 0).`);
    }
    return n;
  }

  async expr(e: Ex): Promise<any> {
    if (!e) return 0;
    if (e.id) this.current = e.id;
    switch (e.k) {
      case 'num':
      case 'str':
      case 'bool':
        return e.v;
      case 'var':
        return this.get(e.name);
      case 'bin':
        return this.bin(e);
      case 'not':
        return !this.truthy(await this.expr(e.a));
      case 'math': {
        const x = this.num(await this.expr(e.a));
        switch (e.fn) {
          case 'sqrt':
            if (x < 0) this.err('Die Wurzel aus einer negativen Zahl gibt es nicht.');
            return Math.sqrt(x);
          case 'abs':
            return Math.abs(x);
          case 'neg':
            return -x;
          case 'ln':
            return Math.log(x);
          case 'log10':
            return Math.log10(x);
          case 'exp':
            return Math.exp(x);
          case 'pow10':
            return 10 ** x;
          case 'round':
            return roundLike(x, this.lang);
          case 'ceil':
            return Math.ceil(x);
          case 'floor':
            return Math.floor(x);
        }
        break;
      }
      case 'random': {
        const a = Math.ceil(this.num(await this.expr(e.from)));
        const b = Math.floor(this.num(await this.expr(e.to)));
        return a + Math.floor(Math.random() * (b - a + 1));
      }
      case 'join': {
        let out = '';
        for (const p of e.parts) out += formatValue(await this.expr(p), this.lang, this.ty(p));
        return out;
      }
      case 'len': {
        const v = await this.expr(e.a);
        if (typeof v === 'string' || Array.isArray(v)) return v.length;
        return formatValue(v, this.lang).length;
      }
      case 'ask': {
        const prompt = formatValue(await this.expr(e.prompt), this.lang);
        const answer = await this.host.input(prompt);
        if (this.host.shouldStop()) throw new Stop();
        if (e.as === 'text') return answer;
        return this.toNumber(answer, e.as === 'int');
      }
      case 'convert': {
        const v = await this.expr(e.a);
        if (e.to === 'text') return formatValue(v, this.lang, this.ty(e.a));
        if (typeof v === 'number') return e.to === 'int' ? Math.trunc(v) : v;
        return this.toNumber(formatValue(v, this.lang), e.to === 'int');
      }
      case 'list': {
        const out: any[] = [];
        for (const it of e.items) out.push(await this.expr(it));
        return out;
      }
      case 'index': {
        const l = await this.expr(e.list);
        if (typeof l === 'string') return l[this.index([...l], await this.expr(e.index))];
        const list = this.list(l);
        return list[this.index(list, await this.expr(e.index))];
      }
      case 'call': {
        const id = e.id;
        const r = await this.call(e.name, e.args);
        this.current = id;
        return r;
      }
      case 'lib':
        return this.lib(e.lib, e.fn, e.args);
      case 'cond':
        return this.truthy(await this.expr(e.cond)) ? this.expr(e.a) : this.expr(e.b);
      case 'errmsg':
        return this.errors[this.errors.length - 1] ?? '';
      case 'dict': {
        const m = new Map<any, any>();
        for (const x of e.entries) m.set(await this.expr(x.key), await this.expr(x.value));
        return m;
      }
      case 'dget': {
        const d = await this.expr(e.dict);
        if (!(d instanceof Map)) this.err('Hier wird ein Wörterbuch erwartet.');
        const k = await this.expr(e.key);
        if (!d.has(k)) this.err(`Den Schlüssel ${formatValue(k, this.lang)} gibt es im Wörterbuch nicht.`);
        return d.get(k);
      }
      case 'method': {
        const id = e.id;
        const r = await this.callMethod(await this.expr(e.obj), e.name, e.args);
        this.current = id;
        return r;
      }
      case 'member': {
        const obj = await this.expr(e.obj);
        if (!(obj instanceof Obj)) this.err(`"${e.name}" kann die eingebaute Ausführung nicht auswerten.`);
        if (!obj.fields.has(e.name)) this.err(`Das Objekt hat keine Eigenschaft "${e.name}".`);
        return obj.fields.get(e.name);
      }
      case 'self': {
        const f = [...this.stack].reverse().find((x) => x.self);
        if (!f?.self) this.err('"dieses Objekt" gibt es nur in Methoden einer Klasse.');
        return f.self;
      }
      case 'new':
        return this.create(e.cls, e.args);
      case 'raw':
        this.err('Ein Code-Block kann in der eingebauten Ausführung nicht laufen.');
        break;
      default:
        this.err(`Dieser Ausdruck kann nicht ausgeführt werden (${e.k}).`);
    }
  }

  toNumber(text: string, int: boolean): number {
    const t = text.trim().replace(',', '.');
    const v = Number(t);
    if (t === '' || Number.isNaN(v)) this.err(`"${text}" ist keine ${int ? 'ganze Zahl' : 'Zahl'}.`);
    if (int && !Number.isInteger(v)) this.err(`"${text}" ist keine ganze Zahl.`);
    return v;
  }

  async bin(e: Expr & { k: 'bin' }): Promise<any> {
    if (e.op === 'AND') return this.truthy(await this.expr(e.a)) && this.truthy(await this.expr(e.b));
    if (e.op === 'OR') return this.truthy(await this.expr(e.a)) || this.truthy(await this.expr(e.b));
    const a = await this.expr(e.a);
    const b = await this.expr(e.b);
    this.current = e.id ?? this.current;
    switch (e.op) {
      case 'ADD':
        if (typeof a === 'string' || typeof b === 'string') return formatValue(a, this.lang, this.ty(e.a)) + formatValue(b, this.lang, this.ty(e.b));
        if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
        return this.num(a) + this.num(b);
      case 'SUB':
        return this.num(a) - this.num(b);
      case 'MUL':
        if (typeof a === 'string' && typeof b === 'number') return a.repeat(Math.max(0, b));
        return this.num(a) * this.num(b);
      case 'DIV':
        if (this.num(b) === 0) this.err('Durch 0 kann man nicht teilen.');
        return this.num(a) / this.num(b);
      case 'IDIV': {
        if (this.num(b) === 0) this.err('Durch 0 kann man nicht teilen.');
        const q = this.num(a) / this.num(b);
        return e.trunc ? Math.trunc(q) : Math.floor(q);
      }
      case 'MOD': {
        if (this.num(b) === 0) this.err('Durch 0 kann man nicht teilen.');
        const x = this.num(a);
        const y = this.num(b);
        return e.trunc ? x % y : ((x % y) + y) % y;
      }
      case 'POW':
        return this.num(a) ** this.num(b);
      case 'EQ':
        return equals(a, b);
      case 'NEQ':
        return !equals(a, b);
      case 'LT':
        return compare(a, b) < 0;
      case 'LTE':
        return compare(a, b) <= 0;
      case 'GT':
        return compare(a, b) > 0;
      case 'GTE':
        return compare(a, b) >= 0;
    }
  }
}

function equals(a: any, b: any): boolean {
  if (a instanceof Map || b instanceof Map) return a instanceof Map && b instanceof Map && JSON.stringify([...a]) === JSON.stringify([...b]);
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function compare(a: any, b: any): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
