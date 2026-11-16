// Compiles and runs the generated code with the real toolchains (if installed)
// and compares the output with the built-in runner.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, TASKS, generate, langFromFileName, parse, walkAllExprs, type Lang, type Program } from '../src/core';
import { runToText } from './helpers';

const has = (cmd: string, args: string[] = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;

const RUNNERS: Partial<Record<Lang, { available: boolean; run: (code: string, input: string) => string }>> = {
  python: { available: has('python3'), run: (code, input) => exec('python3', ['-c', code], input) },
  javascript: { available: has('node'), run: (code, input) => exec('node', ['-e', code], input) },
  java: {
    available: has('javac', ['-version']),
    run: (code, input) => {
      const dir = mkdtempSync(join(tmpdir(), 'vc-java-'));
      writeFileSync(join(dir, 'Main.java'), code);
      execFileSync('javac', ['-encoding', 'UTF-8', 'Main.java'], { cwd: dir, stdio: 'pipe' });
      return exec('java', ['-Dstdout.encoding=UTF-8', '-cp', dir, 'Main'], input);
    },
  },
  csharp: {
    available: has('dotnet'),
    run: (code, input) => {
      const dir = csharpProject();
      writeFileSync(join(dir, 'Program.cs'), code);
      return exec('dotnet', ['run', '--project', dir], input, { DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' });
    },
  },
  cpp: {
    available: has('g++'),
    run: (code, input) => {
      const dir = mkdtempSync(join(tmpdir(), 'vc-cpp-'));
      writeFileSync(join(dir, 'main.cpp'), code);
      execFileSync('g++', ['-std=c++17', '-o', join(dir, 'a.out'), join(dir, 'main.cpp')], { stdio: 'pipe' });
      return exec(join(dir, 'a.out'), [], input);
    },
  },
};

let csDir: string | null = null;
function csharpProject(): string {
  if (csDir) return csDir;
  csDir = mkdtempSync(join(tmpdir(), 'vc-cs-'));
  writeFileSync(
    join(csDir, 'run.csproj'),
    '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><Nullable>disable</Nullable><ImplicitUsings>disable</ImplicitUsings></PropertyGroup></Project>',
  );
  return csDir;
}

/** Programs run in a temporary folder (they may write files such as zeichnung.svg). */
const workDir = mkdtempSync(join(tmpdir(), 'vc-run-'));

function exec(cmd: string, args: string[], input: string, env: Record<string, string> = {}): string {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', cwd: workDir, env: { ...process.env, JAVA_TOOL_OPTIONS: '', ...env } });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
  return r.stdout;
}

const normalize = (s: string) => s.replace(/\r/g, '').trimEnd();

const n = (v: number, float = false) => ({ k: 'num', v, ...(float ? { float } : {}) }) as const;
const pr = (value: any) => ({ k: 'print', value, newline: true }) as const;
const bin = (op: any, a: any, b: any, trunc?: boolean): any => ({ k: 'bin', op, a, b, ...(trunc ? { trunc } : {}) });

/** Programs that check number formats, rounding and integer division in every language. */
const NUMBER_PROGRAMS: { id: string; program: Program }[] = [
  {
    id: 'zahlen',
    program: {
      functions: [],
      main: [
        { k: 'set', name: 'a', value: n(-7) },
        { k: 'set', name: 'b', value: n(2) },
        pr(bin('IDIV', { k: 'var', name: 'a' }, { k: 'var', name: 'b' })),
        pr(bin('MOD', { k: 'var', name: 'a' }, { k: 'var', name: 'b' })),
        pr(bin('IDIV', { k: 'var', name: 'a' }, { k: 'var', name: 'b' }, true)),
        pr(bin('MOD', { k: 'var', name: 'a' }, { k: 'var', name: 'b' }, true)),
        pr(bin('DIV', n(7), n(2))),
        { k: 'set', name: 'x', value: bin('DIV', n(6), n(2)) },
        pr({ k: 'var', name: 'x' }),
        pr({ k: 'join', parts: [{ k: 'str', v: 'x = ' }, { k: 'var', name: 'x' }] }),
        pr(bin('ADD', n(0.1, true), n(0.2, true))),
        pr(bin('DIV', n(1), n(3))),
        pr(bin('POW', n(2), n(10))),
        pr({ k: 'math', fn: 'round', a: n(3.7, true) }),
        pr({ k: 'list', items: [n(1), n(2), n(3)] }),
        pr({ k: 'join', parts: [{ k: 'str', v: 'Liste: ' }, { k: 'list', items: [n(1.5, true), n(2, true)] }] }),
        pr(bin('MOD', n(10), n(3))),
        pr({ k: 'bool', v: true }),
      ],
    },
  },
];

describe('generated code runs with the real toolchain', () => {
  for (const ex of [...EXAMPLES.filter((e) => e.id !== 'zahlenraten'), ...NUMBER_PROGRAMS.map((p) => ({ ...p, input: [] as string[] }))]) {
    for (const [lang, runner] of Object.entries(RUNNERS) as [Lang, NonNullable<(typeof RUNNERS)[Lang]>][]) {
      // Python's turtle needs a window (tkinter); the drawing is checked in the other languages
      const draws = JSON.stringify(ex.program).includes('"lib":"draw"');
      it.skipIf(!runner.available || (draws && lang === 'python'))(`${ex.id} / ${lang}`, async () => {
        const input = (ex.input ?? []).join('\n') + '\n';
        const expected = await runToText(ex.program, lang, ex.input);
        const actual = runner.run(generate(ex.program, lang).code, input);
        expect(normalize(actual)).toBe(normalize(expected));
      });
    }
  }
});

describe('code from one language keeps its meaning in the others', () => {
  // Java rounds integer division toward zero; translated code must do the same.
  const java = `public class Main {
    public static void main(String[] args) {
        int a = -7;
        System.out.println(a / 2);
        System.out.println(a % 2);
        System.out.println(17 / 5 + " " + 17 % 5);
    }
}
`;
  const program = parse(java, 'java').program;
  for (const [lang, runner] of Object.entries(RUNNERS) as [Lang, NonNullable<(typeof RUNNERS)[Lang]>][]) {
    it.skipIf(!runner.available)(`Java -> ${lang}`, () => {
      expect(normalize(runner.run(generate(program, lang).code, ''))).toBe('-3\n-1\n3 2');
    });
  }
});

describe('new constructs run the same with the real toolchains', () => {
  const src = parse(require('node:fs').readFileSync(require('node:path').join(__dirname, 'samples/neu.py'), 'utf8'), 'python').program;
  // error messages are worded differently in every language
  const strip = (t: string) => normalize(t).split('\n').filter((l) => !l.startsWith('Fehler:')).join('\n');
  for (const [lang, runner] of Object.entries(RUNNERS) as [Lang, NonNullable<(typeof RUNNERS)[Lang]>][]) {
    it.skipIf(!runner.available)(lang, async () => {
      const expected = await runToText(src, lang);
      const actual = runner.run(generate(src, lang).code, '');
      expect(strip(actual)).toBe(strip(expected));
      expect(actual).toContain('Fehler:');
    });
  }
});

describe('hand-written classes run in every language', () => {
  const HUNDE = 'Bello ist 2 Jahre alt\nLuna ist 0 Jahre alt\nBello ist älter';
  const TIERE = 'Etwas sagt ...\nBello sagt Wuff\nTweety sagt Piep\nTweety fliegt davon\nBeine zusammen: 10';
  const dir = join(__dirname, 'samples');
  const files: [string, string][] = [
    ...['klassen.py', 'Klassen.java', 'Tiere.cs', 'klassen.cpp', 'klassen.js'].map((f): [string, string] => [f, HUNDE]),
    // inheritance: every animal says its own sound, also in a list of the base class
    ...['vererbung.py', 'Vererbung.java', 'Vererbung.cs', 'vererbung.cpp', 'vererbung.js'].map((f): [string, string] => [f, TIERE]),
    // abstract methods: every shape computes its own area
    ['abstrakt.py', 'Rechteck: 6\nQuadrat: 16'],
  ];
  for (const [file, expected] of files) {
    const program = parse(readFileSync(join(dir, file), 'utf8'), langFromFileName(file)!).program;
    for (const [lang, runner] of Object.entries(RUNNERS) as [Lang, NonNullable<(typeof RUNNERS)[Lang]>][]) {
      it.skipIf(!runner.available)(`${file} -> ${lang}`, () => {
        expect(normalize(runner.run(generate(program, lang).code, ''))).toBe(expected);
      });
    }
  }
});

describe('exercise solutions run with the real toolchains', () => {
  for (const task of TASKS) {
    for (const [lang, runner] of Object.entries(RUNNERS) as [Lang, NonNullable<(typeof RUNNERS)[Lang]>][]) {
      it.skipIf(!runner.available)(`${task.id} / ${lang}`, () => {
        const code = generate(task.solution, lang).code;
        for (const c of task.cases) {
          const out = runner.run(code, (c.input ?? []).join('\n') + '\n');
          // the prompts of "frage ..." are printed as well
          let text = normalize(out);
          walkAllExprs(task.solution.main ?? [], (e) => {
            if (e.k === 'ask' && e.prompt?.k === 'str') text = text.split(e.prompt.v).join('');
          });
          const lines = text.split('\n');
          const expected = c.output.split('\n');
          if (c.anyOrder) expect([...lines].sort()).toEqual([...expected].sort());
          else expect(lines).toEqual(expected);
        }
      });
    }
  }
});

describe('print with several values prints the same everywhere', () => {
  const program = parse('a = 3\nb = 2.5\nname = "Ada"\nprint(a, b, name)\nprint("Summe:", a + b, end="")\nprint()\nprint(7 // 2, a > 1)\n', 'python').program;
  for (const [lang, runner] of Object.entries(RUNNERS) as [Lang, NonNullable<(typeof RUNNERS)[Lang]>][]) {
    it.skipIf(!runner.available)(lang, async () => {
      const expected = await runToText(program, lang);
      expect(normalize(runner.run(generate(program, lang).code, ''))).toBe(normalize(expected));
    });
  }
});

describe('numbers with decimals are formatted and rounded like each language does', () => {
  const program = parse(
    [
      'preis = 3.5',
      'n = 1',
      'print(f"Preis: {preis:.2f} Euro")',
      'print(f"{preis:.{n}f}")',
      'print(f"{2.5:.0f} {0.125:.2f} {2.675:.2f} {-1.5:.0f} {1234.5678:.1f} {7:.3f}")',
      'print(round(2.346, 2), round(1.005, 2), round(2.5, 0), round(-0.125, 2))',
      'print("{} kostet {:.1f}".format("Brot", preis))',
      'print("%.3f" % (1 / 3))',
    ].join('\n') + '\n',
    'python',
  ).program;
  for (const [lang, runner] of Object.entries(RUNNERS) as [Lang, NonNullable<(typeof RUNNERS)[Lang]>][]) {
    it.skipIf(!runner.available)(lang, async () => {
      const expected = await runToText(program, lang);
      expect(normalize(runner.run(generate(program, lang).code, ''))).toBe(normalize(expected));
    });
  }
});

describe('text, list and dictionary functions give the same results in every language', () => {
  const program = parse(
    [
      'text = "Banane"',
      'zahlen = [5, 3, 8, 3]',
      'print(text.count("an"), zahlen.count(3))',
      'print("123".isdigit(), "12a".isdigit(), "".isdigit())',
      'print(ord("A"), chr(66))',
      's = sorted(zahlen)',
      'print(s)',
      'print(zahlen)',
      'zahlen.remove(3)',
      'print(zahlen)',
      'letzte = zahlen.pop()',
      'print(letzte)',
      'zahlen.pop()',
      'print(len(zahlen), zahlen[0])',
      'nullen = [0] * 4',
      'print(len(nullen), nullen[3])',
      'noten = {"Mathe": 2}',
      'print(noten.get("Mathe", 0), noten.get("Kunst", 6))',
      'print(round(2.346, 2), f"{3.14159:.3f}")',
    ].join('\n') + '\n',
    'python',
  ).program;
  it('is read without code blocks', () => {
    expect(JSON.stringify(program)).not.toContain('"raw"');
    expect(JSON.stringify(program)).not.toContain('"ext:');
  });
  for (const [lang, runner] of Object.entries(RUNNERS) as [Lang, NonNullable<(typeof RUNNERS)[Lang]>][]) {
    it.skipIf(!runner.available)(lang, async () => {
      const expected = await runToText(program, lang);
      expect(normalize(runner.run(generate(program, lang).code, ''))).toBe(normalize(expected));
    });
  }
});

describe('a Java interface becomes an abstract base class in every language', () => {
  const program = parse(readFileSync(join(__dirname, 'samples', 'Schnittstelle.java'), 'utf8'), 'java').program;
  for (const [lang, runner] of Object.entries(RUNNERS) as [Lang, NonNullable<(typeof RUNNERS)[Lang]>][]) {
    it.skipIf(!runner.available)(lang, async () => {
      const expected = await runToText(program, lang);
      expect(normalize(runner.run(generate(program, lang).code, ''))).toBe(normalize(expected));
    });
  }
});
