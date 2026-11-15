import { type Program, type Lang, runProgram } from '../src/core';

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
