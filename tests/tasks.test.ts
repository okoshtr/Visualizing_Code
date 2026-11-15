// Every exercise is solvable, and the check notices wrong or missing solutions.
import { describe, expect, it } from 'vitest';
import { LANGS, TASKS, checkTask, fromBlockly, generate, parse, toBlockly } from '../src/core';

describe('exercises (Aufgaben)', () => {
  for (const task of TASKS) {
    it(`${task.id}: the reference solution passes`, async () => {
      expect(await checkTask(task, task.solution)).toEqual({ ok: true, messages: [] });
    });
    it(`${task.id}: an empty program fails`, async () => {
      const res = await checkTask(task, { main: [], functions: [] });
      expect(res.ok).toBe(false);
    });
    it(`${task.id}: the solution passes after blocks and every language`, async () => {
      const back = fromBlockly(JSON.parse(JSON.stringify(toBlockly(task.solution)))).program;
      expect((await checkTask(task, back)).ok).toBe(true);
      for (const lang of LANGS) {
        const again = parse(generate(task.solution, lang).code, lang).program;
        expect((await checkTask(task, again, lang)).messages).toEqual([]);
      }
    });
  }

  it('printing the result without the asked loop is not enough', async () => {
    const task = TASKS.find((t) => t.id === 'summe')!;
    const res = await checkTask(task, { main: [{ k: 'print', value: { k: 'num', v: 5050 }, newline: true }], functions: [] });
    expect(res.ok).toBe(false);
    expect(res.messages.join()).toMatch(/Schleife/);
  });

  it('wrong output is explained', async () => {
    const task = TASKS.find((t) => t.id === 'hallo')!;
    const res = await checkTask(task, { main: [{ k: 'print', value: { k: 'str', v: 'Hallo Welt' }, newline: true }], functions: [] });
    expect(res.messages[0]).toContain('Erwartet:\nHallo, Welt!\nBekommen:\nHallo Welt');
  });

  it('an endless loop is stopped', async () => {
    const task = TASKS.find((t) => t.id === 'hallo')!;
    const res = await checkTask(task, { main: [{ k: 'while', until: false, cond: { k: 'bool', v: true }, body: [] }], functions: [] });
    expect(res.messages.join()).toMatch(/Endlosschleife/);
  });
});
