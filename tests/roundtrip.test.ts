import { describe, expect, it } from 'vitest';
import { EXAMPLES, LANGS, fromBlockly, generate, parse, toBlockly, walkStmts, type Program } from '../src/core';
import { allStmts, runToText } from './helpers';

function raws(p: Program): string[] {
  const out: string[] = [];
  walkStmts(allStmts(p), (s) => {
    if (s.k === 'raw') out.push(s.code);
  });
  return out;
}

const deterministic = EXAMPLES.filter((e) => e.id !== 'zahlenraten');

describe('code -> blocks -> code is stable', () => {
  for (const ex of EXAMPLES) {
    for (const lang of LANGS) {
      it(`${ex.id} / ${lang}`, () => {
        const code = generate(ex.program, lang).code;
        const parsed = parse(code, lang);
        expect(parsed.diagnostics).toEqual([]);
        expect(raws(parsed.program)).toEqual([]);
        expect(generate(parsed.program, lang).code).toBe(code);
      });
    }
  }
});

describe('blocks (Blockly JSON) round trip', () => {
  for (const ex of EXAMPLES) {
    it(ex.id, () => {
      const ws = toBlockly(ex.program);
      const back = fromBlockly(JSON.parse(JSON.stringify(ws))).program;
      for (const lang of LANGS) expect(generate(back, lang).code).toBe(generate(ex.program, lang).code);
    });
  }
});

describe('translating between languages keeps the meaning', () => {
  for (const ex of deterministic) {
    for (const from of LANGS) {
      it(`${ex.id} from ${from}`, async () => {
        const expected = await runToText(ex.program, 'javascript', ex.input);
        const parsed = parse(generate(ex.program, from).code, from).program;
        for (const to of LANGS) {
          const again = parse(generate(parsed, to).code, to).program;
          expect(raws(again)).toEqual([]);
          expect(await runToText(again, 'javascript', ex.input)).toBe(expected);
        }
      });
    }
  }
});

describe('formatting survives code -> blocks -> code', () => {
  const samples: Record<string, string> = {
    python: '# Start\nx = 1  # erste Zahl\n\ny = 2\nif x < y:\n    print("kleiner")  # Ausgabe\n\n    print("ende")\n',
    javascript: 'let x = 1; // erste Zahl\n\nlet y = 2;\nif (x < y) {\n  console.log("kleiner"); // Ausgabe\n}\n',
    java: 'public class Main {\n    public static void main(String[] args) {\n        int x = 1; // erste Zahl\n\n        int y = 2;\n        System.out.println(x + y);\n    }\n}\n',
  };
  for (const [lang, code] of Object.entries(samples)) {
    it(lang, () => {
      const program = parse(code, lang as any).program;
      expect(generate(program, lang as any).code).toBe(code);
      // also through the blocks
      const back = fromBlockly(JSON.parse(JSON.stringify(toBlockly(program)))).program;
      back.meta = program.meta;
      expect(generate(back, lang as any).code).toBe(code);
    });
  }
});

describe('new constructs (dictionaries, try, do-while, tuples) in all languages', () => {
  const src = parse(require('node:fs').readFileSync(require('node:path').join(__dirname, 'samples/neu.py'), 'utf8'), 'python').program;
  for (const lang of LANGS) {
    it(lang, () => {
      const code = generate(src, lang).code;
      const again = parse(code, lang);
      expect(again.diagnostics).toEqual([]);
      expect(raws(again.program)).toEqual([]);
      expect(generate(again.program, lang).code).toBe(code);
    });
  }
  it('through Blockly', () => {
    const back = fromBlockly(JSON.parse(JSON.stringify(toBlockly(src)))).program;
    back.meta = src.meta;
    for (const lang of LANGS) expect(generate(back, lang).code).toBe(generate(src, lang).code);
  });
});
