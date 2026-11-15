// Scope analysis and type inference shared by the code generators and the runner.

import {
  childBodies,
  type Ex,
  type Expr,
  type FunctionDef,
  type Program,
  type Stmt,
  stmtExprs,
  walkExpr,
  walkStmts,
} from './ir';
import { findLibFn, isExternalLib } from './library';

/** Types are plain strings: int, double, string, bool, any, ? (unknown) and list<T>. */
export type Ty = string;

export const MAIN = '';

export const isList = (t: Ty) => t.startsWith('list<');
export const isDict = (t: Ty) => t.startsWith('dict<');
/** Element type when iterating: list element, character of a text, key of a dictionary. */
export const elemOf = (t: Ty): Ty => (isList(t) ? t.slice(5, -1) : isDict(t) ? dictParts(t)[0] : t === 'string' ? 'string' : '?');
export const listOf = (t: Ty): Ty => `list<${t}>`;
export const dictOf = (k: Ty, v: Ty): Ty => `dict<${k}|${v}>`;
export const isNumeric = (t: Ty) => t === 'int' || t === 'double';

/** dict<K|V> -> [K, V] */
export function dictParts(t: Ty): [Ty, Ty] {
  if (!isDict(t)) return ['?', '?'];
  const inner = t.slice(5, -1);
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '<') depth++;
    else if (inner[i] === '>') depth--;
    else if (inner[i] === '|' && depth === 0) return [inner.slice(0, i), inner.slice(i + 1)];
  }
  return ['?', '?'];
}

export function unify(a: Ty, b: Ty): Ty {
  if (a === b) return a;
  if (a === '?') return b;
  if (b === '?') return a;
  if (isNumeric(a) && isNumeric(b)) return 'double';
  if (isList(a) && isList(b)) return listOf(unify(elemOf(a), elemOf(b)));
  if (isDict(a) && isDict(b)) {
    const [ka, va] = dictParts(a);
    const [kb, vb] = dictParts(b);
    return dictOf(unify(ka, kb), unify(va, vb));
  }
  return 'any';
}

/** Replaces unknown parts by a default. */
export function resolveTy(t: Ty, def: Ty = 'int'): Ty {
  if (t === '?') return def;
  if (isList(t)) return listOf(resolveTy(elemOf(t), def));
  if (isDict(t)) {
    const [k, v] = dictParts(t);
    return dictOf(resolveTy(k, 'string'), resolveTy(v, def));
  }
  return t;
}

export interface PlaceInfo {
  /** '' = main program, otherwise function name. */
  name: string;
  def: FunctionDef | null;
  body: Stmt[];
  params: string[];
  /** Variables local to this place (not params). */
  locals: Set<string>;
  /** Global variables that are assigned inside this function (Python needs "global"). */
  assignedGlobals: Set<string>;
  /** Variables that are only used as loop variables of for / for-each loops. */
  loopOnly: Set<string>;
}

export interface Analysis {
  program: Program;
  places: PlaceInfo[];
  place(name: string): PlaceInfo;
  globals: Set<string>;
  /** Final type of a variable in a place. */
  varType(name: string, place: string): Ty;
  typeOf(e: Ex, place: string): Ty;
  paramTypes(fn: string): Ty[];
  returnType(fn: string): Ty;
  functionReturns(fn: string): boolean;
  isUserFunction(name: string): boolean;
  /** All identifiers used anywhere (to pick fresh helper names). */
  allNames: Set<string>;
  warnings: string[];
}

export function namesIn(stmts: Stmt[]): Set<string> {
  const names = new Set<string>();
  walkStmts(stmts, (s) => {
    if (s.k === 'set' || s.k === 'change') names.add(s.name);
    if (s.k === 'for' || s.k === 'foreach') names.add(s.var);
    for (const e of stmtExprs(s)) walkExpr(e, (x) => x.k === 'var' && names.add(x.name));
  });
  return names;
}

function assignedIn(stmts: Stmt[]): Set<string> {
  const names = new Set<string>();
  walkStmts(stmts, (s) => {
    if (s.k === 'set' || s.k === 'change') names.add(s.name);
    if (s.k === 'for' || s.k === 'foreach') names.add(s.var);
  });
  return names;
}

/** Is the first use of `name` in this body an assignment (that does not read the variable)? */
export function writtenBeforeRead(body: Stmt[], name: string): boolean {
  let result: boolean | null = null;
  walkStmts(body, (s) => {
    if (result !== null) return;
    let reads = false;
    for (const e of stmtExprs(s)) walkExpr(e, (x) => x.k === 'var' && x.name === name && (reads = true));
    if (reads) result = false;
    else if ((s.k === 'set' && s.name === name) || ((s.k === 'for' || s.k === 'foreach') && s.var === name)) result = true;
    else if (s.k === 'change' && s.name === name) result = false;
  });
  return result === true;
}

function computeLoopOnly(body: Stmt[]): Set<string> {
  const loopVars = new Set<string>();
  const other = new Set<string>();
  const visit = (stmts: Stmt[], active: string[]) => {
    for (const s of stmts) {
      const mark = (n: string) => {
        if (!active.includes(n)) other.add(n);
      };
      for (const e of stmtExprs(s)) walkExpr(e, (x) => x.k === 'var' && mark(x.name));
      if (s.k === 'set' || s.k === 'change') mark(s.name);
      if (s.k === 'for' || s.k === 'foreach') {
        if (active.includes(s.var)) other.add(s.var);
        loopVars.add(s.var);
        visit(s.body, [...active, s.var]);
      } else {
        for (const b of childBodies(s)) visit(b, active);
      }
    }
  };
  visit(body, []);
  return new Set([...loopVars].filter((n) => !other.has(n)));
}

export function analyze(program: Program): Analysis {
  const warnings: string[] = [];
  const meta = program.meta ?? {};
  const placeList: { name: string; def: FunctionDef | null; body: Stmt[]; params: string[] }[] = [
    { name: MAIN, def: null, body: program.main ?? [], params: [] },
    ...program.functions.map((f) => ({ name: f.name, def: f, body: f.body, params: f.params })),
  ];
  const fnByName = new Map(program.functions.map((f) => [f.name, f]));

  // --- scopes ---------------------------------------------------------------
  const usedIn = new Map<string, Set<string>>(); // var -> places (excluding params / explicit locals)
  const shapeLocal = new Set<string>(); // "place:name" local because of how it is used
  const explicitLocal = (place: string, name: string) => !!meta.locals?.[place]?.includes(name) || shapeLocal.has(`${place}:${name}`);
  for (const p of placeList) {
    for (const n of namesIn(p.body)) {
      if (p.params.includes(n) || explicitLocal(p.name, n)) continue;
      if (!usedIn.has(n)) usedIn.set(n, new Set());
      usedIn.get(n)!.add(p.name);
    }
  }
  // A variable that only appears inside functions and is always written there before it is
  // read (e.g. a loop counter or a temporary result) is local to each of these functions.
  for (const [n, used] of [...usedIn]) {
    if (used.size < 2 || used.has(MAIN)) continue;
    if (![...used].every((pl) => writtenBeforeRead(placeList.find((x) => x.name === pl)!.body, n))) continue;
    for (const pl of used) shapeLocal.add(`${pl}:${n}`);
    usedIn.delete(n);
  }
  const globals = new Set<string>();
  for (const [n, places] of usedIn) if (places.size > 1) globals.add(n);
  // Variables declared at program level in typed code stay global.
  for (const key of Object.keys(meta.types ?? {})) {
    const [scope, name] = splitKey(key);
    if (scope === MAIN && usedIn.has(name) && [...usedIn.get(name)!].some((p) => p !== MAIN)) globals.add(name);
  }

  const places: PlaceInfo[] = placeList.map((p) => {
    const names = namesIn(p.body);
    const locals = new Set<string>();
    const assignedGlobals = new Set<string>();
    const assigned = assignedIn(p.body);
    for (const n of names) {
      if (p.params.includes(n)) continue;
      if (globals.has(n) && !explicitLocal(p.name, n)) {
        if (assigned.has(n)) assignedGlobals.add(n);
      } else locals.add(n);
    }
    return { ...p, locals, assignedGlobals, loopOnly: computeLoopOnly(p.body) };
  });
  const placeMap = new Map(places.map((p) => [p.name, p]));

  // --- types ----------------------------------------------------------------
  const hints = meta.types ?? {};
  const tables = new Map<string, Map<string, Ty>>(); // scope ('' for globals/main) -> name -> type
  const usage = new Map<string, Ty>();
  const scopeOf = (name: string, place: string): string => {
    const p = placeMap.get(place);
    if (p && place !== MAIN && (p.params.includes(name) || p.locals.has(name))) return place;
    return MAIN;
  };
  const keyOf = (name: string, place: string) => `${scopeOf(name, place)}:${name}`;
  const table = (scope: string) => {
    if (!tables.has(scope)) tables.set(scope, new Map());
    return tables.get(scope)!;
  };
  const rawVarType = (name: string, place: string): Ty => {
    const key = keyOf(name, place);
    if (hints[key]) return hints[key];
    return table(scopeOf(name, place)).get(name) ?? '?';
  };
  const retTypes = new Map<string, Ty>();
  let changed = false;
  const assign = (name: string, place: string, t: Ty) => {
    const key = keyOf(name, place);
    if (hints[key]) return;
    const tb = table(scopeOf(name, place));
    const old = tb.get(name) ?? '?';
    const next = unify(old, t);
    if (next !== old) {
      tb.set(name, next);
      changed = true;
    }
  };
  const hintUsage = (e: Ex, place: string, t: Ty) => {
    if (!e || e.k !== 'var' || t === '?') return;
    const key = keyOf(e.name, place);
    if (!usage.has(key)) usage.set(key, t);
  };

  const typeOf = (e: Ex, place: string): Ty => {
    if (!e) return '?';
    switch (e.k) {
      case 'num':
        return e.float || !Number.isInteger(e.v) ? 'double' : 'int';
      case 'str':
        return 'string';
      case 'bool':
        return 'bool';
      case 'var':
        return rawVarType(e.name, place);
      case 'bin': {
        const a = typeOf(e.a, place);
        const b = typeOf(e.b, place);
        switch (e.op) {
          case 'ADD':
            if (a === 'string' || b === 'string') return 'string';
            if (isList(a) && isList(b)) return unify(a, b);
          // fallthrough
          case 'SUB':
          case 'MUL':
          case 'MOD': {
            if (e.op === 'MUL' && (a === 'string' || b === 'string')) return 'string';
            const t = unify(isNumeric(a) || a === '?' ? a : 'double', isNumeric(b) || b === '?' ? b : 'double');
            return t === '?' ? 'int' : isNumeric(t) ? t : 'double';
          }
          case 'DIV':
            return 'double';
          case 'POW':
            // int ** non-negative int stays an integer (Python); the other languages cast
            return a === 'int' && b === 'int' && e.b?.k === 'num' && e.b.v >= 0 ? 'int' : 'double';
          case 'IDIV':
            return 'int';
          default:
            return 'bool';
        }
      }
      case 'not':
        return 'bool';
      case 'math':
        if (e.fn === 'round' || e.fn === 'ceil' || e.fn === 'floor') return 'int';
        if (e.fn === 'abs' || e.fn === 'neg') {
          const t = typeOf(e.a, place);
          return isNumeric(t) ? t : 'double';
        }
        return 'double';
      case 'random':
        return 'int';
      case 'join':
        return 'string';
      case 'len':
        return 'int';
      case 'ask':
        return e.as === 'int' ? 'int' : e.as === 'float' ? 'double' : 'string';
      case 'convert':
        return e.to === 'int' ? 'int' : e.to === 'float' ? 'double' : 'string';
      case 'list': {
        let t: Ty = '?';
        for (const it of e.items) t = unify(t, typeOf(it, place));
        return listOf(t);
      }
      case 'index': {
        const lt = typeOf(e.list, place);
        return isDict(lt) ? dictParts(lt)[1] : elemOf(lt);
      }
      case 'call':
        return retTypes.get(e.name) ?? '?';
      case 'lib': {
        if (isExternalLib(e.lib)) return 'any';
        const fn = findLibFn(e.lib, e.fn);
        if (!fn || !fn.returns) return 'any';
        if (fn.returns === 'same') {
          const t = unify(typeOf(e.args[0], place), typeOf(e.args[1], place));
          return isNumeric(t) ? t : 'double';
        }
        if (fn.returns === 'elem') return elemOf(typeOf(e.args[0], place));
        if (fn.returns === 'keys') return listOf(dictParts(typeOf(e.args[0], place))[0]);
        if (fn.returns === 'values') return listOf(dictParts(typeOf(e.args[0], place))[1]);
        return fn.returns;
      }
      case 'cond':
        return unify(typeOf(e.a, place), typeOf(e.b, place));
      case 'errmsg':
        return 'string';
      case 'dict': {
        let k: Ty = '?';
        let v: Ty = '?';
        for (const x of e.entries) {
          k = unify(k, typeOf(x.key, place));
          v = unify(v, typeOf(x.value, place));
        }
        return dictOf(k, v);
      }
      case 'dget':
        return dictParts(typeOf(e.dict, place))[1];
      default:
        return 'any';
    }
  };

  const visitExprHints = (e: Ex, place: string) =>
    walkExpr(e, (x) => {
      switch (x.k) {
        case 'bin': {
          const ta = typeOf(x.a, place);
          const tb = typeOf(x.b, place);
          if (x.op === 'AND' || x.op === 'OR') {
            hintUsage(x.a, place, 'bool');
            hintUsage(x.b, place, 'bool');
          } else if (x.op === 'ADD' && (ta === 'string' || tb === 'string')) {
            // text concatenation: no hint
          } else {
            hintUsage(x.a, place, ta === '?' ? (tb === '?' ? 'int' : tb) : ta);
            hintUsage(x.b, place, tb === '?' ? (ta === '?' ? 'int' : ta) : tb);
          }
          break;
        }
        case 'not':
          hintUsage(x.a, place, 'bool');
          break;
        case 'math':
        case 'random':
          for (const c of x.k === 'math' ? [x.a] : [x.from, x.to]) hintUsage(c, place, 'double');
          break;
        case 'len':
          hintUsage(x.a, place, x.of === 'list' ? 'list<?>' : 'string');
          break;
        case 'index':
          hintUsage(x.list, place, 'list<?>');
          hintUsage(x.index, place, 'int');
          break;
        case 'call': {
          const f = fnByName.get(x.name);
          if (f) x.args.forEach((a, i) => f.params[i] !== undefined && assign(f.params[i], f.name, typeOf(a, place)));
          break;
        }
        case 'lib': {
          const fn = isExternalLib(x.lib) ? undefined : findLibFn(x.lib, x.fn);
          fn?.params.forEach((p, i) =>
            hintUsage(x.args[i], place, p.kind === 'number' ? 'int' : p.kind === 'text' ? 'string' : p.kind === 'list' ? 'list<?>' : p.kind === 'dict' ? 'dict<?|?>' : '?'),
          );
          break;
        }
      }
    });

  for (let pass = 0; pass < 12; pass++) {
    changed = false;
    for (const p of places) {
      walkStmts(p.body, (s) => {
        for (const e of stmtExprs(s)) visitExprHints(e, p.name);
        switch (s.k) {
          case 'set':
            assign(s.name, p.name, typeOf(s.value, p.name));
            break;
          case 'change': {
            const t = typeOf(s.by, p.name);
            assign(s.name, p.name, isNumeric(t) ? t : 'int');
            break;
          }
          case 'for': {
            let t: Ty = '?';
            for (const e of [s.from, s.to, s.by]) t = unify(t, typeOf(e, p.name));
            assign(s.var, p.name, isNumeric(t) ? t : 'int');
            break;
          }
          case 'foreach':
            assign(s.var, p.name, elemOf(typeOf(s.list, p.name)));
            break;
          case 'listadd':
          case 'listset':
            if (s.list?.k === 'var') {
              // d["key"] = value on a dictionary (or with a text key) is a dictionary entry
              const cur = rawVarType(s.list.name, p.name);
              if (s.k === 'listset' && (isDict(cur) || typeOf(s.index, p.name) === 'string')) {
                assign(s.list.name, p.name, dictOf(typeOf(s.index, p.name), typeOf(s.value, p.name)));
                break;
              }
              assign(s.list.name, p.name, listOf(typeOf(s.value, p.name)));
            }
            if (s.k === 'listset') hintUsage(s.index, p.name, 'int');
            break;
          case 'dset':
            if (s.dict?.k === 'var') assign(s.dict.name, p.name, dictOf(typeOf(s.key, p.name), typeOf(s.value, p.name)));
            break;
          case 'callstmt': {
            const f = fnByName.get(s.name);
            if (f) s.args.forEach((a, i) => f.params[i] !== undefined && assign(f.params[i], f.name, typeOf(a, p.name)));
            break;
          }
          case 'return':
            if (p.name !== MAIN && s.value) {
              const hint = hints[`${p.name}:return`];
              const old = retTypes.get(p.name) ?? '?';
              const next = hint ?? unify(old, typeOf(s.value, p.name));
              if (next !== old) {
                retTypes.set(p.name, next);
                changed = true;
              }
            }
            break;
          case 'repeat':
            hintUsage(s.times, p.name, 'int');
            break;
          case 'while':
            hintUsage(s.cond, p.name, 'bool');
            break;
          case 'if':
            for (const b of s.branches) hintUsage(b.cond, p.name, 'bool');
            break;
        }
      });
    }
    if (!changed) break;
  }
  for (const f of program.functions) {
    const hint = hints[`${f.name}:return`];
    if (hint) retTypes.set(f.name, hint);
  }

  const varType = (name: string, place: string): Ty => {
    let t = rawVarType(name, place);
    if (t === '?' || t === 'list<?>') {
      const u = usage.get(keyOf(name, place));
      if (u) t = t === 'list<?>' && !isList(u) ? t : unify(t, u);
    }
    if (t === 'any' && !warnings.some((w) => w.includes(`"${name}"`)))
      warnings.push(`Die Variable "${name}" enthält unterschiedliche Arten von Werten (z. B. Zahl und Text).`);
    return resolveTy(t);
  };

  const allNames = new Set<string>();
  for (const p of places) {
    for (const n of namesIn(p.body)) allNames.add(n);
    for (const n of p.params) allNames.add(n);
    allNames.add(p.name);
  }

  return {
    program,
    places,
    place: (name) => placeMap.get(name) ?? places[0],
    globals,
    varType,
    typeOf: (e, place) => {
      const t = typeOf(e, place);
      if (e?.k === 'var') return varType(e.name, place);
      return resolveTy(t);
    },
    paramTypes: (fn) => {
      const f = fnByName.get(fn);
      return f ? f.params.map((p) => varType(p, fn)) : [];
    },
    returnType: (fn) => resolveTy(retTypes.get(fn) ?? (fnByName.get(fn)?.returns ? '?' : 'void')),
    functionReturns: (fn) => !!fnByName.get(fn)?.returns,
    isUserFunction: (name) => fnByName.has(name),
    allNames,
    warnings,
  };
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf(':');
  return [key.slice(0, i), key.slice(i + 1)];
}

/** Is this expression free of side effects and cheap (may be duplicated in generated code)? */
export function isSimple(e: Ex): boolean {
  return !e || e.k === 'num' || e.k === 'str' || e.k === 'bool' || e.k === 'var';
}

export type { Expr };
