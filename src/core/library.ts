// Language-neutral library catalog.
//
// Every function has one code template per language. "{0}", "{1}" ... are the
// arguments. The same templates are used in both directions: to generate code
// and to recognise library calls when code is turned back into blocks.

import type { Lang } from './ir';

export type ParamKind = 'number' | 'text' | 'list' | 'dict' | 'any';

export interface LibParam {
  name: string;
  kind: ParamKind;
  /** Default value of the white input field. */
  def?: number | string;
}

export interface LangImpl {
  code: string;
  /** Python modules, Java/C# namespaces, C++ headers needed by the template. */
  imports?: string[];
  /** Helper functions that must be emitted (keys of HELPERS[lang]). */
  helpers?: string[];
  /** Needs a shared random number generator (Java / C#). */
  random?: boolean;
  /** Additional templates that are only used to recognise code. */
  alt?: string[];
  /** false: the template is only used to generate code, never to recognise it (too general). */
  match?: false;
  /** Different template depending on the element type of the first argument (e.g. "double"). */
  byType?: Record<string, string>;
}

/**
 * Return type: a concrete type, "same" (type of first argument), "elem"
 * (element type of the first argument, which is a list) or null (statement).
 */
export type LibReturn = 'int' | 'double' | 'string' | 'bool' | 'list<string>' | 'same' | 'elem' | 'keys' | 'values' | null;

export interface LibFn {
  id: string;
  label: string;
  params: LibParam[];
  returns: LibReturn;
  impl: Record<Lang, LangImpl | string>;
  /** Implementation for the built-in runner. */
  run: (args: any[], rt: LibRuntime) => any;
  tooltip?: string;
}

export interface LibRuntime {
  /** Files of the built-in runner (name -> text). */
  files: Map<string, string>;
  random(): number;
  sleep(seconds: number): Promise<void>;
  error(message: string): never;
  /** Drawing ("Zeichnen" library). */
  turtle(op: string, args: any[]): void;
}

export interface Library {
  id: string;
  label: string;
  fns: LibFn[];
}

const T = (code: string, extra: Omit<LangImpl, 'code'> = {}): LangImpl => ({ code, ...extra });

function checkList(v: any, rt: LibRuntime): any[] {
  if (!Array.isArray(v)) rt.error('Hier wird eine Liste erwartet.');
  return v;
}
function checkDict(v: any, rt: LibRuntime): Map<any, any> {
  if (!(v instanceof Map)) rt.error('Hier wird ein Wörterbuch erwartet.');
  return v;
}
function checkIndex(list: any[], i: any, rt: LibRuntime, allowEnd = false): number {
  const n = Number(i);
  if (!Number.isInteger(n) || n < 0 || n > list.length - (allowEnd ? 0 : 1)) {
    rt.error(`Position ${i} gibt es nicht (die Liste hat ${list.length} Elemente, Positionen ab 0).`);
  }
  return n;
}
const s = (v: any) => String(v);
const cmp = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);

export const LIBRARIES: Library[] = [
  {
    id: 'math',
    label: 'Mathe',
    fns: [
      ...(['sin', 'cos', 'tan'] as const).map<LibFn>((f) => ({
        id: f,
        label: { sin: 'Sinus', cos: 'Kosinus', tan: 'Tangens' }[f],
        params: [{ name: 'Winkel', kind: 'number', def: 1 }],
        returns: 'double',
        tooltip: 'Winkel im Bogenmaß (π = 180°).',
        impl: {
          python: T(`math.${f}({0})`, { imports: ['math'] }),
          java: `Math.${f}({0})`,
          javascript: `Math.${f}({0})`,
          csharp: `Math.${f[0].toUpperCase() + f.slice(1)}({0})`,
          cpp: T(`${f}({0})`, { imports: ['<cmath>'] }),
          vba: { sin: 'Sin({0})', cos: 'Cos({0})', tan: 'Tan({0})' }[f],
        },
        run: ([x]) => Math[f](Number(x)),
      })),
      ...(['asin', 'acos', 'atan'] as const).map<LibFn>((f) => ({
        id: f,
        label: { asin: 'Arkussinus', acos: 'Arkuskosinus', atan: 'Arkustangens' }[f],
        params: [{ name: 'x', kind: 'number', def: 1 }],
        returns: 'double',
        impl: {
          python: T(`math.${f}({0})`, { imports: ['math'] }),
          java: `Math.${f}({0})`,
          javascript: `Math.${f}({0})`,
          csharp: `Math.${f[0].toUpperCase() + f.slice(1)}({0})`,
          cpp: T(`${f}({0})`, { imports: ['<cmath>'] }),
          vba: f === 'atan' ? 'Atn({0})' : T(`${f === 'asin' ? 'ArcSin' : 'ArcCos'}({0})`, { helpers: [f === 'asin' ? 'ArcSin' : 'ArcCos'] }),
        },
        run: ([x]) => Math[f](Number(x)),
      })),
      ...(['max', 'min'] as const).map<LibFn>((f) => ({
        id: f,
        label: f === 'max' ? 'größere Zahl von' : 'kleinere Zahl von',
        params: [
          { name: 'a', kind: 'number', def: 3 },
          { name: 'b', kind: 'number', def: 7 },
        ],
        returns: 'same',
        impl: {
          python: `${f}({0}, {1})`,
          java: `Math.${f}({0}, {1})`,
          javascript: `Math.${f}({0}, {1})`,
          csharp: `Math.${f === 'max' ? 'Max' : 'Min'}({0}, {1})`,
          cpp: T(`${f}({0}, {1})`, { imports: ['<algorithm>'] }),
          vba: `IIf({0} ${f === 'max' ? '>' : '<'} {1}, {0}, {1})`,
        },
        run: ([a, b]) => Math[f](Number(a), Number(b)),
      })),
      {
        id: 'pi',
        label: 'Pi (π)',
        params: [],
        returns: 'double',
        impl: {
          python: T('math.pi', { imports: ['math'] }),
          java: 'Math.PI',
          javascript: 'Math.PI',
          csharp: 'Math.PI',
          cpp: T('M_PI', { imports: ['<cmath>'] }),
          vba: '(4 * Atn(1))',
        },
        run: () => Math.PI,
      },
    ],
  },
  {
    id: 'text',
    label: 'Text',
    fns: [
      {
        id: 'upper',
        label: 'in Großbuchstaben',
        params: [{ name: 'Text', kind: 'text', def: 'Hallo' }],
        returns: 'string',
        impl: {
          python: '{0}.upper()',
          java: '{0}.toUpperCase()',
          javascript: '{0}.toUpperCase()',
          csharp: '{0}.ToUpper()',
          cpp: T('toUpper({0})', { helpers: ['toUpper'] }),
          vba: 'UCase({0})',
        },
        run: ([t]) => s(t).toUpperCase(),
      },
      {
        id: 'lower',
        label: 'in Kleinbuchstaben',
        params: [{ name: 'Text', kind: 'text', def: 'Hallo' }],
        returns: 'string',
        impl: {
          python: '{0}.lower()',
          java: '{0}.toLowerCase()',
          javascript: '{0}.toLowerCase()',
          csharp: '{0}.ToLower()',
          cpp: T('toLower({0})', { helpers: ['toLower'] }),
          vba: 'LCase({0})',
        },
        run: ([t]) => s(t).toLowerCase(),
      },
      {
        id: 'trim',
        label: 'ohne Leerzeichen am Rand',
        params: [{ name: 'Text', kind: 'text', def: '  Hallo  ' }],
        returns: 'string',
        impl: {
          python: '{0}.strip()',
          java: '{0}.trim()',
          javascript: '{0}.trim()',
          csharp: '{0}.Trim()',
          cpp: T('trim({0})', { helpers: ['trim'] }),
          vba: 'Trim({0})',
        },
        run: ([t]) => s(t).trim(),
      },
      {
        id: 'contains',
        label: 'enthält',
        params: [
          { name: 'Text', kind: 'text', def: 'Hallo' },
          { name: 'Teil', kind: 'text', def: 'all' },
        ],
        returns: 'bool',
        impl: {
          python: '{1} in {0}',
          java: '{0}.contains({1})',
          javascript: '{0}.includes({1})',
          csharp: '{0}.Contains({1})',
          cpp: '({0}.find({1}) != string::npos)',
          vba: '(InStr({0}, {1}) > 0)',
        },
        run: ([t, p]) => s(t).includes(s(p)),
      },
      {
        id: 'startsWith',
        label: 'beginnt mit',
        params: [
          { name: 'Text', kind: 'text', def: 'Hallo' },
          { name: 'Anfang', kind: 'text', def: 'Ha' },
        ],
        returns: 'bool',
        impl: {
          python: '{0}.startswith({1})',
          java: '{0}.startsWith({1})',
          javascript: '{0}.startsWith({1})',
          csharp: '{0}.StartsWith({1})',
          cpp: '({0}.rfind({1}, 0) == 0)',
          vba: '(Left({0}, Len({1})) = {1})',
        },
        run: ([t, p]) => s(t).startsWith(s(p)),
      },
      {
        id: 'endsWith',
        label: 'endet mit',
        params: [
          { name: 'Text', kind: 'text', def: 'Hallo' },
          { name: 'Ende', kind: 'text', def: 'lo' },
        ],
        returns: 'bool',
        impl: {
          python: '{0}.endswith({1})',
          java: '{0}.endsWith({1})',
          javascript: '{0}.endsWith({1})',
          csharp: '{0}.EndsWith({1})',
          cpp: T('endsWith({0}, {1})', { helpers: ['endsWith'] }),
          vba: '(Right({0}, Len({1})) = {1})',
        },
        run: ([t, p]) => s(t).endsWith(s(p)),
      },
      {
        id: 'indexOf',
        label: 'Position von',
        tooltip: 'Position des Teiltexts (ab 0), oder -1 wenn er nicht vorkommt.',
        params: [
          { name: 'Text', kind: 'text', def: 'Hallo' },
          { name: 'Teil', kind: 'text', def: 'l' },
        ],
        returns: 'int',
        impl: {
          python: '{0}.find({1})',
          java: '{0}.indexOf({1})',
          javascript: '{0}.indexOf({1})',
          csharp: '{0}.IndexOf({1})',
          cpp: '(int) {0}.find({1})',
          vba: '(InStr({0}, {1}) - 1)',
        },
        run: ([t, p]) => s(t).indexOf(s(p)),
      },
      {
        id: 'replace',
        label: 'ersetze',
        params: [
          { name: 'Text', kind: 'text', def: 'Hallo' },
          { name: 'alt', kind: 'text', def: 'a' },
          { name: 'neu', kind: 'text', def: 'e' },
        ],
        returns: 'string',
        impl: {
          python: '{0}.replace({1}, {2})',
          java: '{0}.replace({1}, {2})',
          javascript: '{0}.replaceAll({1}, {2})',
          csharp: '{0}.Replace({1}, {2})',
          cpp: T('replaceAll({0}, {1}, {2})', { helpers: ['replaceAll'] }),
          vba: 'Replace({0}, {1}, {2})',
        },
        run: ([t, a, b]) => s(t).split(s(a)).join(s(b)),
      },
      {
        id: 'substring',
        label: 'Teiltext',
        tooltip: 'Teil des Texts von Position "von" (ab 0) bis vor Position "bis".',
        params: [
          { name: 'Text', kind: 'text', def: 'Hallo' },
          { name: 'von', kind: 'number', def: 0 },
          { name: 'bis', kind: 'number', def: 2 },
        ],
        returns: 'string',
        impl: {
          python: '{0}[{1}:{2}]',
          java: '{0}.substring({1}, {2})',
          javascript: '{0}.substring({1}, {2})',
          csharp: '{0}.Substring({1}, {2} - {1})',
          cpp: '{0}.substr({1}, {2} - {1})',
          vba: 'Mid({0}, {1} + 1, {2} - {1})',
        },
        run: ([t, a, b]) => s(t).substring(Number(a), Number(b)),
      },
      {
        id: 'charAt',
        label: 'Zeichen an Position',
        params: [
          { name: 'Text', kind: 'text', def: 'Hallo' },
          { name: 'Position', kind: 'number', def: 0 },
        ],
        returns: 'string',
        impl: {
          python: '{0}[{1}]',
          java: 'String.valueOf({0}.charAt({1}))',
          javascript: '{0}.charAt({1})',
          csharp: '{0}[{1}].ToString()',
          cpp: 'string(1, {0}[{1}])',
          vba: 'Mid({0}, {1} + 1, 1)',
        },
        run: ([t, i], rt) => {
          const text = s(t);
          const n = Number(i);
          if (!Number.isInteger(n) || n < 0 || n >= text.length) rt.error(`Position ${i} gibt es im Text nicht.`);
          return text[n];
        },
      },
      {
        id: 'split',
        label: 'zerlege',
        params: [
          { name: 'Text', kind: 'text', def: 'a,b,c' },
          { name: 'Trennzeichen', kind: 'text', def: ',' },
        ],
        returns: 'list<string>',
        impl: {
          python: '{0}.split({1})',
          java: T('new ArrayList<>(Arrays.asList({0}.split(Pattern.quote({1}))))', { imports: ['java.util.regex.Pattern'] }),
          javascript: '{0}.split({1})',
          csharp: 'new List<string>({0}.Split({1}))',
          cpp: T('split({0}, {1})', { helpers: ['split'] }),
          vba: 'Split({0}, {1})',
        },
        run: ([t, sep]) => s(t).split(s(sep)),
      },
      {
        id: 'joinList',
        label: 'verbinde Liste',
        params: [
          { name: 'Liste', kind: 'list' },
          { name: 'Trennzeichen', kind: 'text', def: ', ' },
        ],
        returns: 'string',
        impl: {
          python: T('{1}.join(map(str, {0}))', { alt: ['{1}.join({0})'] }),
          java: T('{0}.stream().map(String::valueOf).collect(Collectors.joining({1}))', { imports: ['java.util.stream.Collectors'], alt: ['String.join({1}, {0})'] }),
          javascript: '{0}.join({1})',
          csharp: 'string.Join({1}, {0})',
          cpp: T('joinList({0}, {1})', { helpers: ['joinList'] }),
          vba: 'Join({0}, {1})',
        },
        run: ([l, sep], rt) => checkList(l, rt).map(s).join(s(sep)),
      },
      {
        id: 'repeat',
        label: 'wiederhole Text',
        params: [
          { name: 'Text', kind: 'text', def: 'ab' },
          { name: 'Anzahl', kind: 'number', def: 3 },
        ],
        returns: 'string',
        impl: {
          python: '{0} * {1}',
          java: '{0}.repeat({1})',
          javascript: '{0}.repeat({1})',
          csharp: T('string.Concat(Enumerable.Repeat({0}, {1}))', { imports: ['System.Linq'] }),
          cpp: T('repeatText({0}, {1})', { helpers: ['repeatText'] }),
          vba: T('RepeatText({0}, {1})', { helpers: ['RepeatText'] }),
        },
        run: ([t, n]) => s(t).repeat(Math.max(0, Number(n))),
      },
      {
        id: 'reverse',
        label: 'rückwärts',
        params: [{ name: 'Text', kind: 'text', def: 'Hallo' }],
        returns: 'string',
        impl: {
          python: '{0}[::-1]',
          java: 'new StringBuilder({0}).reverse().toString()',
          javascript: '[...{0}].reverse().join("")',
          csharp: T('new string({0}.Reverse().ToArray())', { imports: ['System.Linq'] }),
          cpp: 'string({0}.rbegin(), {0}.rend())',
          vba: 'StrReverse({0})',
        },
        run: ([t]) => [...s(t)].reverse().join(''),
      },
    ],
  },
  {
    id: 'list',
    label: 'Liste',
    fns: [
      {
        id: 'sort',
        label: 'sortiere',
        params: [{ name: 'Liste', kind: 'list' }],
        returns: null,
        impl: {
          python: '{0}.sort()',
          java: 'Collections.sort({0})',
          javascript: T('sortList({0})', { helpers: ['sortList'], alt: ['{0}.sort()'] }),
          csharp: '{0}.Sort()',
          cpp: T('sort({0}.begin(), {0}.end())', { imports: ['<algorithm>'] }),
          vba: T('SortList {0}', { helpers: ['SortList'] }),
        },
        run: ([l], rt) => {
          checkList(l, rt).sort(cmp);
        },
      },
      {
        id: 'reverse',
        label: 'drehe um',
        params: [{ name: 'Liste', kind: 'list' }],
        returns: null,
        impl: {
          python: '{0}.reverse()',
          java: 'Collections.reverse({0})',
          javascript: '{0}.reverse()',
          csharp: '{0}.Reverse()',
          cpp: T('reverse({0}.begin(), {0}.end())', { imports: ['<algorithm>'] }),
          vba: T('ReverseList {0}', { helpers: ['ReverseList'] }),
        },
        run: ([l], rt) => {
          checkList(l, rt).reverse();
        },
      },
      {
        id: 'contains',
        label: 'enthält',
        params: [
          { name: 'Liste', kind: 'list' },
          { name: 'Wert', kind: 'any', def: 1 },
        ],
        returns: 'bool',
        impl: {
          python: '{1} in {0}',
          java: '{0}.contains({1})',
          javascript: '{0}.includes({1})',
          csharp: '{0}.Contains({1})',
          cpp: T('(find({0}.begin(), {0}.end(), {1}) != {0}.end())', { imports: ['<algorithm>'] }),
          vba: T('ListContains({0}, {1})', { helpers: ['ListContains'] }),
        },
        run: ([l, x], rt) => checkList(l, rt).includes(x),
      },
      {
        id: 'indexOf',
        label: 'Position von',
        tooltip: 'Position des Werts in der Liste (ab 0), oder -1 wenn er nicht vorkommt.',
        params: [
          { name: 'Liste', kind: 'list' },
          { name: 'Wert', kind: 'any', def: 1 },
        ],
        returns: 'int',
        impl: {
          python: T('({0}.index({1}) if {1} in {0} else -1)', { alt: ['{0}.index({1})'] }),
          java: '{0}.indexOf({1})',
          javascript: '{0}.indexOf({1})',
          csharp: '{0}.IndexOf({1})',
          cpp: T('indexOf({0}, {1})', { helpers: ['indexOf'] }),
          vba: T('ListIndexOf({0}, {1})', { helpers: ['ListIndexOf'] }),
        },
        run: ([l, x], rt) => checkList(l, rt).indexOf(x),
      },
      {
        id: 'removeAt',
        label: 'entferne an Position',
        params: [
          { name: 'Liste', kind: 'list' },
          { name: 'Position', kind: 'number', def: 0 },
        ],
        returns: null,
        impl: {
          python: '{0}.pop({1})',
          java: '{0}.remove({1})',
          javascript: '{0}.splice({1}, 1)',
          csharp: '{0}.RemoveAt({1})',
          cpp: '{0}.erase({0}.begin() + {1})',
          vba: T('RemoveAt {0}, {1}', { helpers: ['RemoveAt'] }),
        },
        run: ([l, i], rt) => {
          const list = checkList(l, rt);
          list.splice(checkIndex(list, i, rt), 1);
        },
      },
      {
        id: 'insert',
        label: 'füge ein an Position',
        params: [
          { name: 'Liste', kind: 'list' },
          { name: 'Position', kind: 'number', def: 0 },
          { name: 'Wert', kind: 'any', def: 1 },
        ],
        returns: null,
        impl: {
          python: '{0}.insert({1}, {2})',
          java: '{0}.add({1}, {2})',
          javascript: '{0}.splice({1}, 0, {2})',
          csharp: '{0}.Insert({1}, {2})',
          cpp: '{0}.insert({0}.begin() + {1}, {2})',
          vba: T('InsertAt {0}, {1}, {2}', { helpers: ['InsertAt'] }),
        },
        run: ([l, i, x], rt) => {
          const list = checkList(l, rt);
          list.splice(checkIndex(list, i, rt, true), 0, x);
        },
      },
      {
        id: 'clear',
        label: 'leere',
        params: [{ name: 'Liste', kind: 'list' }],
        returns: null,
        impl: {
          python: '{0}.clear()',
          java: '{0}.clear()',
          javascript: '{0}.splice(0)',
          csharp: '{0}.Clear()',
          cpp: '{0}.clear()',
          vba: T('ClearList {0}', { helpers: ['ClearList'] }),
        },
        run: ([l], rt) => {
          checkList(l, rt).length = 0;
        },
      },
      {
        id: 'sum',
        label: 'Summe',
        params: [{ name: 'Liste', kind: 'list' }],
        returns: 'elem',
        impl: {
          python: 'sum({0})',
          java: T('{0}.stream().mapToInt(Integer::intValue).sum()', { byType: { double: '{0}.stream().mapToDouble(Double::doubleValue).sum()' } }),
          javascript: T('sumList({0})', { helpers: ['sumList'] }),
          csharp: T('{0}.Sum()', { imports: ['System.Linq'] }),
          cpp: T('accumulate({0}.begin(), {0}.end(), 0)', { imports: ['<numeric>'], byType: { double: 'accumulate({0}.begin(), {0}.end(), 0.0)' } }),
          vba: T('ListSum({0})', { helpers: ['ListSum'] }),
        },
        run: ([l], rt) => checkList(l, rt).reduce((a, b) => a + Number(b), 0),
      },
      ...(['min', 'max'] as const).map<LibFn>((f) => ({
        id: f,
        label: f === 'min' ? 'kleinstes Element' : 'größtes Element',
        params: [{ name: 'Liste', kind: 'list' }],
        returns: 'elem',
        impl: {
          python: `${f}({0})`,
          java: `Collections.${f}({0})`,
          javascript: T(`${f}List({0})`, { helpers: [`${f}List`] }),
          csharp: T(`{0}.${f === 'min' ? 'Min' : 'Max'}()`, { imports: ['System.Linq'] }),
          cpp: T(`*${f}_element({0}.begin(), {0}.end())`, { imports: ['<algorithm>'] }),
          vba: T(`List${f === 'min' ? 'Min' : 'Max'}({0})`, { helpers: [`List${f === 'min' ? 'Min' : 'Max'}`] }),
        },
        run: ([l], rt) => {
          const list = checkList(l, rt);
          if (!list.length) rt.error('Die Liste ist leer.');
          return list.reduce((a, b) => (f === 'min' ? (b < a ? b : a) : b > a ? b : a));
        },
      })),
    ],
  },
  {
    id: 'dict',
    label: 'Wörterbuch',
    fns: [
      {
        id: 'has',
        label: 'enthält Schlüssel',
        params: [
          { name: 'Wörterbuch', kind: 'dict' },
          { name: 'Schlüssel', kind: 'any', def: 'a' },
        ],
        returns: 'bool',
        impl: {
          python: '{1} in {0}',
          java: '{0}.containsKey({1})',
          javascript: '{0}.has({1})',
          csharp: '{0}.ContainsKey({1})',
          cpp: '({0}.count({1}) > 0)',
          vba: '{0}.Exists({1})',
        },
        run: ([d, k], rt) => checkDict(d, rt).has(k),
      },
      {
        id: 'keys',
        label: 'alle Schlüssel',
        params: [{ name: 'Wörterbuch', kind: 'dict' }],
        returns: 'keys',
        impl: {
          python: T('list({0}.keys())', { alt: ['list({0})'] }),
          java: 'new ArrayList<>({0}.keySet())',
          javascript: 'Array.from({0}.keys())',
          csharp: T('{0}.Keys.ToList()', { imports: ['System.Linq'] }),
          cpp: T('keysOf({0})', { helpers: ['keysOf'] }),
          vba: '{0}.Keys',
        },
        run: ([d], rt) => [...checkDict(d, rt).keys()],
      },
      {
        id: 'values',
        label: 'alle Werte',
        params: [{ name: 'Wörterbuch', kind: 'dict' }],
        returns: 'values',
        impl: {
          python: 'list({0}.values())',
          java: 'new ArrayList<>({0}.values())',
          javascript: 'Array.from({0}.values())',
          csharp: T('{0}.Values.ToList()', { imports: ['System.Linq'] }),
          cpp: T('valuesOf({0})', { helpers: ['valuesOf'] }),
          vba: '{0}.Items',
        },
        run: ([d], rt) => [...checkDict(d, rt).values()],
      },
      {
        id: 'size',
        label: 'Anzahl Einträge',
        params: [{ name: 'Wörterbuch', kind: 'dict' }],
        returns: 'int',
        impl: {
          python: T('len({0})', { match: false }),
          java: T('{0}.size()', { match: false }),
          javascript: '{0}.size',
          csharp: T('{0}.Count', { match: false }),
          cpp: T('(int) {0}.size()', { match: false }),
          vba: T('{0}.Count', { match: false }),
        },
        run: ([d], rt) => checkDict(d, rt).size,
      },
      {
        id: 'remove',
        label: 'entferne Schlüssel',
        params: [
          { name: 'Wörterbuch', kind: 'dict' },
          { name: 'Schlüssel', kind: 'any', def: 'a' },
        ],
        returns: null,
        impl: {
          python: T('{0}.pop({1})', { match: false, alt: ['del {0}[{1}]'] }),
          java: T('{0}.remove({1})', { match: false }),
          javascript: '{0}.delete({1})',
          csharp: T('{0}.Remove({1})', { match: false }),
          cpp: '{0}.erase({1})',
          vba: '{0}.Remove {1}',
        },
        run: ([d, k], rt) => {
          checkDict(d, rt).delete(k);
        },
      },
    ],
  },
  {
    id: 'file',
    label: 'Datei',
    fns: [
      {
        id: 'read',
        label: 'lies Text aus Datei',
        params: [{ name: 'Dateiname', kind: 'text', def: 'notizen.txt' }],
        returns: 'string',
        impl: {
          python: T('pathlib.Path({0}).read_text(encoding="utf-8")', { imports: ['pathlib'] }),
          java: T('readFile({0})', { helpers: ['readFile'] }),
          javascript: 'require("fs").readFileSync({0}, "utf8")',
          csharp: T('File.ReadAllText({0})', { imports: ['System.IO'] }),
          cpp: T('readFile({0})', { helpers: ['readFile'] }),
          vba: T('ReadFile({0})', { helpers: ['ReadFile'] }),
        },
        run: ([name], rt) => {
          const text = rt.files.get(String(name));
          if (text === undefined) rt.error(`Die Datei "${name}" gibt es nicht.`);
          return text;
        },
      },
      {
        id: 'write',
        label: 'schreibe Text in Datei',
        params: [
          { name: 'Dateiname', kind: 'text', def: 'notizen.txt' },
          { name: 'Text', kind: 'text', def: 'Hallo' },
        ],
        returns: null,
        impl: {
          python: T('pathlib.Path({0}).write_text({1}, encoding="utf-8")', { imports: ['pathlib'] }),
          java: T('writeFile({0}, {1})', { helpers: ['writeFile'] }),
          javascript: 'require("fs").writeFileSync({0}, {1})',
          csharp: T('File.WriteAllText({0}, {1})', { imports: ['System.IO'] }),
          cpp: T('writeFile({0}, {1})', { helpers: ['writeFile'] }),
          vba: T('WriteFile {0}, {1}', { helpers: ['WriteFile'] }),
        },
        run: ([name, text], rt) => {
          rt.files.set(String(name), String(text));
        },
      },
      {
        id: 'appendLine',
        label: 'hänge Zeile an Datei an',
        params: [
          { name: 'Dateiname', kind: 'text', def: 'notizen.txt' },
          { name: 'Zeile', kind: 'text', def: 'Hallo' },
        ],
        returns: null,
        impl: {
          python: T('open({0}, "a", encoding="utf-8").write({1} + "\\n")'),
          java: T('appendLine({0}, {1})', { helpers: ['appendLine'] }),
          javascript: 'require("fs").appendFileSync({0}, {1} + "\\n")',
          csharp: T('File.AppendAllText({0}, {1} + "\\n")', { imports: ['System.IO'] }),
          cpp: T('appendLine({0}, {1})', { helpers: ['appendLine'] }),
          vba: T('AppendLine {0}, {1}', { helpers: ['AppendLine'] }),
        },
        run: ([name, line], rt) => {
          rt.files.set(String(name), (rt.files.get(String(name)) ?? '') + String(line) + '\n');
        },
      },
      {
        id: 'exists',
        label: 'Datei existiert',
        params: [{ name: 'Dateiname', kind: 'text', def: 'notizen.txt' }],
        returns: 'bool',
        impl: {
          python: T('pathlib.Path({0}).exists()', { imports: ['pathlib'] }),
          java: T('new java.io.File({0}).exists()'),
          javascript: 'require("fs").existsSync({0})',
          csharp: T('File.Exists({0})', { imports: ['System.IO'] }),
          cpp: T('fileExists({0})', { helpers: ['fileExists'] }),
          vba: 'Len(Dir({0})) > 0',
        },
        run: ([name], rt) => rt.files.has(String(name)),
      },
    ],
  },

  {
    id: 'random',
    label: 'Zufall',
    fns: [
      {
        id: 'float',
        label: 'Kommazahl 0 bis 1',
        params: [],
        returns: 'double',
        impl: {
          python: T('random.random()', { imports: ['random'] }),
          java: 'Math.random()',
          javascript: 'Math.random()',
          csharp: T('random.NextDouble()', { random: true }),
          cpp: T('((double) rand() / RAND_MAX)', { imports: ['<cstdlib>'] }),
          vba: 'Rnd()',
        },
        run: (_args, rt) => rt.random(),
      },
      {
        id: 'choice',
        label: 'zufälliges Element aus',
        params: [{ name: 'Liste', kind: 'list' }],
        returns: 'elem',
        impl: {
          python: T('random.choice({0})', { imports: ['random'] }),
          java: T('{0}.get(random.nextInt({0}.size()))', { random: true }),
          javascript: '{0}[Math.floor(Math.random() * {0}.length)]',
          csharp: T('{0}[random.Next({0}.Count)]', { random: true }),
          cpp: T('{0}[rand() % {0}.size()]', { imports: ['<cstdlib>'] }),
          vba: '{0}(Int(Rnd() * (UBound({0}) + 1)))',
        },
        run: ([l], rt) => {
          const list = checkList(l, rt);
          if (!list.length) rt.error('Die Liste ist leer.');
          return list[Math.floor(rt.random() * list.length)];
        },
      },
      {
        id: 'shuffle',
        label: 'mische Liste',
        params: [{ name: 'Liste', kind: 'list' }],
        returns: null,
        impl: {
          python: T('random.shuffle({0})', { imports: ['random'] }),
          java: 'Collections.shuffle({0})',
          javascript: T('shuffleList({0})', { helpers: ['shuffleList'] }),
          csharp: T('Shuffle({0})', { helpers: ['Shuffle'], random: true }),
          cpp: T('shuffle({0}.begin(), {0}.end(), mt19937(random_device()()))', { imports: ['<algorithm>', '<random>'] }),
          vba: T('ShuffleList {0}', { helpers: ['ShuffleList'] }),
        },
        run: ([l], rt) => {
          const list = checkList(l, rt);
          for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(rt.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
          }
        },
      },
    ],
  },
  {
    id: 'draw',
    label: 'Zeichnen',
    fns: [
      ...(
        [
          ['forward', 'gehe vorwärts', [{ name: 'Schritte', kind: 'number', def: 100 }], 'forward', 'Forward', 'TurtleForward'],
          ['right', 'drehe rechts um', [{ name: 'Grad', kind: 'number', def: 90 }], 'right', 'Right', 'TurtleRight'],
          ['left', 'drehe links um', [{ name: 'Grad', kind: 'number', def: 90 }], 'left', 'Left', 'TurtleLeft'],
          ['penup', 'Stift hoch', [], 'penUp', 'PenUp', 'TurtlePenUp'],
          ['pendown', 'Stift runter', [], 'penDown', 'PenDown', 'TurtlePenDown'],
          ['pencolor', 'Stiftfarbe', [{ name: 'Farbe', kind: 'text', def: 'blue' }], 'penColor', 'PenColor', 'TurtleColor'],
          ['pensize', 'Stiftdicke', [{ name: 'Dicke', kind: 'number', def: 3 }], 'penSize', 'PenSize', 'TurtleSize'],
          ['goto', 'gehe zu', [{ name: 'x', kind: 'number', def: 0 }, { name: 'y', kind: 'number', def: 0 }], 'goTo', 'GoTo', 'TurtleGoTo'],
          ['clear', 'lösche Zeichnung', [], 'clear', 'Clear', 'TurtleClear'],
        ] as [string, string, LibParam[], string, string, string][]
      ).map<LibFn>(([id, label, params, js, cs, vba]) => {
        const args = params.map((_, i) => `{${i}}`).join(', ');
        return {
          id,
          label,
          params,
          returns: null,
          tooltip: 'Zeichnet wie eine Schildkröte mit Stift. Python nutzt das Modul "turtle", die anderen Sprachen speichern die Zeichnung als zeichnung.svg.',
          impl: {
            python: T(`turtle.${id}(${args})`, { imports: ['turtle'] }),
            java: T(`Turtle.${js}(${args})`, { helpers: ['Turtle'] }),
            javascript: T(`turtle.${js}(${args})`, { helpers: ['turtle'] }),
            csharp: T(`Turtle.${cs}(${args})`, { helpers: ['Turtle'] }),
            cpp: T(`turtle::${js}(${args})`, { helpers: ['turtle'] }),
            vba: T(params.length ? `${vba} ${args}` : vba, { helpers: ['Turtle'] }),
          },
          run: (a, rt) => rt.turtle(id, a),
        };
      }),
    ],
  },
  {
    id: 'time',
    label: 'Zeit',
    fns: [
      {
        id: 'sleep',
        label: 'warte Sekunden',
        params: [{ name: 'Sekunden', kind: 'number', def: 1 }],
        returns: null,
        impl: {
          python: T('time.sleep({0})', { imports: ['time'] }),
          java: T('sleep({0})', { helpers: ['sleep'] }),
          javascript: T('sleep({0})', { helpers: ['sleep'] }),
          csharp: T('Thread.Sleep((int) ({0} * 1000))', { imports: ['System.Threading'] }),
          cpp: T('this_thread::sleep_for(chrono::milliseconds((int) ({0} * 1000)))', { imports: ['<thread>', '<chrono>'] }),
          vba: T('Warte {0}', { helpers: ['Warte'] }),
        },
        run: ([sec], rt) => rt.sleep(Number(sec)),
      },
      {
        id: 'now',
        label: 'Sekunden seit 1970',
        params: [],
        returns: 'double',
        impl: {
          python: T('time.time()', { imports: ['time'] }),
          java: 'System.currentTimeMillis() / 1000.0',
          javascript: 'Date.now() / 1000',
          csharp: 'DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0',
          cpp: T('nowSeconds()', { helpers: ['nowSeconds'] }),
          vba: '((Now - DateSerial(1970, 1, 1)) * 86400)',
        },
        run: () => Date.now() / 1000,
      },
    ],
  },
];

export function findLib(id: string): Library | undefined {
  return LIBRARIES.find((l) => l.id === id);
}

export function findLibFn(lib: string, fn: string): LibFn | undefined {
  return findLib(lib)?.fns.find((f) => f.id === fn);
}

export function implFor(fn: LibFn, lang: Lang): LangImpl {
  const impl = fn.impl[lang];
  return typeof impl === 'string' ? { code: impl } : impl;
}

/** External (non-catalog) libraries are encoded as "ext:<module>"; "ext:" = free function. */
export const isExternalLib = (lib: string) => lib.startsWith('ext:');
export const externalModule = (lib: string) => lib.slice(4);

// ---------------------------------------------------------------------------
// Helper functions needed by some templates.

export const HELPERS: Partial<Record<Lang, Record<string, { code: string; imports?: string[]; random?: boolean }>>> = {
  java: {
    Turtle: {
      code: `static class Turtle {
    static double x = 0, y = 0, angle = 0, size = 1;
    static boolean down = true;
    static String color = "black";
    static StringBuilder lines = new StringBuilder();

    static void forward(double steps) {
        goTo(x + steps * Math.cos(Math.toRadians(angle)), y + steps * Math.sin(Math.toRadians(angle)));
    }

    static void right(double degrees) { angle -= degrees; }
    static void left(double degrees) { angle += degrees; }
    static void penUp() { down = false; }
    static void penDown() { down = true; }
    static void penColor(String c) { color = c; }
    static void penSize(double s) { size = s; }

    static void goTo(double nx, double ny) {
        if (down) lines.append(String.format(java.util.Locale.ROOT, "<line x1=\\"%.1f\\" y1=\\"%.1f\\" x2=\\"%.1f\\" y2=\\"%.1f\\" stroke=\\"%s\\" stroke-width=\\"%.1f\\" stroke-linecap=\\"round\\"/>%n", x, -y, nx, -ny, color, size));
        x = nx;
        y = ny;
        save();
    }

    static void clear() {
        lines.setLength(0);
        save();
    }

    static void save() {
        String svg = "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"-300 -300 600 600\\" width=\\"600\\" height=\\"600\\">\\n<rect x=\\"-300\\" y=\\"-300\\" width=\\"600\\" height=\\"600\\" fill=\\"white\\"/>\\n" + lines + "</svg>\\n";
        try {
            java.nio.file.Files.writeString(java.nio.file.Path.of("zeichnung.svg"), svg);
        } catch (java.io.IOException e) {
            System.err.println("zeichnung.svg kann nicht geschrieben werden");
        }
    }
}`,
    },
    mapOf: {
      code: `@SuppressWarnings("unchecked")
static <K, V> LinkedHashMap<K, V> mapOf(Object... pairs) {
    LinkedHashMap<K, V> map = new LinkedHashMap<>();
    for (int i = 0; i + 1 < pairs.length; i += 2) map.put((K) pairs[i], (V) pairs[i + 1]);
    return map;
}`,
    },
    readFile: {
      imports: ['java.nio.file.*'],
      code: `static String readFile(String name) {
    try {
        return Files.readString(Path.of(name));
    } catch (java.io.IOException e) {
        throw new RuntimeException("Datei kann nicht gelesen werden: " + name);
    }
}`,
    },
    writeFile: {
      imports: ['java.nio.file.*'],
      code: `static void writeFile(String name, String text) {
    try {
        Files.writeString(Path.of(name), text);
    } catch (java.io.IOException e) {
        throw new RuntimeException("Datei kann nicht geschrieben werden: " + name);
    }
}`,
    },
    appendLine: {
      imports: ['java.nio.file.*'],
      code: `static void appendLine(String name, String line) {
    try {
        Files.writeString(Path.of(name), line + "\\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    } catch (java.io.IOException e) {
        throw new RuntimeException("Datei kann nicht geschrieben werden: " + name);
    }
}`,
    },
    sleep: {
      code: `static void sleep(double seconds) {
    try {
        Thread.sleep((long) (seconds * 1000));
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}`,
    },
  },
  javascript: {
    turtle: {
      code: `const turtle = {
  x: 0, y: 0, angle: 0, size: 1, down: true, color: "black", lines: [],
  forward(steps) {
    this.goTo(this.x + steps * Math.cos((this.angle * Math.PI) / 180), this.y + steps * Math.sin((this.angle * Math.PI) / 180));
  },
  right(degrees) { this.angle -= degrees; },
  left(degrees) { this.angle += degrees; },
  penUp() { this.down = false; },
  penDown() { this.down = true; },
  penColor(c) { this.color = c; },
  penSize(s) { this.size = s; },
  goTo(x, y) {
    if (this.down) this.lines.push(\`<line x1="\${this.x}" y1="\${-this.y}" x2="\${x}" y2="\${-y}" stroke="\${this.color}" stroke-width="\${this.size}" stroke-linecap="round"/>\`);
    this.x = x;
    this.y = y;
    this.save();
  },
  clear() { this.lines = []; this.save(); },
  save() {
    const svg = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-300 -300 600 600" width="600" height="600">\\n<rect x="-300" y="-300" width="600" height="600" fill="white"/>\\n\${this.lines.join("\\n")}\\n</svg>\\n\`;
    require("fs").writeFileSync("zeichnung.svg", svg);
  },
};`,
    },
    toInt: {
      code: `function toInt(text) {
  const n = Number(text);
  if (String(text).trim() === "" || !Number.isInteger(n)) throw new Error("Keine ganze Zahl: " + text);
  return n;
}`,
    },
    toFloat: {
      code: `function toFloat(text) {
  const n = Number(String(text).replace(",", "."));
  if (String(text).trim() === "" || Number.isNaN(n)) throw new Error("Keine Zahl: " + text);
  return n;
}`,
    },
    sumList: { code: `function sumList(list) {\n  return list.reduce((a, b) => a + b, 0);\n}` },
    minList: { code: `function minList(list) {\n  return list.reduce((a, b) => (b < a ? b : a));\n}` },
    maxList: { code: `function maxList(list) {\n  return list.reduce((a, b) => (b > a ? b : a));\n}` },
    sortList: {
      code: `function sortList(list) {
  list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}`,
    },
    shuffleList: {
      code: `function shuffleList(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}`,
    },
    sleep: {
      code: `function sleep(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}`,
    },
  },
  csharp: {
    Turtle: {
      imports: ['System.IO', 'System.Globalization'],
      code: `static class Turtle
{
    static double x = 0, y = 0, angle = 0, size = 1;
    static bool down = true;
    static string color = "black";
    static readonly System.Text.StringBuilder lines = new System.Text.StringBuilder();

    public static void Forward(double steps)
    {
        GoTo(x + steps * Math.Cos(angle * Math.PI / 180), y + steps * Math.Sin(angle * Math.PI / 180));
    }

    public static void Right(double degrees) { angle -= degrees; }
    public static void Left(double degrees) { angle += degrees; }
    public static void PenUp() { down = false; }
    public static void PenDown() { down = true; }
    public static void PenColor(string c) { color = c; }
    public static void PenSize(double s) { size = s; }

    public static void GoTo(double nx, double ny)
    {
        if (down) lines.Append(string.Format(CultureInfo.InvariantCulture, "<line x1=\\"{0:0.0}\\" y1=\\"{1:0.0}\\" x2=\\"{2:0.0}\\" y2=\\"{3:0.0}\\" stroke=\\"{4}\\" stroke-width=\\"{5:0.0}\\" stroke-linecap=\\"round\\"/>\\n", x, -y, nx, -ny, color, size));
        x = nx;
        y = ny;
        Save();
    }

    public static void Clear()
    {
        lines.Clear();
        Save();
    }

    static void Save()
    {
        File.WriteAllText("zeichnung.svg", "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"-300 -300 600 600\\" width=\\"600\\" height=\\"600\\">\\n<rect x=\\"-300\\" y=\\"-300\\" width=\\"600\\" height=\\"600\\" fill=\\"white\\"/>\\n" + lines + "</svg>\\n");
    }
}`,
    },
    Shuffle: {
      random: true,
      code: `static void Shuffle<T>(List<T> list)
{
    for (int i = list.Count - 1; i > 0; i--)
    {
        int j = random.Next(i + 1);
        (list[i], list[j]) = (list[j], list[i]);
    }
}`,
    },
  },
  cpp: {
    turtle: {
      imports: ['<cmath>', '<fstream>', '<sstream>'],
      code: `namespace turtle {
double x = 0, y = 0, angle = 0, size = 1;
bool down = true;
string color = "black";
ostringstream lines;

void save() {
    ofstream file("zeichnung.svg");
    file << "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"-300 -300 600 600\\" width=\\"600\\" height=\\"600\\">\\n";
    file << "<rect x=\\"-300\\" y=\\"-300\\" width=\\"600\\" height=\\"600\\" fill=\\"white\\"/>\\n" << lines.str() << "</svg>\\n";
}

void goTo(double nx, double ny) {
    if (down) lines << "<line x1=\\"" << x << "\\" y1=\\"" << -y << "\\" x2=\\"" << nx << "\\" y2=\\"" << -ny << "\\" stroke=\\"" << color << "\\" stroke-width=\\"" << size << "\\" stroke-linecap=\\"round\\"/>\\n";
    x = nx;
    y = ny;
    save();
}

void forward(double steps) { goTo(x + steps * cos(angle * M_PI / 180), y + steps * sin(angle * M_PI / 180)); }
void right(double degrees) { angle -= degrees; }
void left(double degrees) { angle += degrees; }
void penUp() { down = false; }
void penDown() { down = true; }
void penColor(const string& c) { color = c; }
void penSize(double s) { size = s; }
void clear() { lines.str(""); save(); }
}`,
    },
    keysOf: {
      imports: ['<map>'],
      code: `template <typename K, typename V>
vector<K> keysOf(const map<K, V>& m) {
    vector<K> keys;
    for (const auto& entry : m) keys.push_back(entry.first);
    return keys;
}`,
    },
    valuesOf: {
      imports: ['<map>'],
      code: `template <typename K, typename V>
vector<V> valuesOf(const map<K, V>& m) {
    vector<V> values;
    for (const auto& entry : m) values.push_back(entry.second);
    return values;
}`,
    },
    readFile: {
      imports: ['<fstream>', '<sstream>'],
      code: `string readFile(const string& name) {
    ifstream file(name);
    if (!file) throw runtime_error("Datei kann nicht gelesen werden: " + name);
    stringstream text;
    text << file.rdbuf();
    return text.str();
}`,
    },
    writeFile: {
      imports: ['<fstream>'],
      code: `void writeFile(const string& name, const string& text) {
    ofstream file(name);
    file << text;
}`,
    },
    appendLine: {
      imports: ['<fstream>'],
      code: `void appendLine(const string& name, const string& line) {
    ofstream file(name, ios::app);
    file << line << "\\n";
}`,
    },
    fileExists: {
      imports: ['<fstream>'],
      code: `bool fileExists(const string& name) {
    return ifstream(name).good();
}`,
    },
    toUpper: {
      imports: ['<cctype>'],
      code: `string toUpper(string text) {
    for (auto& c : text) c = toupper(c);
    return text;
}`,
    },
    toLower: {
      imports: ['<cctype>'],
      code: `string toLower(string text) {
    for (auto& c : text) c = tolower(c);
    return text;
}`,
    },
    trim: {
      code: `string trim(const string& text) {
    size_t start = text.find_first_not_of(" \\t\\r\\n");
    if (start == string::npos) return "";
    size_t end = text.find_last_not_of(" \\t\\r\\n");
    return text.substr(start, end - start + 1);
}`,
    },
    endsWith: {
      code: `bool endsWith(const string& text, const string& end) {
    return text.size() >= end.size() && text.compare(text.size() - end.size(), end.size(), end) == 0;
}`,
    },
    replaceAll: {
      code: `string replaceAll(string text, const string& from, const string& to) {
    if (from.empty()) return text;
    size_t pos = 0;
    while ((pos = text.find(from, pos)) != string::npos) {
        text.replace(pos, from.size(), to);
        pos += to.size();
    }
    return text;
}`,
    },
    split: {
      code: `vector<string> split(const string& text, const string& separator) {
    vector<string> parts;
    size_t start = 0, pos;
    while ((pos = text.find(separator, start)) != string::npos) {
        parts.push_back(text.substr(start, pos - start));
        start = pos + separator.size();
    }
    parts.push_back(text.substr(start));
    return parts;
}`,
    },
    toText: {
      imports: ['<sstream>'],
      code: `template <typename T>
string toText(const T& value) {
    ostringstream out;
    out << value;
    return out.str();
}`,
    },
    joinList: {
      imports: ['<sstream>'],
      code: `template <typename T>
string joinList(const vector<T>& items, const string& separator) {
    ostringstream out;
    for (size_t i = 0; i < items.size(); i++) {
        if (i > 0) out << separator;
        out << items[i];
    }
    return out.str();
}`,
    },
    repeatText: {
      code: `string repeatText(const string& text, int count) {
    string result;
    for (int i = 0; i < count; i++) result += text;
    return result;
}`,
    },
    indexOf: {
      imports: ['<algorithm>'],
      code: `template <typename T>
int indexOf(const vector<T>& items, const T& value) {
    auto it = find(items.begin(), items.end(), value);
    return it == items.end() ? -1 : (int) (it - items.begin());
}`,
    },
    nowSeconds: {
      imports: ['<chrono>'],
      code: `double nowSeconds() {
    return chrono::duration<double>(chrono::system_clock::now().time_since_epoch()).count();
}`,
    },
  },
  vba: {
    Turtle: {
      code: `Dim turtleX As Double, turtleY As Double, turtleAngle As Double, turtleSize As Double
Dim turtleUp As Boolean, turtleColor As String, turtleLines As String

Sub TurtleGoTo(ByVal nx As Double, ByVal ny As Double)
    If turtleSize = 0 Then turtleSize = 1
    If turtleColor = "" Then turtleColor = "black"
    If Not turtleUp Then
        turtleLines = turtleLines & "<line x1=""" & Str(turtleX) & """ y1=""" & Str(-turtleY) & """ x2=""" & Str(nx) & """ y2=""" & Str(-ny) & """ stroke=""" & turtleColor & """ stroke-width=""" & Str(turtleSize) & """/>" & vbLf
    End If
    turtleX = nx
    turtleY = ny
    TurtleSave
End Sub

Sub TurtleForward(ByVal steps As Double)
    Const PI As Double = 3.14159265358979
    TurtleGoTo turtleX + steps * Cos(turtleAngle * PI / 180), turtleY + steps * Sin(turtleAngle * PI / 180)
End Sub

Sub TurtleRight(ByVal degrees As Double)
    turtleAngle = turtleAngle - degrees
End Sub

Sub TurtleLeft(ByVal degrees As Double)
    turtleAngle = turtleAngle + degrees
End Sub

Sub TurtlePenUp()
    turtleUp = True
End Sub

Sub TurtlePenDown()
    turtleUp = False
End Sub

Sub TurtleColor(ByVal c As String)
    turtleColor = c
End Sub

Sub TurtleSize(ByVal s As Double)
    turtleSize = s
End Sub

Sub TurtleClear()
    turtleLines = ""
    TurtleSave
End Sub

Sub TurtleSave()
    Dim f As Integer
    f = FreeFile
    Open "zeichnung.svg" For Output As #f
    Print #f, "<svg xmlns=""http://www.w3.org/2000/svg"" viewBox=""-300 -300 600 600"" width=""600"" height=""600"">"
    Print #f, "<rect x=""-300"" y=""-300"" width=""600"" height=""600"" fill=""white""/>"
    Print #f, turtleLines & "</svg>"
    Close #f
End Sub`,
    },
    NewDict: {
      code: `Function NewDict(ParamArray pairs() As Variant) As Object
    Dim i As Long
    Set NewDict = CreateObject("Scripting.Dictionary")
    For i = LBound(pairs) To UBound(pairs) - 1 Step 2
        NewDict(pairs(i)) = pairs(i + 1)
    Next i
End Function`,
    },
    ListSum: {
      code: `Function ListSum(list As Variant) As Variant
    Dim x As Variant
    ListSum = 0
    For Each x In list
        ListSum = ListSum + x
    Next x
End Function`,
    },
    ListMin: {
      code: `Function ListMin(list As Variant) As Variant
    Dim x As Variant
    ListMin = list(LBound(list))
    For Each x In list
        If x < ListMin Then ListMin = x
    Next x
End Function`,
    },
    ListMax: {
      code: `Function ListMax(list As Variant) As Variant
    Dim x As Variant
    ListMax = list(LBound(list))
    For Each x In list
        If x > ListMax Then ListMax = x
    Next x
End Function`,
    },
    ReadFile: {
      code: `Function ReadFile(name As String) As String
    Dim f As Integer
    f = FreeFile
    Open name For Input As #f
    ReadFile = Input$(LOF(f), f)
    Close #f
End Function`,
    },
    WriteFile: {
      code: `Sub WriteFile(name As String, text As String)
    Dim f As Integer
    f = FreeFile
    Open name For Output As #f
    Print #f, text;
    Close #f
End Sub`,
    },
    AppendLine: {
      code: `Sub AppendLine(name As String, line As String)
    Dim f As Integer
    f = FreeFile
    Open name For Append As #f
    Print #f, line
    Close #f
End Sub`,
    },
    ArcSin: { code: `Function ArcSin(x As Double) As Double\n    ArcSin = Atn(x / Sqr(-x * x + 1))\nEnd Function` },
    ArcCos: { code: `Function ArcCos(x As Double) As Double\n    ArcCos = Atn(-x / Sqr(-x * x + 1)) + 2 * Atn(1)\nEnd Function` },
    RepeatText: {
      code: `Function RepeatText(text As String, count As Long) As String
    Dim i As Long
    For i = 1 To count
        RepeatText = RepeatText & text
    Next i
End Function`,
    },
    SortList: {
      code: `Sub SortList(list As Variant)
    Dim i As Long, j As Long, tmp As Variant
    For i = LBound(list) To UBound(list) - 1
        For j = LBound(list) To UBound(list) - 1 - (i - LBound(list))
            If list(j) > list(j + 1) Then
                tmp = list(j)
                list(j) = list(j + 1)
                list(j + 1) = tmp
            End If
        Next j
    Next i
End Sub`,
    },
    ReverseList: {
      code: `Sub ReverseList(list As Variant)
    Dim i As Long, n As Long, tmp As Variant
    n = UBound(list) + LBound(list)
    For i = LBound(list) To (n - 1) \\ 2
        tmp = list(i)
        list(i) = list(n - i)
        list(n - i) = tmp
    Next i
End Sub`,
    },
    ListContains: {
      code: `Function ListContains(list As Variant, value As Variant) As Boolean
    ListContains = (ListIndexOf(list, value) >= 0)
End Function`,
    },
    ListIndexOf: {
      code: `Function ListIndexOf(list As Variant, value As Variant) As Long
    Dim i As Long
    ListIndexOf = -1
    For i = LBound(list) To UBound(list)
        If list(i) = value Then
            ListIndexOf = i
            Exit Function
        End If
    Next i
End Function`,
    },
    RemoveAt: {
      code: `Sub RemoveAt(list As Variant, position As Long)
    Dim i As Long
    For i = position To UBound(list) - 1
        list(i) = list(i + 1)
    Next i
    If UBound(list) = 0 Then
        list = Array()
    Else
        ReDim Preserve list(UBound(list) - 1)
    End If
End Sub`,
    },
    InsertAt: {
      code: `Sub InsertAt(list As Variant, position As Long, value As Variant)
    Dim i As Long
    ReDim Preserve list(UBound(list) + 1)
    For i = UBound(list) To position + 1 Step -1
        list(i) = list(i - 1)
    Next i
    list(position) = value
End Sub`,
    },
    ClearList: { code: `Sub ClearList(list As Variant)\n    list = Array()\nEnd Sub` },
    ShuffleList: {
      code: `Sub ShuffleList(list As Variant)
    Dim i As Long, j As Long, tmp As Variant
    For i = UBound(list) To LBound(list) + 1 Step -1
        j = Int(Rnd() * (i + 1))
        tmp = list(i)
        list(i) = list(j)
        list(j) = tmp
    Next i
End Sub`,
    },
    Warte: {
      code: `Sub Warte(seconds As Double)
    Dim start As Double
    start = Timer
    Do While Timer < start + seconds
        DoEvents
    Loop
End Sub`,
    },
  },
};

/** Names of helper functions per language (they are skipped when code is parsed). */
export function helperNames(lang: Lang): Set<string> {
  const names = new Set(Object.keys(HELPERS[lang] ?? {}));
  names.add(lang === 'csharp' ? 'Input' : 'input');
  if (lang === 'vba') {
    // a VBA helper can contain several procedures (e.g. TurtleForward, TurtleRight, ...)
    for (const h of Object.values(HELPERS.vba ?? {})) for (const m of h.code.matchAll(/^(?:Sub|Function)\s+(\w+)/gm)) names.add(m[1]);
  }
  return names;
}

/** Module-level variables of the VBA helpers (they are not part of the user's program). */
export function vbaHelperGlobals(): Set<string> {
  const names = new Set<string>();
  for (const h of Object.values(HELPERS.vba ?? {})) {
    for (const m of h.code.matchAll(/^Dim (.+)$/gm)) for (const part of m[1].split(',')) names.add(part.trim().split(/\s+/)[0].toLowerCase());
  }
  return names;
}
