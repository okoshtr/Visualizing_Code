import { type Program, type Lang, type Stmt, runProgram } from '../src/core';

/** Runs a program with the built-in runner and returns the console output. */
export async function runToText(program: Program, lang: Lang, input: string[] = []): Promise<string> {
  let out = '';
  const queue = [...input];
  await runProgram(
    program,
    {
      write: (t) => (out += t),
      input: async (prompt) => {
        out += prompt;
        return queue.shift() ?? '';
      },
      shouldStop: () => false,
    },
    lang,
  );
  return out;
}

/** All statements of a program: main, functions, constructors and methods. */
export function allStmts(p: Program): Stmt[] {
  return [
    ...(p.main ?? []),
    ...p.functions.flatMap((f) => f.body),
    ...(p.classes ?? []).flatMap((c) => [...c.ctor, ...c.methods.flatMap((m) => m.body)]),
  ];
}
