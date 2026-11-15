// Browser check of the built web app (npm run build && npm run test:ui).
// Uses the Playwright/Chromium installation that is available on the machine.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const port = 8097;
const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForTimeout(1200);

  // run "Hallo Welt" with an answer in the console
  await page.click('#vc-run');
  await page.waitForSelector('.vc-input:not([hidden])');
  await page.fill('#vc-answer', 'Ada');
  await page.press('#vc-answer', 'Enter');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('.vc-out'), /Schön, dich kennenzulernen, Ada!/);

  // switching the language translates the program
  for (const [lang, snippet] of [['java', 'System.out.println("Hallo Welt!");'], ['csharp', 'Console.WriteLine("Hallo Welt!");'], ['vba', 'Debug.Print "Hallo Welt!"']]) {
    await page.click(`.vc-lang[data-lang="${lang}"]`);
    await page.waitForTimeout(250);
    assert.ok((await page.textContent('.cm-content')).includes(snippet), `${lang} code`);
  }

  // edit code -> blocks
  await page.click('.vc-lang[data-lang="python"]');
  await page.waitForTimeout(250);
  await page.click('.cm-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nfor i in range(3):\n    print(i * i)\n');
  assert.ok(await page.isVisible('.vc-pending'));
  await page.click('#vc-apply');
  await page.waitForTimeout(500);
  const loops = await page.evaluate(() => window.vcEditor.ws.getAllBlocks(false).filter((b) => b.type === 'controls_for').length);
  assert.equal(loops, 1, 'for loop block created');

  // every sample file goes through the real Blockly editor without losing anything
  const dir = new URL('../tests/samples/', import.meta.url);
  for (const file of readdirSync(dir)) {
    const code = readFileSync(new URL(file, dir), 'utf8');
    const result = await page.evaluate(([c, f]) => {
      const lang = window.vcCore.langFromFileName(f);
      window.vcEditor.loadCode(c, lang, false, false);
      const expected = window.vcCore.generate(window.vcCore.parse(c, lang).program, lang).code;
      const disabled = window.vcEditor.ws.getAllBlocks(false).filter((b) => !b.isEnabled()).map((b) => b.type);
      return { same: window.vcEditor.generatedCode === expected, disabled, actual: window.vcEditor.generatedCode, expected };
    }, [code, file]);
    assert.deepEqual(result.disabled, [], `${file}: ausgegraute Blöcke`);
    assert.ok(result.same, `${file}: Code nach dem Weg über die Blöcke verändert\n--- erwartet\n${result.expected}\n--- bekommen\n${result.actual}`);
  }

  assert.deepEqual(errors, []);
  console.log('UI-Check erfolgreich');
} finally {
  await browser.close();
  server.kill();
}
