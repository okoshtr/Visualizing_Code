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

describe('packages: imports, named values and package values', () => {
  const read = (f: string) => require('node:fs').readFileSync(require('node:path').join(__dirname, 'samples', f), 'utf8');

  it('Python with "import pulp" and "from pulp import ..." stays unchanged, also through the blocks', () => {
    const code = read('pakete.py');
    const program = parse(code, 'python').program;
    expect(raws(program)).toEqual([]);
    expect(generate(program, 'python').code).toBe(code);
    const back = fromBlockly(JSON.parse(JSON.stringify(toBlockly(program)))).program;
    expect(back.meta?.imports).toEqual(program.meta?.imports);
    back.meta = { ...program.meta, imports: back.meta?.imports };
    expect(generate(back, 'python').code).toBe(code);
  });

  it('other languages get the call with a note', () => {
    const program = parse(read('pakete.py'), 'python').program;
    const java = generate(program, 'java');
    expect(java.code).toContain('prob.add_variable("x", 0)');
    expect(java.warnings.join('\n')).toMatch(/Benannte Werte \(sense, lowBound, cat, msg\)/);
    expect(java.warnings.join('\n')).toMatch(/Paket "pulp" gibt es nur in Python/);
    expect(generate(program, 'csharp').code).toContain('prob.add_variable("y", lowBound: 0, cat: "Integer")');
    expect(generate(program, 'vba').code).toContain('prob.add_variable("y", lowBound:=0, cat:="Integer")');
  });

  it('JavaScript: require, destructuring and ES imports', () => {
    const program = parse('import _ from "lodash";\nimport { join as verbinde } from "path";\nconsole.log(_.sum([1, 2]), verbinde("a", "b"));\n', 'javascript').program;
    expect(raws(program)).toEqual([]);
    const code = generate(program, 'javascript').code;
    expect(code).toContain('const _ = require("lodash");');
    expect(code).toContain('const { join: verbinde } = require("path");');
    expect(code).toContain('console.log(_.sum([1, 2]) + " " + verbinde("a", "b"));');
  });

  it('named arguments of own functions become positions (C#, VBA, Python)', async () => {
    const cs = parse('class Program\n{\n    static int Teile(int a, int b = 2)\n    {\n        return a / b;\n    }\n\n    static void Main()\n    {\n        Console.WriteLine(Teile(b: 5, a: 20));\n    }\n}\n', 'csharp').program;
    expect(await runToText(cs, 'csharp')).toBe('4\n');
    const vba = parse('Function Teile(a As Long, Optional b As Long = 2) As Long\n    Teile = a \\ b\nEnd Function\n\nSub Main()\n    Debug.Print Teile(b:=5, a:=20)\n    Debug.Print Teile(a:=9)\nEnd Sub\n', 'vba').program;
    expect(await runToText(vba, 'vba')).toBe('4\n4\n');
    const py = parse('def teile(a, b=2):\n    return a // b\n\nprint(teile(b=5, a=20))\n', 'python').program;
    expect(generate(py, 'java').code).toContain('teile(20, 5)');
  });

  it('VBA keeps named arguments of other procedures', () => {
    const code = 'Sub Main()\n    MsgBox Prompt:="Hallo", Title:="Gruß"\nEnd Sub\n';
    expect(generate(parse(code, 'vba').program, 'vba').code).toBe(`Option Explicit\n\n${code}`);
  });

  it('classes of a package are not mistaken for variables (C#)', () => {
    const program = parse('using Newtonsoft.Json;\n\nclass Program\n{\n    static void Main()\n    {\n        string text = JsonConvert.SerializeObject(42, formatting: Formatting.Indented);\n    }\n}\n', 'csharp').program;
    expect(generate(program, 'csharp').code).not.toContain('JsonConvert = ');
    expect(generate(program, 'csharp').code).toContain('JsonConvert.SerializeObject(42, formatting: Formatting.Indented)');
  });
});
