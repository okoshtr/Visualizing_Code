import { describe, expect, it } from 'vitest';
import { EXAMPLES, LANGS, fromBlockly, generate, parse, toBlockly, walkStmts, type Program } from '../src/core';
import { runToText } from './helpers';

function raws(p: Program): string[] {
  const out: string[] = [];
  walkStmts([...(p.main ?? []), ...p.functions.flatMap((f) => f.body)], (s) => {
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
