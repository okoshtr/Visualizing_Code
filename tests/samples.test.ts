// Hand-written programs (tests/samples) are turned into blocks without code blocks and still run.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generate, langFromFileName, parse, walkStmts, LANGS } from '../src/core';
import { runToText } from './helpers';

const dir = join(__dirname, 'samples');

const EXPECTED: Record<string, string> = {
  'sample.py': 'Zahlen: [2, 4, 8, 10]\nSumme ist = 24\nHallo Ada, willkommen!\n49\nHALLO WELT 10\nHallo tleW ollaH\ngefunden\nEnde bei -2\n4 3 3.5 1024\nTrue\n',
  'Main.java': '1: ADA\n2: LINUS\n0 1 2 \n3\n3.5\n42\nerster: Ada\nk=-2 d=7.0\n',
  'main.cpp': 'Summe: 43\n16 15 8 4 \nHallo Welt!\n5! = 120\n',
  'Program.cs': '3 ist ungerade\n6 ist gerade\n9 ist ungerade\n12 ist gerade\nAnzahl: 4\nBLÖCKE 6\n',
  'app.js': 'Fibonacci: 0, 1, 1, 2, 3, 5, 8, 13, 21, 34\nDie 10. Zahl ist 55\nKATZE\nRest 2\n9 3\n',
};

describe('hand-written samples', () => {
  for (const file of readdirSync(dir)) {
    const lang = langFromFileName(file)!;
    it(file, async () => {
      const res = parse(readFileSync(join(dir, file), 'utf8'), lang);
      expect(res.diagnostics).toEqual([]);
      const raws: string[] = [];
      walkStmts([...(res.program.main ?? []), ...res.program.functions.flatMap((f) => f.body)], (s) => {
        if (s.k === 'raw') raws.push(s.code);
      });
      expect(raws).toEqual([]);
      if (EXPECTED[file]) expect(await runToText(res.program, lang)).toBe(EXPECTED[file]);
      // every sample can be shown in every language
      for (const to of LANGS) expect(generate(res.program, to).code.length).toBeGreaterThan(10);
    });
  }
});
