import { analyze } from '../analysis';
import type { Lang, Program } from '../ir';
import type { GenOptions, GenResult } from './base';
import { CppGen } from './cpp';
import { CSharpGen } from './csharp';
import { JavaGen } from './java';
import { JavaScriptGen } from './javascript';
import { PythonGen } from './python';
import { VbaGen } from './vba';

export type { GenOptions, GenResult };

export function generate(program: Program, lang: Lang, opts: GenOptions = {}): GenResult {
  const a = analyze(program);
  switch (lang) {
    case 'python':
      return new PythonGen(a, opts).generate();
    case 'java':
      return new JavaGen(a, opts).generate();
    case 'javascript':
      return new JavaScriptGen(a, opts).generate();
    case 'csharp':
      return new CSharpGen(a, opts).generate();
    case 'cpp':
      return new CppGen(a, opts).generate();
    case 'vba':
      return new VbaGen(a, opts).generate();
  }
}
