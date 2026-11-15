// Compiles and runs the generated code with the real toolchains (if installed)
// and compares the output with the built-in runner.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, generate, type Lang } from '../src/core';
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

function exec(cmd: string, args: string[], input: string): string {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', env: { ...process.env, JAVA_TOOL_OPTIONS: '' } });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
  return r.stdout;
}

const normalize = (s: string) => s.replace(/\r/g, '').trimEnd();

describe('generated code runs with the real toolchain', () => {
  for (const ex of EXAMPLES.filter((e) => e.id !== 'zahlenraten')) {
    for (const [lang, runner] of Object.entries(RUNNERS) as [Lang, NonNullable<(typeof RUNNERS)[Lang]>][]) {
      it.skipIf(!runner.available)(`${ex.id} / ${lang}`, async () => {
        const input = (ex.input ?? []).join('\n') + '\n';
        const expected = await runToText(ex.program, lang, ex.input);
        const actual = runner.run(generate(ex.program, lang).code, input);
        expect(normalize(actual)).toBe(normalize(expected));
      });
    }
  }
});
