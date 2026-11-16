// Guided exercises ("Aufgaben"): a description, a hint and an automatic check.
// The check runs the program with the built-in runner (with the given inputs),
// compares the output and looks for the blocks the exercise asks for.

import type { Ex, Expr, Lang, Program, Stmt } from './ir';
import { walkAllExprs, walkStmts } from './ir';
import { RunError, runProgram } from './interpreter';
import { parse } from './parsers';

/** A reference solution written in Python (easier to read than the program model). */
const py = (code: string): Program => parse(code, 'python').program;

/** Constructs an exercise can ask for. */
export type Requirement = 'ask' | 'loop' | 'if' | 'list' | 'dict' | 'class' | 'inherit' | 'try' | `function:${string}`;

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
    id: 'flaeche',
    title: 'Fläche eines Rechtecks',
    level: 1,
    text: 'Lies die Breite und die Höhe eines Rechtecks als Kommazahlen ein. Gib die Fläche mit genau zwei Stellen nach dem Komma aus, z. B. „Fläche: 7.50“.',
    hint: 'Zwei Blöcke „frage … und lies Kommazahl“. Die Fläche ist Breite × Höhe. Für die zwei Nachkommastellen gibt es in „Text“ den Block „Zahl mit Nachkommastellen“.',
    cases: [
      { input: ['2.5', '3'], output: 'Fläche: 7.50' },
      { input: ['1', '1'], output: 'Fläche: 1.00' },
    ],
    requires: ['ask'],
    solution: py('breite = float(input("Breite: "))\nhoehe = float(input("Höhe: "))\nprint(f"Fläche: {breite * hoehe:.2f}")\n'),
  },
  {
    id: 'treppe',
    title: 'Sternen-Treppe',
    level: 1,
    text: 'Lies eine ganze Zahl n ein und zeichne eine Treppe aus Sternen: In Zeile 1 steht ein Stern, in Zeile 2 zwei Sterne … bis n Sterne.',
    hint: 'Eine Schleife „zähle i von 1 bis n“. In „Text“ gibt es einen Block, der einen Text mehrmals wiederholt („*“ i-mal).',
    cases: [
      { input: ['3'], output: '*\n**\n***' },
      { input: ['5'], output: '*\n**\n***\n****\n*****' },
    ],
    requires: ['ask', 'loop'],
    solution: py('n = int(input("Wie hoch? "))\nfor i in range(1, n + 1):\n    print("*" * i)\n'),
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
    id: 'durchschnitt',
    title: 'Notendurchschnitt',
    level: 2,
    text: 'Lege eine Liste mit den Noten 2, 3, 1, 4 an. Berechne den Durchschnitt und gib ihn mit zwei Nachkommastellen aus: „Durchschnitt: 2.50“.',
    hint: 'Der Durchschnitt ist die Summe geteilt durch die Anzahl. „Summe“ und „Länge“ findest du bei den Listen, „Zahl mit Nachkommastellen“ bei Text.',
    cases: [{ output: 'Durchschnitt: 2.50' }],
    requires: ['list'],
    solution: py('noten = [2, 3, 1, 4]\nschnitt = sum(noten) / len(noten)\nprint(f"Durchschnitt: {schnitt:.2f}")\n'),
  },
  {
    id: 'eingabe-pruefen',
    title: 'Falsche Eingaben abfangen',
    level: 2,
    text: 'Lies eine ganze Zahl ein und gib das Doppelte aus. Tippt jemand etwas, das keine Zahl ist, soll das Programm nicht abbrechen, sondern „Das ist keine Zahl.“ ausgeben.',
    hint: 'Steck das Einlesen und die Ausgabe in „versuche … falls ein Fehler auftritt“. Im Fehler-Teil schreibst du die Meldung.',
    cases: [
      { input: ['21'], output: '42' },
      { input: ['abc'], output: 'Das ist keine Zahl.' },
    ],
    requires: ['ask', 'try'],
    solution: py('try:\n    zahl = int(input("Zahl: "))\n    print(zahl * 2)\nexcept ValueError:\n    print("Das ist keine Zahl.")\n'),
  },
  {
    id: 'laengstes-wort',
    title: 'Das längste Wort',
    level: 2,
    text: 'Teile den Satz „Blöcke machen Programmieren leicht“ an den Leerzeichen in Wörter. Gib das längste Wort aus.',
    hint: '„zerlege Text bei“ (Text) liefert eine Liste der Wörter. Merke dir das bisher längste Wort und vergleiche mit „für jedes Element“ die Längen.',
    cases: [{ output: 'Programmieren' }],
    requires: ['loop', 'if'],
    solution: py('satz = "Blöcke machen Programmieren leicht"\nlaengstes = ""\nfor wort in satz.split(" "):\n    if len(wort) > len(laengstes):\n        laengstes = wort\nprint(laengstes)\n'),
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
  {
    id: 'formen',
    title: 'Formen (Vererbung)',
    level: 3,
    text: 'Erstelle eine Klasse „Form“ mit den Methoden flaeche (gibt 0 zurück) und beschreibung (gibt „Form mit Fläche …“ aus). Die Klasse „Rechteck“ erbt von Form, bekommt beim Erzeugen breite und hoehe und berechnet ihre Fläche. „Quadrat“ erbt von Rechteck und bekommt nur die Seite. Gib die Beschreibungen eines 2×3-Rechtecks und eines Quadrats mit Seite 3 aus.',
    hint: 'Trag bei „erbt von“ die Basisklasse ein. Quadrat ruft beim Erzeugen „Basisklasse erzeugen mit seite, seite“ auf. Die Methode beschreibung steht nur in Form – sie ruft die Methode flaeche von „dieses Objekt“ auf, und jedes Objekt nimmt seine eigene Version.',
    cases: [{ output: 'Form mit Fläche 6\nForm mit Fläche 9' }],
    requires: ['class', 'inherit'],
    solution: py(
      'class Form:\n    def flaeche(self):\n        return 0\n\n    def beschreibung(self):\n        print("Form mit Fläche " + str(self.flaeche()))\n\n\nclass Rechteck(Form):\n    def __init__(self, breite, hoehe):\n        self.breite = breite\n        self.hoehe = hoehe\n\n    def flaeche(self):\n        return self.breite * self.hoehe\n\n\nclass Quadrat(Rechteck):\n    def __init__(self, seite):\n        super().__init__(seite, seite)\n\n\nRechteck(2, 3).beschreibung()\nQuadrat(3).beschreibung()\n',
    ),
  },
];

const REQUIREMENT_TEXT: Record<string, string> = {
  ask: 'Benutze eine Eingabe („frage … und lies“).',
  loop: 'Benutze eine Schleife („wiederhole“, „zähle“ oder „für jedes Element“).',
  if: 'Benutze eine Bedingung („falls …“).',
  list: 'Benutze eine Liste.',
  dict: 'Benutze ein Wörterbuch.',
  class: 'Erstelle eine eigene Klasse.',
  inherit: 'Lass eine Klasse von einer anderen erben („erbt von“).',
  try: 'Benutze „versuche … falls ein Fehler auftritt“.',
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
  if (r === 'inherit') return (p.classes ?? []).some((c) => !!c.base);
  let found = false;
  walkStmts(stmts, (s) => {
    if (r === 'loop' && (s.k === 'repeat' || s.k === 'while' || s.k === 'for' || s.k === 'foreach')) found = true;
    if (r === 'if' && s.k === 'if') found = true;
    if (r === 'dict' && s.k === 'dset') found = true;
    if (r === 'try' && s.k === 'try') found = true;
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
