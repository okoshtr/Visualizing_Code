// Example programs (shown in the "Beispiele" menu and used by the tests).

import type { Ex, Expr, Program, Stmt } from './ir';

const n = (v: number): Expr => ({ k: 'num', v });
const s = (v: string): Expr => ({ k: 'str', v });
const v = (name: string): Expr => ({ k: 'var', name });
const bin = (op: any, a: Ex, b: Ex): Expr => ({ k: 'bin', op, a, b });
const join = (...parts: Ex[]): Expr => ({ k: 'join', parts });
const print = (value: Ex, newline = true): Stmt => ({ k: 'print', value, newline });
const set = (name: string, value: Ex): Stmt => ({ k: 'set', name, value });

export interface Example {
  id: string;
  title: string;
  description: string;
  program: Program;
  /** Input lines for automated tests. */
  input?: string[];
}

export const EXAMPLES: Example[] = [
  {
    id: 'hallo',
    title: 'Hallo Welt',
    description: 'Ausgabe und Eingabe',
    input: ['Ada'],
    program: {
      functions: [],
      main: [
        print(s('Hallo Welt!')),
        set('name', { k: 'ask', prompt: s('Wie heißt du? '), as: 'text' }),
        print(join(s('Schön, dich kennenzulernen, '), v('name'), s('!'))),
      ],
    },
  },
  {
    id: 'einmaleins',
    title: 'Einmaleins',
    description: 'Zwei verschachtelte Zählschleifen',
    program: {
      functions: [],
      main: [
        { k: 'comment', text: 'Das kleine Einmaleins bis 5' },
        {
          k: 'for',
          var: 'zeile',
          from: n(1),
          to: n(5),
          by: n(1),
          body: [
            set('text', s('')),
            {
              k: 'for',
              var: 'spalte',
              from: n(1),
              to: n(5),
              by: n(1),
              body: [set('text', join(v('text'), bin('MUL', v('zeile'), v('spalte')), s(' ')))],
            },
            print(v('text')),
          ],
        },
      ],
    },
  },
  {
    id: 'fizzbuzz',
    title: 'FizzBuzz',
    description: 'Bedingungen mit "sonst falls"',
    program: {
      functions: [],
      main: [
        {
          k: 'for',
          var: 'zahl',
          from: n(1),
          to: n(15),
          by: n(1),
          body: [
            {
              k: 'if',
              branches: [
                { cond: bin('EQ', bin('MOD', v('zahl'), n(15)), n(0)), body: [print(s('FizzBuzz'))] },
                { cond: bin('EQ', bin('MOD', v('zahl'), n(3)), n(0)), body: [print(s('Fizz'))] },
                { cond: bin('EQ', bin('MOD', v('zahl'), n(5)), n(0)), body: [print(s('Buzz'))] },
              ],
              else: [print(v('zahl'))],
            },
          ],
        },
      ],
    },
  },
  {
    id: 'fakultaet',
    title: 'Fakultät (Funktion)',
    description: 'Eigene Funktion mit Rückgabewert und Rekursion',
    program: {
      functions: [
        {
          name: 'fakultaet',
          params: ['n'],
          returns: true,
          body: [
            {
              k: 'if',
              branches: [{ cond: bin('LTE', v('n'), n(1)), body: [{ k: 'return', value: n(1) }] }],
              else: null,
            },
            { k: 'return', value: bin('MUL', v('n'), { k: 'call', name: 'fakultaet', args: [bin('SUB', v('n'), n(1))] }) },
          ],
        },
        {
          name: 'zeige',
          params: ['zahl'],
          returns: false,
          body: [print(join(v('zahl'), s('! = '), { k: 'call', name: 'fakultaet', args: [v('zahl')] }))],
        },
      ],
      main: [...[1, 5, 10].map<Stmt>((x) => ({ k: 'callstmt', name: 'zeige', args: [n(x)] }))],
    },
  },
  {
    id: 'liste',
    title: 'Listen & Bibliotheken',
    description: 'Liste füllen, sortieren und Text-Funktionen',
    program: {
      functions: [],
      main: [
        set('zahlen', { k: 'list', items: [n(5), n(3), n(8), n(1)] }),
        { k: 'listadd', list: v('zahlen'), value: n(4) },
        { k: 'libstmt', lib: 'list', fn: 'sort', args: [v('zahlen')] },
        set('summe', n(0)),
        { k: 'foreach', var: 'z', list: v('zahlen'), body: [{ k: 'change', name: 'summe', by: v('z') }] },
        print(join(s('Sortiert: '), { k: 'lib', lib: 'text', fn: 'joinList', args: [v('zahlen'), s(', ')] })),
        print(join(s('Summe: '), v('summe'))),
        print(join(s('Größte Zahl: '), { k: 'index', list: v('zahlen'), index: bin('SUB', { k: 'len', of: 'list', a: v('zahlen') }, n(1)) })),
        set('wort', s('Blockprogrammierung')),
        print({ k: 'lib', lib: 'text', fn: 'upper', args: [v('wort')] }),
        print(join(s('Länge: '), { k: 'len', of: 'text', a: v('wort') })),
        {
          k: 'if',
          branches: [{ cond: { k: 'lib', lib: 'text', fn: 'contains', args: [v('wort'), s('program')] }, body: [print(s('enthält "program"'))] }],
          else: null,
        },
        print(join(s('Wurzel aus 2: '), { k: 'math', fn: 'round', a: bin('MUL', { k: 'math', fn: 'sqrt', a: n(2) }, n(1000)) })),
      ],
    },
  },
  {
    id: 'spirale',
    title: 'Bunte Spirale (Zeichnen)',
    description: 'Bibliothek „Zeichnen“: vorwärts gehen und drehen',
    program: {
      functions: [],
      main: [
        set('farben', { k: 'list', items: ['red', 'orange', 'gold', 'green', 'blue', 'purple'].map(s) }),
        { k: 'libstmt', lib: 'draw', fn: 'pensize', args: [n(2)] },
        {
          k: 'for',
          var: 'i',
          from: n(1),
          to: n(72),
          by: n(1),
          body: [
            { k: 'libstmt', lib: 'draw', fn: 'pencolor', args: [{ k: 'index', list: v('farben'), index: bin('MOD', v('i'), n(6)) }] },
            { k: 'libstmt', lib: 'draw', fn: 'forward', args: [bin('MUL', v('i'), n(4))] },
            { k: 'libstmt', lib: 'draw', fn: 'right', args: [n(61)] },
          ],
        },
      ],
    },
  },
  {
    id: 'konto',
    title: 'Bankkonto (Klasse)',
    description: 'Eigene Klasse mit Eigenschaften, Konstruktor und Methoden',
    program: {
      functions: [],
      classes: [
        {
          name: 'Konto',
          fields: [{ name: 'kontostand', value: n(0) }],
          ctorParams: ['inhaber'],
          ctor: [{ k: 'fset', obj: { k: 'self' }, name: 'inhaber', value: v('inhaber') }],
          methods: [
            {
              name: 'einzahlen',
              params: ['betrag'],
              returns: false,
              body: [{ k: 'fset', obj: { k: 'self' }, name: 'kontostand', value: bin('ADD', { k: 'member', obj: { k: 'self' }, name: 'kontostand' }, v('betrag')) }],
            },
            {
              name: 'info',
              params: [],
              returns: true,
              body: [{ k: 'return', value: join({ k: 'member', obj: { k: 'self' }, name: 'inhaber' }, s(': '), { k: 'member', obj: { k: 'self' }, name: 'kontostand' }, s(' Euro')) }],
            },
          ],
        },
      ],
      main: [
        set('konto', { k: 'new', cls: 'Konto', args: [s('Ada')] }),
        { k: 'methodstmt', obj: v('konto'), name: 'einzahlen', args: [n(50)] },
        { k: 'methodstmt', obj: v('konto'), name: 'einzahlen', args: [n(25)] },
        print({ k: 'method', obj: v('konto'), name: 'info', args: [] }),
        print(join(s('Stand: '), { k: 'member', obj: v('konto'), name: 'kontostand' })),
      ],
    },
  },
  {
    id: 'zahlenraten',
    title: 'Zahlenraten',
    description: 'Zufallszahl, Schleife und Eingabe',
    input: ['50', '25', '37', '43', '40', '41', '42', '38', '39', '36', '44', '45', '46', '47', '48', '49', '35'],
    program: {
      functions: [],
      main: [
        set('geheim', { k: 'random', from: n(35), to: n(49) }),
        set('versuche', n(0)),
        set('tipp', n(0)),
        print(s('Ich denke mir eine Zahl zwischen 35 und 49.')),
        {
          k: 'while',
          until: true,
          cond: bin('EQ', v('tipp'), v('geheim')),
          body: [
            set('tipp', { k: 'ask', prompt: s('Dein Tipp: '), as: 'int' }),
            { k: 'change', name: 'versuche', by: n(1) },
            {
              k: 'if',
              branches: [
                { cond: bin('LT', v('tipp'), v('geheim')), body: [print(s('Zu klein!'))] },
                { cond: bin('GT', v('tipp'), v('geheim')), body: [print(s('Zu groß!'))] },
              ],
              else: [print(join(s('Richtig! Du hast '), v('versuche'), s(' Versuche gebraucht.')))],
            },
          ],
        },
      ],
    },
  },
];
