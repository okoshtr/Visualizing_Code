// Starts a real VS Code with the extension and runs tests/vscode/suite.cjs.
// Needs network access to download VS Code; on Linux without display use xvfb-run.
import { fileURLToPath } from 'node:url';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTests } from '@vscode/test-electron';

const root = fileURLToPath(new URL('..', import.meta.url));
// work on a copy so the test can write files
const workspace = mkdtempSync(join(tmpdir(), 'vc-vscode-'));
cpSync(join(root, 'tests/vscode/workspace'), workspace, { recursive: true });

try {
  await runTests({
    extensionDevelopmentPath: join(root, 'extension'),
    extensionTestsPath: join(root, 'tests/vscode/suite.cjs'),
    launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
  });
  console.log('VS-Code-Test erfolgreich');
} catch (err) {
  console.error('VS-Code-Test fehlgeschlagen:', err);
  process.exit(1);
}
