// Hand-written programs (tests/samples) are turned into blocks without code blocks and still run.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generate, langFromFileName, parse, walkStmts, LANGS } from '../src/core';
import { allStmts, runToText } from './helpers';

const dir = join(__dirname, 'samples');

const HUNDE = 'Bello ist 2 Jahre alt\nLuna ist 0 Jahre alt\nBello ist älter\n';

const TIERE = 'Etwas sagt ...\nBello sagt Wuff\nTweety sagt Piep\nTweety fliegt davon\nBeine zusammen: 10\n';

const EXPECTED: Record<string, string> = {
  'vererbung.py': TIERE,
  'abstrakt.py': 'Rechteck: 6\nQuadrat: 16\n',
  'Schnittstelle.java': 'Kreis: 3.0\nQuadrat: 4.0\n',
  'Vererbung.java': TIERE,
  'Vererbung.cs': TIERE,
  'vererbung.cpp': TIERE,
  'vererbung.js': TIERE,
  'sample.py': 'Zahlen: [2, 4, 8, 10]\nSumme ist = 24\nHallo Ada, willkommen!\n49\nHALLO WELT 10\nHallo tleW ollaH\ngefunden\nEnde bei -2\n4 3 3.5 1024\nTrue\n',
  'Main.java': '1: ADA\n2: LINUS\n0 1 2 \n3\n3.5\n42\nerster: Ada\nk=-2 d=7.0\n',
  'main.cpp': 'Summe: 43\n16 15 8 4 \nHallo Welt!\n5! = 120\n',
  'Program.cs': '3 ist ungerade\n6 ist gerade\n9 ist ungerade\n12 ist gerade\nAnzahl: 4\nBLÖCKE 6\n',
  'app.js': 'Fibonacci: 0, 1, 1, 2, 3, 5, 8, 13, 21, 34\nDie 10. Zahl ist 55\nKATZE\nRest 2\n9 3\n',
  'neu.py': 'Anna ist 12\nClara ist 11\nTrue 2\n0 3\n1 9\n2 4\n16 3 9\nFibonacci: 8\nFehler: "zwölf" ist keine ganze Zahl.\nZähler 3\nzwei oder drei\nHallo, Ada!\nMoin, Linus!\n',
  'Neu.java': 'Äpfel: 5\nn = 6\nKeine Zahl: "abc" ist keine ganze Zahl.\nMathe: sehr gut\nKunst: weiter üben\n',
  'neu.js': 'rot=1\nblau=2\ngrün=3\nWerktag\n4.5\nFehler: Division durch null\n',
  'neu.bas': 'i = 9\nperfekt\ngut\nüben\n',
  'klassen.py': HUNDE,
  'Klassen.java': HUNDE,
  'Tiere.cs': HUNDE,
  'klassen.cpp': HUNDE,
  'klassen.js': HUNDE,
};

describe('hand-written samples', () => {
  for (const file of readdirSync(dir)) {
    const lang = langFromFileName(file)!;
    it(file, async () => {
      const res = parse(readFileSync(join(dir, file), 'utf8'), lang);
      expect(res.diagnostics).toEqual([]);
      const raws: string[] = [];
      walkStmts(allStmts(res.program), (s) => {
        if (s.k === 'raw') raws.push(s.code);
      });
      expect(raws).toEqual([]);
      if (EXPECTED[file]) expect(await runToText(res.program, lang)).toBe(EXPECTED[file]);
      // every sample can be shown in every language
      for (const to of LANGS) expect(generate(res.program, to).code.length).toBeGreaterThan(10);
    });
  }
});
