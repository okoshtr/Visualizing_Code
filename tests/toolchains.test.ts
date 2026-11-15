// Compiles and runs the generated code with the real toolchains (if installed)
// and compares the output with the built-in runner.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, generate, langFromFileName, parse, type Lang, type Program } from '../src/core';
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

function exec(cmd: string, args: string[], input: string, env: Record<string, string> = {}): string {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', env: { ...process.env, JAVA_TOOL_OPTIONS: '', ...env } });
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
  const dir = join(__dirname, 'samples');
  for (const file of ['klassen.py', 'Klassen.java', 'Tiere.cs', 'klassen.cpp', 'klassen.js']) {
    const program = parse(readFileSync(join(dir, file), 'utf8'), langFromFileName(file)!).program;
    for (const [lang, runner] of Object.entries(RUNNERS) as [Lang, NonNullable<(typeof RUNNERS)[Lang]>][]) {
      it.skipIf(!runner.available)(`${file} -> ${lang}`, () => {
        expect(normalize(runner.run(generate(program, lang).code, ''))).toBe(HUNDE);
      });
    }
  }
});
