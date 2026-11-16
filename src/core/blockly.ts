// Conversion between the program model (IR) and Blockly's JSON serialization.
// This module has no dependency on Blockly itself, so it can run in Node.

import type { ClassDef, Ex, Expr, FunctionDef, ImportInfo, Lang, Program, Stmt } from './ir';
import { walkStmts } from './ir';
import { findLibFn } from './library';

function hasValueReturn(body: Stmt[]): boolean {
  let found = false;
  walkStmts(body, (s) => {
    if (s.k === 'return' && s.value) found = true;
  });
  return found;
}

export interface BlockState {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  fields?: Record<string, any>;
  inputs?: Record<string, { block?: BlockState; shadow?: BlockState }>;
  next?: { block?: BlockState };
  extraState?: any;
  /** Extra information that has no field (JSON): trunc, gap, ... */
  data?: string;
  icons?: { comment?: { text: string; pinned?: boolean; height?: number; width?: number } };
  collapsed?: boolean;
  enabled?: boolean;
  disabledReasons?: string[];
}

export interface WorkspaceState {
  blocks?: { languageVersion: number; blocks: BlockState[] };
  variables?: { name: string; id: string; type?: string }[];
}

export type Layout = Record<string, { x: number; y: number }>;

const ARITH: Record<string, string> = { ADD: 'ADD', SUB: 'SUB', MUL: 'MUL', DIV: 'DIV', IDIV: 'IDIV', MOD: 'MOD', POW: 'POW' };
const COMPARE = new Set(['EQ', 'NEQ', 'LT', 'LTE', 'GT', 'GTE']);

// ---------------------------------------------------------------------------
// IR -> Blockly

const IMPORT_TYPES = new Set(['import_module', 'import_from']);

/** Stack of "importiere Paket" blocks for the imports of a program. */
export function importBlocks(imports: ImportInfo[], uid: () => string = () => `i${Math.random().toString(36).slice(2, 10)}`): BlockState | undefined {
  let first: BlockState | undefined;
  let last: BlockState | undefined;
  for (const imp of imports) {
    const b: BlockState =
      !imp.alias && imp.names
        ? { type: 'import_from', id: uid(), fields: { MODULE: imp.module, NAMES: imp.names.join(', '), LANG: imp.lang } }
        : { type: 'import_module', id: uid(), fields: { MODULE: imp.module, ALIAS: imp.alias || imp.module, LANG: imp.lang } };
    if (!first) first = b;
    if (last) last.next = { block: b };
    last = b;
  }
  return first;
}

export function toBlockly(program: Program, layout: Layout = {}): WorkspaceState {
  let counter = 0;
  const uid = () => `b${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const vars = new Map<string, string>();
  const varId = (name: string) => {
    if (!vars.has(name)) vars.set(name, `v_${vars.size}_${name.replace(/[^\p{L}\p{N}_]/gu, '_')}`);
    return vars.get(name)!;
  };
  const varField = (name: string) => ({ id: varId(name) });
  const fnParams = new Map(program.functions.map((f) => [f.name, f.params]));

  const literalShadow = (e: Ex): BlockState | null => {
    if (e?.k === 'num') return { type: 'math_number', id: uid(), fields: { NUM: e.v } };
    if (e?.k === 'str') return { type: 'text', id: uid(), fields: { TEXT: e.v } };
    return null;
  };

  const input = (e: Ex, shadowDefault?: BlockState | null): { block?: BlockState; shadow?: BlockState } | undefined => {
    if (!e) return shadowDefault ? { shadow: shadowDefault } : undefined;
    const sh = literalShadow(e);
    if (sh) return { shadow: sh };
    const out: { block?: BlockState; shadow?: BlockState } = { block: expr(e) };
    if (shadowDefault) out.shadow = shadowDefault;
    return out;
  };
  const numShadow = (v: number): BlockState => ({ type: 'math_number', id: uid(), fields: { NUM: v } });
  const textShadow = (v: string): BlockState => ({ type: 'text', id: uid(), fields: { TEXT: v } });

  const inputs = (pairs: [string, Ex, (BlockState | null)?][]): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const [name, e, sh] of pairs) {
      const i = input(e, sh ?? null);
      if (i) out[name] = i;
    }
    return out;
  };

  const argInputs = (args: Ex[], shadows?: (i: number) => BlockState | null): Record<string, any> =>
    inputs(args.map((a, i) => [`ARG${i}`, a, shadows ? shadows(i) : null] as [string, Ex, BlockState | null]));

  const libShadow = (lib: string, fn: string) => (i: number): BlockState | null => {
    const p = findLibFn(lib, fn)?.params[i];
    if (!p) return null;
    if (p.kind === 'number') return numShadow(typeof p.def === 'number' ? p.def : 0);
    if (p.kind === 'text' || p.kind === 'any') return textShadow(p.def === undefined ? '' : String(p.def));
    return null;
  };

  function expr(e: Expr): BlockState {
    const id = uid();
    switch (e.k) {
      case 'num':
        return { type: 'math_number', id, fields: { NUM: e.v } };
      case 'str':
        return { type: 'text', id, fields: { TEXT: e.v } };
      case 'bool':
        return { type: 'logic_boolean', id, fields: { BOOL: e.v ? 'TRUE' : 'FALSE' } };
      case 'var':
        return { type: 'variables_get', id, fields: { VAR: varField(e.name) } };
      case 'bin':
        if (ARITH[e.op])
          return {
            type: 'op_arith',
            id,
            fields: { OP: e.op },
            inputs: inputs([['A', e.a, numShadow(0)], ['B', e.b, numShadow(0)]]),
            ...(e.trunc && (e.op === 'IDIV' || e.op === 'MOD') ? { data: JSON.stringify({ trunc: true }) } : {}),
          };
        if (COMPARE.has(e.op)) return { type: 'op_compare', id, fields: { OP: e.op }, inputs: inputs([['A', e.a], ['B', e.b]]) };
        return { type: 'op_logic', id, fields: { OP: e.op }, inputs: inputs([['A', e.a], ['B', e.b]]) };
      case 'not':
        return { type: 'op_not', id, inputs: inputs([['BOOL', e.a]]) };
      case 'math':
        return { type: 'op_math', id, fields: { FN: e.fn }, inputs: inputs([['NUM', e.a, numShadow(0)]]) };
      case 'random':
        return { type: 'op_random', id, inputs: inputs([['FROM', e.from, numShadow(1)], ['TO', e.to, numShadow(10)]]) };
      case 'join':
        return {
          type: 'text_join',
          id,
          extraState: { itemCount: e.parts.length },
          inputs: inputs(e.parts.map((p, i) => [`ADD${i}`, p] as [string, Ex])),
        };
      case 'len':
        return { type: e.of === 'list' ? 'lists_length' : 'text_length', id, inputs: inputs([['VALUE', e.a]]) };
      case 'ask':
        return { type: 'io_ask', id, fields: { TYPE: e.as.toUpperCase() }, inputs: inputs([['PROMPT', e.prompt, textShadow('')]]) };
      case 'convert':
        return { type: 'op_convert', id, fields: { TO: e.to.toUpperCase() }, inputs: inputs([['VALUE', e.a]]) };
      case 'list':
        if (!e.items.length) return { type: 'lists_create_empty', id };
        return { type: 'lists_create_with', id, extraState: { itemCount: e.items.length }, inputs: inputs(e.items.map((it, i) => [`ADD${i}`, it] as [string, Ex])) };
      case 'index':
        return { type: 'list_get', id, inputs: inputs([['LIST', e.list], ['INDEX', e.index, numShadow(0)]]) };
      case 'call':
        return { type: 'procedures_callreturn', id, extraState: { name: e.name, params: fnParams.get(e.name) ?? [] }, inputs: argInputs(e.args) };
      case 'lib':
        if (e.get) return { type: 'lib_const', id, extraState: { lib: e.lib, name: e.fn }, fields: { LIB: e.lib, NAME: e.fn } };
        return { type: 'lib_expr', id, fields: { LIB: e.lib, FN: e.fn }, extraState: { lib: e.lib, fn: e.fn, args: e.args.length }, inputs: argInputs(e.args, libShadow(e.lib, e.fn)) };
      case 'method':
        return { type: 'method_expr', id, fields: { NAME: e.name }, extraState: { args: e.args.length }, inputs: { ...inputs([['OBJ', e.obj]]), ...argInputs(e.args) } };
      case 'member':
        return { type: 'member_get', id, fields: { NAME: e.name }, inputs: inputs([['OBJ', e.obj]]) };
      case 'cond':
        return { type: 'logic_ternary', id, inputs: inputs([['IF', e.cond], ['THEN', e.a], ['ELSE', e.b]]) };
      case 'errmsg':
        return { type: 'error_message', id };
      case 'dict':
        return {
          type: 'dict_create',
          id,
          extraState: { pairs: e.entries.length },
          inputs: inputs(e.entries.flatMap((x, i) => [[`KEY${i}`, x.key], [`VALUE${i}`, x.value]] as [string, Ex][])),
        };
      case 'dget':
        return { type: 'dict_get', id, inputs: inputs([['DICT', e.dict], ['KEY', e.key, textShadow('')]]) };
      case 'self':
        return { type: 'self_obj', id };
      case 'kwarg':
        return { type: 'kwarg_value', id, fields: { NAME: e.name }, inputs: inputs([['VALUE', e.value, numShadow(0)]]) };
      case 'new':
        return { type: 'obj_new', id, fields: { CLASS: e.cls }, extraState: { args: e.args.length }, inputs: argInputs(e.args) };
      case 'raw':
        return { type: 'code_expr', id, fields: { CODE: e.code, LANG: e.lang } };
      default:
        return { type: 'code_expr', id, fields: { CODE: e.src ?? '?', LANG: 'python' } };
    }
  }

  function stmt(s: Stmt): BlockState | null {
    const id = uid();
    switch (s.k) {
      case 'print':
        return { type: 'io_print', id, fields: { NEWLINE: s.newline ? 'LN' : 'NOLN' }, inputs: inputs([['TEXT', s.value, textShadow('Hallo!')]]) };
      case 'set':
        return { type: 'variables_set', id, fields: { VAR: varField(s.name) }, inputs: inputs([['VALUE', s.value]]) };
      case 'change':
        return { type: 'math_change', id, fields: { VAR: varField(s.name) }, inputs: inputs([['DELTA', s.by, numShadow(1)]]) };
      case 'if': {
        const ins: Record<string, any> = {};
        s.branches.forEach((b, i) => {
          const c = input(b.cond);
          if (c) ins[`IF${i}`] = c;
          const body = chain(b.body);
          if (body) ins[`DO${i}`] = { block: body };
        });
        if (s.else) {
          const body = chain(s.else);
          if (body) ins.ELSE = { block: body };
        }
        return { type: 'controls_if', id, extraState: { elseIfCount: s.branches.length - 1, hasElse: !!s.else }, inputs: ins };
      }
      case 'repeat':
        return { type: 'controls_repeat_ext', id, inputs: { ...inputs([['TIMES', s.times, numShadow(10)]]), ...body('DO', s.body) } };
      case 'while':
        if (s.post) return { type: 'controls_dowhile', id, fields: { MODE: s.until ? 'UNTIL' : 'WHILE' }, inputs: { ...inputs([['BOOL', s.cond]]), ...body('DO', s.body) } };
        return { type: 'controls_whileUntil', id, fields: { MODE: s.until ? 'UNTIL' : 'WHILE' }, inputs: { ...inputs([['BOOL', s.cond]]), ...body('DO', s.body) } };
      case 'try':
        return { type: 'control_try', id, inputs: { ...body('TRY', s.body), ...body('CATCH', s.handler) } };
      case 'throw':
        return { type: 'error_throw', id, inputs: inputs([['VALUE', s.value, textShadow('Fehler')]]) };
      case 'dset':
        return { type: 'dict_set', id, inputs: inputs([['DICT', s.dict], ['KEY', s.key, textShadow('')], ['VALUE', s.value, numShadow(0)]]) };
      case 'fset':
        return { type: 'field_set', id, fields: { NAME: s.name }, inputs: inputs([['OBJ', s.obj], ['VALUE', s.value, numShadow(0)]]) };
      case 'for':
        return {
          type: 'controls_for',
          id,
          fields: { VAR: varField(s.var) },
          inputs: { ...inputs([['FROM', s.from, numShadow(1)], ['TO', s.to, numShadow(10)], ['BY', s.by, numShadow(1)]]), ...body('DO', s.body) },
        };
      case 'foreach':
        return { type: 'controls_forEach', id, fields: { VAR: varField(s.var) }, inputs: { ...inputs([['LIST', s.list]]), ...body('DO', s.body) } };
      case 'break':
      case 'continue':
        return { type: 'controls_flow_statements', id, fields: { FLOW: s.k === 'break' ? 'BREAK' : 'CONTINUE' } };
      case 'listadd':
        return { type: 'list_add', id, inputs: inputs([['VALUE', s.value, numShadow(0)], ['LIST', s.list]]) };
      case 'listset':
        return { type: 'list_set', id, inputs: inputs([['LIST', s.list], ['INDEX', s.index, numShadow(0)], ['VALUE', s.value, numShadow(0)]]) };
      case 'callstmt':
        return { type: 'procedures_callnoreturn', id, extraState: { name: s.name, params: fnParams.get(s.name) ?? [] }, inputs: argInputs(s.args) };
      case 'libstmt':
        return { type: 'lib_stmt', id, fields: { LIB: s.lib, FN: s.fn }, extraState: { lib: s.lib, fn: s.fn, args: s.args.length }, inputs: argInputs(s.args, libShadow(s.lib, s.fn)) };
      case 'methodstmt':
        return { type: 'method_stmt', id, fields: { NAME: s.name }, extraState: { args: s.args.length }, inputs: { ...inputs([['OBJ', s.obj]]), ...argInputs(s.args) } };
      case 'return':
        return { type: 'func_return', id, inputs: inputs([['VALUE', s.value]]) };
      case 'comment':
        return { type: 'code_comment', id, fields: { TEXT: s.text } };
      case 'raw':
        return { type: 'code_raw', id, fields: { CODE: s.code, LANG: s.lang } };
      case 'pexpr':
        return { type: 'code_raw', id, fields: { CODE: s.e.src ?? '', LANG: 'python' } };
    }
  }

  function body(name: string, stmts: Stmt[]): Record<string, any> {
    const b = chain(stmts);
    return b ? { [name]: { block: b } } : {};
  }

  function chain(stmts: Stmt[]): BlockState | undefined {
    let first: BlockState | undefined;
    let last: BlockState | undefined;
    for (const s of stmts) {
      const b = stmt(s);
      if (!b) continue;
      if (s.gap) b.data = JSON.stringify({ ...readData(b), gap: true });
      if (s.k === 'print' && s.spaced) b.data = JSON.stringify({ ...readData(b), spaced: true });
      if (s.trail) b.icons = { comment: { text: s.trail, pinned: false, height: 60, width: 220 } };
      if (!first) first = b;
      if (last) last.next = { block: b };
      last = b;
    }
    return first;
  }

  const top: BlockState[] = [];
  let y = 30;
  const place = (key: string, b: BlockState, height: number) => {
    const pos = layout[key];
    b.x = pos?.x ?? 30;
    b.y = pos?.y ?? y;
    if (!pos) y += height;
  };

  const imp = importBlocks(program.meta?.imports ?? [], uid);
  if (imp) {
    let n = 0;
    for (let b: BlockState | undefined = imp; b; b = b.next?.block) n++;
    place('imports', imp, n * 44 + 40);
    top.push(imp);
  }
  if (program.main) {
    const b: BlockState = { type: 'event_start', id: uid() };
    const c = chain(program.main);
    if (c) b.next = { block: c };
    place('main', b, estimateHeight(program.main) + 90);
    top.push(b);
  }
  for (const f of program.functions) {
    const b = functionBlock(f);
    place(`fn:${f.name}`, b, estimateHeight(f.body) + 110);
    top.push(b);
  }

  for (const c of program.classes ?? []) {
    const b = classBlock(c);
    place(`cls:${c.name}`, b, c.fields.length * 48 + estimateHeight(c.ctor) + c.methods.reduce((h, m) => h + estimateHeight(m.body) + 90, 0) + 160);
    top.push(b);
  }

  /** Class block: properties, "beim Erzeugen" and methods stacked inside. */
  function classBlock(c: ClassDef): BlockState {
    const members: BlockState[] = [];
    for (const f of c.fields) members.push({ type: 'class_field', id: uid(), fields: { NAME: f.name }, inputs: inputs([['VALUE', f.value, numShadow(0)]]) });
    if (c.ctorParams.length || c.ctor.length) {
      c.ctorParams.forEach(varId);
      members.push({ type: 'class_ctor', id: uid(), fields: { PARAMS: c.ctorParams.join(', ') }, inputs: body('DO', c.ctor) });
    }
    for (const m of c.methods) {
      m.params.forEach(varId);
      const mb: BlockState = { type: 'class_method', id: m.id ?? uid(), fields: { NAME: m.name, PARAMS: m.params.join(', ') }, inputs: body('DO', m.body) };
      if (m.comment) mb.icons = { comment: { text: m.comment, pinned: false, height: 80, width: 220 } };
      members.push(mb);
    }
    for (let i = 0; i < members.length - 1; i++) members[i].next = { block: members[i + 1] };
    const b: BlockState = { type: 'class_def', id: c.id ?? uid(), fields: { NAME: c.name }, inputs: members.length ? { BODY: { block: members[0] } } : {} };
    if (c.comment) b.icons = { comment: { text: c.comment, pinned: false, height: 80, width: 220 } };
    return b;
  }

  function functionBlock(f: FunctionDef): BlockState {
    let bodyStmts = f.body;
    let ret: Ex = null;
    const last = f.body[f.body.length - 1];
    if (f.returns && last?.k === 'return' && last.value) {
      ret = last.value;
      bodyStmts = f.body.slice(0, -1);
    }
    const b: BlockState = {
      type: f.returns ? 'procedures_defreturn' : 'procedures_defnoreturn',
      id: uid(),
      fields: { NAME: f.name },
      extraState: f.params.length ? { params: f.params.map((p) => ({ name: p, id: varId(p) })) } : undefined,
      inputs: {},
    };
    const c = chain(bodyStmts);
    if (c) b.inputs!.STACK = { block: c };
    if (ret) b.inputs!.RETURN = input(ret)!;
    if (!b.extraState) delete b.extraState;
    if (f.comment) b.icons = { comment: { text: f.comment, pinned: false, height: 80, width: 220 } };
    return b;
  }

  return {
    blocks: { languageVersion: 0, blocks: top },
    variables: [...vars].map(([name, id]) => ({ name, id })),
  };
}

export function readData(b: BlockState): Record<string, any> {
  if (!b.data) return {};
  try {
    return JSON.parse(b.data);
  } catch {
    return {};
  }
}

function estimateHeight(stmts: Stmt[]): number {
  let h = 0;
  for (const s of stmts) {
    h += 48;
    if (s.k === 'if') {
      for (const b of s.branches) h += estimateHeight(b.body) + 40;
      if (s.else) h += estimateHeight(s.else) + 40;
    } else if (s.k === 'repeat' || s.k === 'while' || s.k === 'for' || s.k === 'foreach') h += estimateHeight(s.body) + 30;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Blockly -> IR

export interface FromBlocklyResult {
  program: Program;
  layout: Layout;
}

export function fromBlockly(ws: WorkspaceState): FromBlocklyResult {
  const varNames = new Map<string, string>();
  for (const v of ws.variables ?? []) varNames.set(v.id, v.name);
  const varName = (f: any): string => {
    if (!f) return 'x';
    if (typeof f === 'string') return varNames.get(f) ?? f;
    return (f.id && varNames.get(f.id)) ?? f.name ?? 'x';
  };
  const layout: Layout = {};

  const inp = (b: BlockState, name: string): BlockState | undefined => b.inputs?.[name]?.block ?? b.inputs?.[name]?.shadow;
  const field = (b: BlockState, name: string) => b.fields?.[name];
  const e = (b: BlockState | undefined): Ex => (b ? expr(b) : null);
  const argList = (b: BlockState, n: number): Ex[] => Array.from({ length: n }, (_, i) => e(inp(b, `ARG${i}`)));
  const argCount = (b: BlockState): number => {
    let n = b.extraState?.args ?? b.extraState?.params?.length ?? 0;
    for (const k of Object.keys(b.inputs ?? {})) {
      const m = /^ARG(\d+)$/.exec(k);
      if (m) n = Math.max(n, Number(m[1]) + 1);
    }
    return n;
  };

  function expr(b: BlockState): Expr {
    const id = b.id;
    const withId = (x: Expr): Expr => (id ? { ...x, id } : x);
    switch (b.type) {
      case 'math_number': {
        const v = Number(field(b, 'NUM') ?? 0);
        return withId({ k: 'num', v: Number.isFinite(v) ? v : 0 });
      }
      case 'text':
        return withId({ k: 'str', v: String(field(b, 'TEXT') ?? '') });
      case 'logic_boolean':
        return withId({ k: 'bool', v: field(b, 'BOOL') === 'TRUE' });
      case 'variables_get':
        return withId({ k: 'var', name: varName(field(b, 'VAR')) });
      case 'op_arith': {
        const op = field(b, 'OP') ?? 'ADD';
        const trunc = (op === 'IDIV' || op === 'MOD') && readData(b).trunc === true;
        return withId({ k: 'bin', op, a: e(inp(b, 'A')), b: e(inp(b, 'B')), ...(trunc ? { trunc } : {}) });
      }
      case 'op_compare':
        return withId({ k: 'bin', op: field(b, 'OP') ?? 'EQ', a: e(inp(b, 'A')), b: e(inp(b, 'B')) });
      case 'op_logic':
        return withId({ k: 'bin', op: field(b, 'OP') ?? 'AND', a: e(inp(b, 'A')), b: e(inp(b, 'B')) });
      case 'op_not':
        return withId({ k: 'not', a: e(inp(b, 'BOOL')) });
      case 'op_math':
        return withId({ k: 'math', fn: field(b, 'FN') ?? 'sqrt', a: e(inp(b, 'NUM')) });
      case 'op_random':
        return withId({ k: 'random', from: e(inp(b, 'FROM')), to: e(inp(b, 'TO')) });
      case 'text_join': {
        const n = b.extraState?.itemCount ?? 2;
        return withId({ k: 'join', parts: Array.from({ length: n }, (_, i) => e(inp(b, `ADD${i}`))) });
      }
      case 'text_length':
        return withId({ k: 'len', of: 'text', a: e(inp(b, 'VALUE')) });
      case 'lists_length':
        return withId({ k: 'len', of: 'list', a: e(inp(b, 'VALUE')) });
      case 'io_ask':
        return withId({ k: 'ask', prompt: e(inp(b, 'PROMPT')), as: (String(field(b, 'TYPE') ?? 'TEXT').toLowerCase() as any) });
      case 'op_convert':
        return withId({ k: 'convert', to: String(field(b, 'TO') ?? 'TEXT').toLowerCase() as any, a: e(inp(b, 'VALUE')) });
      case 'lists_create_empty':
        return withId({ k: 'list', items: [] });
      case 'lists_create_with': {
        const n = b.extraState?.itemCount ?? 3;
        return withId({ k: 'list', items: Array.from({ length: n }, (_, i) => e(inp(b, `ADD${i}`))).filter((x) => x !== null) });
      }
      case 'list_get':
        return withId({ k: 'index', list: e(inp(b, 'LIST')), index: e(inp(b, 'INDEX')) });
      case 'procedures_callreturn':
        return withId({ k: 'call', name: b.extraState?.name ?? field(b, 'NAME') ?? 'f', args: argList(b, argCount(b)) });
      case 'lib_expr':
        return withId({ k: 'lib', lib: field(b, 'LIB') ?? b.extraState?.lib, fn: field(b, 'FN') ?? b.extraState?.fn, args: argList(b, argCount(b)) });
      case 'method_expr':
        return withId({ k: 'method', obj: e(inp(b, 'OBJ')), name: field(b, 'NAME') ?? 'f', args: argList(b, argCount(b)) });
      case 'member_get':
        return withId({ k: 'member', obj: e(inp(b, 'OBJ')), name: field(b, 'NAME') ?? 'x' });
      case 'logic_ternary':
        return withId({ k: 'cond', cond: e(inp(b, 'IF')), a: e(inp(b, 'THEN')), b: e(inp(b, 'ELSE')) });
      case 'error_message':
        return withId({ k: 'errmsg' });
      case 'dict_create': {
        const n = b.extraState?.pairs ?? 0;
        return withId({ k: 'dict', entries: Array.from({ length: n }, (_, i) => ({ key: e(inp(b, `KEY${i}`)), value: e(inp(b, `VALUE${i}`)) })) });
      }
      case 'dict_get':
        return withId({ k: 'dget', dict: e(inp(b, 'DICT')), key: e(inp(b, 'KEY')) });
      case 'self_obj':
        return withId({ k: 'self' });
      case 'kwarg_value':
        return withId({ k: 'kwarg', name: String(field(b, 'NAME') ?? 'name'), value: e(inp(b, 'VALUE')) });
      case 'lib_const':
        return withId({ k: 'lib', lib: String(b.extraState?.lib ?? field(b, 'LIB') ?? 'ext:'), fn: String(b.extraState?.name ?? field(b, 'NAME') ?? 'wert'), args: [], get: true });
      case 'obj_new':
        return withId({ k: 'new', cls: String(field(b, 'CLASS') ?? 'Objekt'), args: argList(b, argCount(b)) });
      case 'code_expr':
        return withId({ k: 'raw', code: String(field(b, 'CODE') ?? ''), lang: (field(b, 'LANG') ?? 'python') as Lang });
      default:
        return withId({ k: 'raw', code: `/* unbekannter Block ${b.type} */`, lang: 'python' });
    }
  }

  function stmts(b: BlockState | undefined): Stmt[] {
    const out: Stmt[] = [];
    while (b) {
      if (b.enabled !== false && !b.disabledReasons?.length) {
        let s = stmt(b);
        if (s) {
          if (b.id) s = { ...s, id: b.id };
          if (readData(b).gap) s = { ...s, gap: true };
          if (s.k === 'print' && readData(b).spaced) s = { ...s, spaced: true };
          const trail = b.icons?.comment?.text;
          if (trail) s = { ...s, trail };
          out.push(s);
        }
      }
      b = b.next?.block;
    }
    return out;
  }

  function stmt(b: BlockState): Stmt | null {
    const body = (name: string) => stmts(b.inputs?.[name]?.block);
    switch (b.type) {
      case 'io_print':
        return { k: 'print', value: e(inp(b, 'TEXT')), newline: field(b, 'NEWLINE') !== 'NOLN' };
      case 'variables_set':
        return { k: 'set', name: varName(field(b, 'VAR')), value: e(inp(b, 'VALUE')) };
      case 'math_change':
        return { k: 'change', name: varName(field(b, 'VAR')), by: e(inp(b, 'DELTA')) };
      case 'controls_if': {
        const n = (b.extraState?.elseIfCount ?? 0) + 1;
        const branches = Array.from({ length: n }, (_, i) => ({ cond: e(inp(b, `IF${i}`)), body: body(`DO${i}`) }));
        return { k: 'if', branches, else: b.extraState?.hasElse ? body('ELSE') : null };
      }
      case 'controls_repeat_ext':
      case 'controls_repeat':
        return { k: 'repeat', times: b.type === 'controls_repeat' ? { k: 'num', v: Number(field(b, 'TIMES') ?? 10) } : e(inp(b, 'TIMES')), body: body('DO') };
      case 'controls_whileUntil':
        return { k: 'while', until: field(b, 'MODE') === 'UNTIL', cond: e(inp(b, 'BOOL')), body: body('DO') };
      case 'controls_dowhile':
        return { k: 'while', until: field(b, 'MODE') === 'UNTIL', cond: e(inp(b, 'BOOL')), body: body('DO'), post: true };
      case 'control_try':
        return { k: 'try', body: body('TRY'), handler: body('CATCH') };
      case 'error_throw':
        return { k: 'throw', value: e(inp(b, 'VALUE')) };
      case 'dict_set':
        return { k: 'dset', dict: e(inp(b, 'DICT')), key: e(inp(b, 'KEY')), value: e(inp(b, 'VALUE')) };
      case 'controls_for':
        return { k: 'for', var: varName(field(b, 'VAR')), from: e(inp(b, 'FROM')), to: e(inp(b, 'TO')), by: e(inp(b, 'BY')), body: body('DO') };
      case 'controls_forEach':
        return { k: 'foreach', var: varName(field(b, 'VAR')), list: e(inp(b, 'LIST')), body: body('DO') };
      case 'controls_flow_statements':
        return field(b, 'FLOW') === 'CONTINUE' ? { k: 'continue' } : { k: 'break' };
      case 'list_add':
        return { k: 'listadd', list: e(inp(b, 'LIST')), value: e(inp(b, 'VALUE')) };
      case 'list_set':
        return { k: 'listset', list: e(inp(b, 'LIST')), index: e(inp(b, 'INDEX')), value: e(inp(b, 'VALUE')) };
      case 'procedures_callnoreturn':
        return { k: 'callstmt', name: b.extraState?.name ?? 'f', args: argList(b, argCount(b)) };
      case 'lib_stmt':
        return { k: 'libstmt', lib: field(b, 'LIB') ?? b.extraState?.lib, fn: field(b, 'FN') ?? b.extraState?.fn, args: argList(b, argCount(b)) };
      case 'method_stmt':
        return { k: 'methodstmt', obj: e(inp(b, 'OBJ')), name: field(b, 'NAME') ?? 'f', args: argList(b, argCount(b)) };
      case 'func_return':
        return { k: 'return', value: e(inp(b, 'VALUE')) };
      case 'field_set':
        return { k: 'fset', obj: e(inp(b, 'OBJ')), name: String(field(b, 'NAME') ?? 'wert'), value: e(inp(b, 'VALUE')) };
      case 'code_comment':
        return { k: 'comment', text: String(field(b, 'TEXT') ?? '') };
      case 'code_raw':
        return { k: 'raw', code: String(field(b, 'CODE') ?? ''), lang: (field(b, 'LANG') ?? 'python') as Lang };
      default:
        return null;
    }
  }

  let main: Stmt[] | null = null;
  let mainId: string | undefined;
  const functions: FunctionDef[] = [];
  const classes: ClassDef[] = [];
  const paramList = (v: any): string[] =>
    String(v ?? '')
      .split(/[,;\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  const imports: ImportInfo[] = [];
  for (const b of ws.blocks?.blocks ?? []) {
    if (IMPORT_TYPES.has(b.type)) {
      for (let m: BlockState | undefined = b; m && IMPORT_TYPES.has(m.type); m = m.next?.block) {
        if (m.enabled === false || m.disabledReasons?.includes('MANUALLY_DISABLED')) continue;
        const module = String(field(m, 'MODULE') ?? '').trim();
        if (!module) continue;
        const lang = (field(m, 'LANG') ?? 'python') as Lang;
        const names = String(field(m, 'NAMES') ?? '')
          .split(/[,;]/)
          .map((x) => x.trim().replace(/\s+/g, ' '))
          .filter(Boolean);
        if (m.type === 'import_from') imports.push({ lang, module, alias: '', names });
        else imports.push({ lang, module, alias: String(field(m, 'ALIAS') ?? '').trim() || module });
      }
      if (!layout.imports) layout.imports = { x: b.x ?? 0, y: b.y ?? 0 };
      continue;
    }
    if (b.type === 'class_def') {
      if (b.enabled === false) continue;
      const c: ClassDef = { id: b.id, name: String(field(b, 'NAME') ?? 'Klasse'), fields: [], ctorParams: [], ctor: [], methods: [] };
      for (let m = b.inputs?.BODY?.block; m; m = m.next?.block) {
        if (m.enabled === false) continue;
        if (m.type === 'class_field') c.fields.push({ name: String(field(m, 'NAME') ?? 'wert'), value: e(inp(m, 'VALUE')) });
        else if (m.type === 'class_ctor') {
          c.ctorParams = paramList(field(m, 'PARAMS'));
          c.ctor = stmts(m.inputs?.DO?.block);
        } else if (m.type === 'class_method') {
          const body = stmts(m.inputs?.DO?.block);
          const comment = m.icons?.comment?.text;
          c.methods.push({
            id: m.id,
            name: String(field(m, 'NAME') ?? 'methode'),
            params: paramList(field(m, 'PARAMS')),
            body,
            returns: hasValueReturn(body),
            ...(comment ? { comment } : {}),
          });
        }
      }
      const comment = b.icons?.comment?.text;
      if (comment) c.comment = comment;
      classes.push(c);
      layout[`cls:${c.name}`] = { x: b.x ?? 0, y: b.y ?? 0 };
      continue;
    }
    if (b.type === 'event_start' && main === null) {
      main = stmts(b.next?.block);
      mainId = b.id;
      layout.main = { x: b.x ?? 0, y: b.y ?? 0 };
    } else if (b.type === 'procedures_defnoreturn' || b.type === 'procedures_defreturn') {
      if (b.enabled === false) continue;
      const name = String(field(b, 'NAME') ?? 'f');
      const params: string[] = (b.extraState?.params ?? []).map((p: any) => varNames.get(p.id) ?? p.name);
      const bodyStmts = stmts(b.inputs?.STACK?.block);
      const returns = b.type === 'procedures_defreturn';
      const ret = returns ? inp(b, 'RETURN') : undefined;
      if (ret) bodyStmts.push({ k: 'return', value: expr(ret) });
      const comment = b.icons?.comment?.text;
      functions.push({ id: b.id, name, params, body: bodyStmts, returns, ...(comment ? { comment } : {}) });
      layout[`fn:${name}`] = { x: b.x ?? 0, y: b.y ?? 0 };
    }
  }
  return { program: { main, mainId, functions, ...(classes.length ? { classes } : {}), meta: { imports } }, layout };
}
