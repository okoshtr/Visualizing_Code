// Runs inside a real VS Code (started by scripts/vscode-test.mjs).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, what, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await wait(200);
  }
  throw new Error(`Zeitüberschreitung: ${what}`);
}

function activeCustomTab() {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  return tab && tab.input instanceof vscode.TabInputCustom ? tab.input : null;
}

async function run() {
  const ext = vscode.extensions.getExtension('visualizing-code.visualizing-code');
  assert.ok(ext, 'Erweiterung gefunden');
  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;

  // 1. open a Python file as blocks
  const py = vscode.Uri.file(path.join(folder, 'hallo.py'));
  const original = fs.readFileSync(py.fsPath, 'utf8');
  await vscode.commands.executeCommand('vscode.openWith', py, 'visualizingCode.source');
  await waitFor(() => activeCustomTab()?.viewType === 'visualizingCode.source', 'Block-Ansicht der Python-Datei');
  assert.equal(ext.isActive, true, 'Erweiterung aktiv');
  const commands = await vscode.commands.getCommands(true);
  for (const c of ['visualizingCode.openAsBlocks', 'visualizingCode.convertToBlocksFile', 'visualizingCode.newProgram']) assert.ok(commands.includes(c), c);

  // 2. showing the blocks must not change the file (no edit on load)
  await wait(4000);
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === py.fsPath);
  if (doc) assert.equal(doc.isDirty, false, 'Datei unverändert nach dem Öffnen');
  assert.equal(fs.readFileSync(py.fsPath, 'utf8'), original);

  // 3. convert into a .blocks file, which opens in the block editor
  await vscode.commands.executeCommand('visualizingCode.convertToBlocksFile', py);
  const blocksFile = path.join(folder, 'hallo.blocks');
  await waitFor(() => fs.existsSync(blocksFile), 'hallo.blocks geschrieben');
  const saved = JSON.parse(fs.readFileSync(blocksFile, 'utf8'));
  assert.equal(saved.format, 'visualizing-code');
  assert.equal(saved.language, 'python');
  assert.ok(JSON.stringify(saved.blocks).includes('import_module'), 'Import-Block für "import pulp"');
  await waitFor(() => activeCustomTab()?.viewType === 'visualizingCode.blocks', 'Block-Editor für .blocks');

  // 4. a Java file opens as well
  const java = vscode.Uri.file(path.join(folder, 'Main.java'));
  await vscode.commands.executeCommand('visualizingCode.openAsBlocks', java);
  await waitFor(() => activeCustomTab()?.uri.fsPath === java.fsPath, 'Block-Ansicht der Java-Datei');

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  fs.rmSync(blocksFile, { force: true });
}

module.exports = { run };
