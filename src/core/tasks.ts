// Guided exercises ("Aufgaben"): a description, a hint and an automatic check.
// The check runs the program with the built-in runner (with the given inputs),
// compares the output and looks for the blocks the exercise asks for.

import type { Ex, Expr, Lang, Program, Stmt } from './ir';
import { walkAllExprs, walkStmts } from './ir';
import { RunError, runProgram } from './interpreter';

/** Constructs an exercise can ask for. */
export type Requirement = 'ask' | 'loop' | 'if' | 'list' | 'dict' | 'class' | `function:${string}`;

export interface TaskCase {
  input?: string[];
  output: string;
  /** The order of the lines does not matter (e.g. C++ goes through dictionary keys sorted). */
  anyOrder?: boolean;
}

export interface Task {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  /** What to do (plain text, may contain line breaks). */
  text: string;
  hint: string;
  cases: TaskCase[];
  requires?: Requirement[];
  /** Reference solution (used by the tests: every exercise must be solvable). */
  solution: Program;
}

export interface TaskResult {
  ok: boolean;
  messages: string[];
}

const n = (v: number): Expr => ({ k: 'num', v });
const s = (v: string): Expr => ({ k: 'str', v });
const v = (name: string): Expr => ({ k: 'var', name });
const bin = (op: any, a: Ex, b: Ex): Expr => ({ k: 'bin', op, a, b });
const print = (value: Ex): Stmt => ({ k: 'print', value, newline: true });
const set = (name: string, value: Ex): Stmt => ({ k: 'set', name, value });
const join = (...parts: Ex[]): Expr => ({ k: 'join', parts });
const self: Expr = { k: 'self' };

export const TASKS: Task[] = [
  {
    id: 'hallo',
    title: 'Hallo, Welt!',
    level: 1,
    text: 'Dein erstes Programm: Gib den Text „Hallo, Welt!“ aus.',
    hint: 'Zieh den Block „schreibe …“ aus „Ausgabe“ unter „Wenn Programm startet“ und tippe den Text in das weiße Feld.',
    cases: [{ output: 'Hallo, Welt!' }],
    solution: { functions: [], main: [print(s('Hallo, Welt!'))] },
  },
  {
    id: 'begruessung',
    title: 'Persönliche Begrüßung',
    level: 1,
    text: 'Frage nach dem Namen und begrüße dann mit „Hallo, <Name>!“.\nBeispiel: Bei der Eingabe Ada erscheint „Hallo, Ada!“.',
    hint: 'Nimm „frage … und lies Text“ und speichere die Antwort mit „setze name auf …“. Mit „verbinde“ (Text) setzt du „Hallo, “, den Namen und „!“ zusammen.',
    cases: [
      { input: ['Ada'], output: 'Hallo, Ada!' },
      { input: ['Linus'], output: 'Hallo, Linus!' },
    ],
    requires: ['ask'],
    solution: {
      functions: [],
      main: [set('name', { k: 'ask', prompt: s('Wie heißt du? '), as: 'text' }), print(join(s('Hallo, '), v('name'), s('!')))],
    },
  },
  {
    id: 'countdown',
    title: 'Countdown',
    level: 1,
    text: 'Zähle von 10 bis 1 herunter (jede Zahl in eine eigene Zeile) und gib danach „Start!“ aus. Benutze eine Schleife.',
    hint: 'Der Block „zähle i von 10 bis 1 Schritt -1“ macht das. Darin: „schreibe i“. Nach der Schleife: „schreibe Start!“.',
    cases: [{ output: '10\n9\n8\n7\n6\n5\n4\n3\n2\n1\nStart!' }],
    requires: ['loop'],
    solution: {
      functions: [],
      main: [{ k: 'for', var: 'i', from: n(10), to: n(1), by: n(-1), body: [print(v('i'))] }, print(s('Start!'))],
    },
  },
  {
    id: 'gerade',
    title: 'Gerade oder ungerade?',
    level: 1,
    text: 'Lies eine ganze Zahl ein. Gib „gerade“ aus, wenn sie gerade ist, sonst „ungerade“.',
    hint: 'Eine Zahl ist gerade, wenn der Rest beim Teilen durch 2 gleich 0 ist: „Rest von zahl ÷ 2 = 0“ im Block „falls … sonst“.',
    cases: [
      { input: ['4'], output: 'gerade' },
      { input: ['7'], output: 'ungerade' },
      { input: ['0'], output: 'gerade' },
    ],
    requires: ['ask', 'if'],
    solution: {
      functions: [],
      main: [
        set('zahl', { k: 'ask', prompt: s('Zahl: '), as: 'int' }),
        { k: 'if', branches: [{ cond: bin('EQ', bin('MOD', v('zahl'), n(2)), n(0)), body: [print(s('gerade'))] }], else: [print(s('ungerade'))] },
      ],
    },
  },
  {
    id: 'summe',
    title: 'Summe bis 100',
    level: 2,
    text: 'Berechne mit einer Schleife die Summe 1 + 2 + 3 + … + 100 und gib das Ergebnis aus.',
    hint: 'Setze „summe auf 0“. Dann „zähle i von 1 bis 100“ und darin „ändere summe um i“. Zum Schluss „schreibe summe“.',
    cases: [{ output: '5050' }],
    requires: ['loop'],
    solution: {
      functions: [],
      main: [set('summe', n(0)), { k: 'for', var: 'i', from: n(1), to: n(100), by: n(1), body: [{ k: 'change', name: 'summe', by: v('i') }] }, print(v('summe'))],
    },
  },
  {
    id: 'quadrat',
    title: 'Eigene Funktion',
    level: 2,
    text: 'Schreibe eine Funktion „quadrat“ mit einem Wert x, die x · x zurückgibt. Gib dann quadrat(7) und quadrat(12) aus.',
    hint: 'In „Funktionen“: „definiere … gib zurück“. Nenne sie quadrat und füge über das Zahnrad einen Wert x hinzu. Aufrufen kannst du sie mit dem Block „quadrat“.',
    cases: [{ output: '49\n144' }],
    requires: ['function:quadrat'],
    solution: {
      functions: [{ name: 'quadrat', params: ['x'], returns: true, body: [{ k: 'return', value: bin('MUL', v('x'), v('x')) }] }],
      main: [print({ k: 'call', name: 'quadrat', args: [n(7)] }), print({ k: 'call', name: 'quadrat', args: [n(12)] })],
    },
  },
  {
    id: 'maximum',
    title: 'Die größte Zahl',
    level: 2,
    text: 'Lege eine Liste mit den Zahlen 4, 8, 15, 16, 23, 42, 7 an. Finde mit einer Schleife die größte Zahl und gib sie aus.',
    hint: 'Merke dir die bisher größte Zahl in einer Variablen (am Anfang das erste Element). Gehe mit „für jedes Element“ durch die Liste und ersetze sie, falls das Element größer ist.',
    cases: [{ output: '42' }],
    requires: ['list', 'loop', 'if'],
    solution: {
      functions: [],
      main: [
        set('zahlen', { k: 'list', items: [4, 8, 15, 16, 23, 42, 7].map(n) }),
        set('groesste', { k: 'index', list: v('zahlen'), index: n(0) }),
        {
          k: 'foreach',
          var: 'z',
          list: v('zahlen'),
          body: [{ k: 'if', branches: [{ cond: bin('GT', v('z'), v('groesste')), body: [set('groesste', v('z'))] }], else: null }],
        },
        print(v('groesste')),
      ],
    },
  },
  {
    id: 'fizzbuzz',
    title: 'FizzBuzz',
    level: 2,
    text: 'Gib die Zahlen von 1 bis 15 aus. Statt Vielfachen von 3 schreibe „Fizz“, statt Vielfachen von 5 „Buzz“ und statt Vielfachen von 15 „FizzBuzz“.',
    hint: 'Prüfe zuerst auf 15, dann auf 3, dann auf 5 – mit „falls … sonst falls … sonst“. Ein Vielfaches erkennst du am Rest 0.',
    cases: [{ output: '1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz' }],
    requires: ['loop', 'if'],
    solution: {
      functions: [],
      main: [
        {
          k: 'for',
          var: 'z',
          from: n(1),
          to: n(15),
          by: n(1),
          body: [
            {
              k: 'if',
              branches: [
                { cond: bin('EQ', bin('MOD', v('z'), n(15)), n(0)), body: [print(s('FizzBuzz'))] },
                { cond: bin('EQ', bin('MOD', v('z'), n(3)), n(0)), body: [print(s('Fizz'))] },
                { cond: bin('EQ', bin('MOD', v('z'), n(5)), n(0)), body: [print(s('Buzz'))] },
              ],
              else: [print(v('z'))],
            },
          ],
        },
      ],
    },
  },
  {
    id: 'noten',
    title: 'Notenbuch (Wörterbuch)',
    level: 3,
    text: 'Lege ein Wörterbuch mit den Noten Mathe → 2 und Deutsch → 1 an. Trage danach Kunst → 3 ein. Gib dann für jedes Fach „Fach: Note“ aus (Mathe, Deutsch, Kunst).',
    hint: '„Wörterbuch“ mit zwei Paaren, dann „setze Schlüssel … auf …“. Mit „für jedes Element in Schlüssel von …“ (Bibliothek Wörterbuch) gehst du alle Fächer durch.',
    cases: [{ output: 'Mathe: 2\nDeutsch: 1\nKunst: 3', anyOrder: true }],
    requires: ['dict'],
    solution: {
      functions: [],
      main: [
        set('noten', { k: 'dict', entries: [{ key: s('Mathe'), value: n(2) }, { key: s('Deutsch'), value: n(1) }] }),
        { k: 'dset', dict: v('noten'), key: s('Kunst'), value: n(3) },
        {
          k: 'foreach',
          var: 'fach',
          list: { k: 'lib', lib: 'dict', fn: 'keys', args: [v('noten')] },
          body: [print(join(v('fach'), s(': '), { k: 'dget', dict: v('noten'), key: v('fach') }))],
        },
      ],
    },
  },
  {
    id: 'hund',
    title: 'Eigene Klasse',
    level: 3,
    text: 'Erstelle eine Klasse „Hund“ mit der Eigenschaft name (wird beim Erzeugen übergeben) und der Methode bellen, die „<name> sagt Wuff!“ ausgibt. Erzeuge die Hunde Bello und Luna und lass beide bellen.',
    hint: 'In „Klassen“: „Klasse Hund“ mit „beim Erzeugen mit Werten name“ (darin „setze Eigenschaft name von dieses Objekt auf name“) und „Methode bellen“. Im Hauptprogramm: „setze bello auf neues Objekt Hund mit Bello“ und „rufe von bello die Methode bellen auf“.',
    cases: [{ output: 'Bello sagt Wuff!\nLuna sagt Wuff!' }],
    requires: ['class'],
    solution: {
      functions: [],
      classes: [
        {
          name: 'Hund',
          fields: [],
          ctorParams: ['name'],
          ctor: [{ k: 'fset', obj: self, name: 'name', value: v('name') }],
          methods: [{ name: 'bellen', params: [], returns: false, body: [print(join({ k: 'member', obj: self, name: 'name' }, s(' sagt Wuff!')))] }],
        },
      ],
      main: [
        set('bello', { k: 'new', cls: 'Hund', args: [s('Bello')] }),
        set('luna', { k: 'new', cls: 'Hund', args: [s('Luna')] }),
        { k: 'methodstmt', obj: v('bello'), name: 'bellen', args: [] },
        { k: 'methodstmt', obj: v('luna'), name: 'bellen', args: [] },
      ],
    },
  },
];

const REQUIREMENT_TEXT: Record<string, string> = {
  ask: 'Benutze eine Eingabe („frage … und lies“).',
  loop: 'Benutze eine Schleife („wiederhole“, „zähle“ oder „für jedes Element“).',
  if: 'Benutze eine Bedingung („falls …“).',
  list: 'Benutze eine Liste.',
  dict: 'Benutze ein Wörterbuch.',
  class: 'Erstelle eine eigene Klasse.',
};

function allStatements(p: Program): Stmt[] {
  return [...(p.main ?? []), ...p.functions.flatMap((f) => f.body), ...(p.classes ?? []).flatMap((c) => [...c.ctor, ...c.methods.flatMap((m) => m.body)])];
}

function meets(p: Program, r: Requirement): boolean {
  const stmts = allStatements(p);
  if (r.startsWith('function:')) {
    const name = r.slice('function:'.length);
    return p.functions.some((f) => f.name.toLowerCase() === name.toLowerCase());
  }
  if (r === 'class') return (p.classes ?? []).length > 0;
  let found = false;
  walkStmts(stmts, (s) => {
    if (r === 'loop' && (s.k === 'repeat' || s.k === 'while' || s.k === 'for' || s.k === 'foreach')) found = true;
    if (r === 'if' && s.k === 'if') found = true;
    if (r === 'dict' && s.k === 'dset') found = true;
  });
  walkAllExprs(stmts, (e) => {
    if (r === 'ask' && e.k === 'ask') found = true;
    if (r === 'list' && e.k === 'list') found = true;
    if (r === 'dict' && e.k === 'dict') found = true;
  });
  return found;
}

const tidy = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();

/** Checks a program against an exercise. */
export async function checkTask(task: Task, program: Program, lang: Lang = 'python'): Promise<TaskResult> {
  const messages: string[] = [];
  if (!program.main) return { ok: false, messages: ['Es fehlt der Block „Wenn Programm startet“.'] };
  for (const r of task.requires ?? []) {
    if (!meets(program, r)) messages.push(r.startsWith('function:') ? `Erstelle eine Funktion „${r.slice(9)}“.` : REQUIREMENT_TEXT[r]);
  }
  for (const c of task.cases) {
    let out = '';
    const queue = [...(c.input ?? [])];
    let steps = 0;
    let tooLong = false;
    try {
      await runProgram(
        program,
        {
          write: (t) => (out += t),
          input: async () => queue.shift() ?? '',
          shouldStop: () => {
            if (++steps > 200000) tooLong = true;
            return tooLong;
          },
        },
        lang,
      );
    } catch (err) {
      const msg = err instanceof RunError || err instanceof Error ? err.message : String(err);
      messages.push(`Beim Ausführen gab es einen Fehler: ${msg}`);
      break;
    }
    if (tooLong) {
      messages.push('Das Programm läuft zu lange – vielleicht eine Endlosschleife?');
      break;
    }
    const sorted = (t: string) => tidy(t).split('\n').sort().join('\n');
    if (c.anyOrder ? sorted(out) !== sorted(c.output) : tidy(out) !== tidy(c.output)) {
      const withInput = c.input?.length ? ` (Eingabe: ${c.input.join(', ')})` : '';
      messages.push(`Die Ausgabe stimmt noch nicht${withInput}.\nErwartet:\n${tidy(c.output)}\nBekommen:\n${tidy(out) || '(nichts)'}`);
      break;
    }
  }
  return { ok: messages.length === 0, messages };
}
