import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fromBlockly } from '../core/blockly';
import { generate } from '../core/generators';
import { LANGS, LANG_INFO, langFromFileName, type Lang } from '../core/ir';
import { parse } from '../core/parsers';
import { toBlockly } from '../core/blockly';

const NEW_DOC = (lang: Lang) =>
  JSON.stringify({ format: 'visualizing-code', version: 1, language: lang, blocks: toBlockly({ main: [], functions: [] }), meta: {} }, null, 2) + '\n';

class BlockEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(
    private ctx: vscode.ExtensionContext,
    private mode: 'project' | 'source',
  ) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const dist = vscode.Uri.joinPath(this.ctx.extensionUri, 'dist');
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    panel.webview.html = this.html(panel.webview, dist);
    let lastText = document.getText();
    const lang: Lang = this.mode === 'source' ? (langFromFileName(document.fileName) ?? 'python') : this.projectLanguage(document);

    const sub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString() || !e.contentChanges.length) return;
      const text = document.getText();
      if (text === lastText) return;
      lastText = text;
      panel.webview.postMessage({ type: 'update', text });
    });
    panel.onDidDispose(() => sub.dispose());

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          panel.webview.postMessage({
            type: 'init',
            mode: this.mode,
            lang,
            text: document.getText(),
            fileName: path.basename(document.fileName),
            mediaUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'media')).toString() + '/',
          });
          break;
        case 'edit': {
          if (msg.text === document.getText()) return;
          lastText = msg.text;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), msg.text);
          await vscode.workspace.applyEdit(edit);
          break;
        }
        case 'runInTerminal':
          await runInTerminal(msg.code, msg.lang, this.mode === 'source' ? document : undefined);
          break;
        case 'export':
          await exportCode(msg.doc, document);
          break;
      }
    });
  }

  private projectLanguage(document: vscode.TextDocument): Lang {
    try {
      const l = JSON.parse(document.getText()).language;
      if (LANGS.includes(l)) return l;
    } catch {
      /* new or invalid file */
    }
    return vscode.workspace.getConfiguration('visualizingCode').get<Lang>('defaultLanguage') ?? 'python';
  }

  private html(webview: vscode.Webview, dist: vscode.Uri): string {
    const nonce = Array.from({ length: 32 }, () => Math.random().toString(36)[2]).join('');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}">
<style>html, body { padding: 0; } .vc-app { --font-ui: var(--vscode-font-family, "Segoe UI", system-ui, sans-serif); --font-code: var(--vscode-editor-font-family, Consolas, monospace); }</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function terminal(): vscode.Terminal {
  return vscode.window.terminals.find((t) => t.name === 'Visualizing Code') ?? vscode.window.createTerminal('Visualizing Code');
}

const q = (p: string) => `"${p}"`;

async function runInTerminal(code: string, lang: Lang, document?: vscode.TextDocument) {
  if (lang === 'vba') {
    vscode.window.showInformationMessage('VBA-Code läuft in Excel, Word oder Access: öffne dort den VBA-Editor (Alt+F11), füge den Code in ein Modul ein und starte "Main" mit F5. In der Konsole des Block-Editors kannst du das Programm direkt testen.');
    return;
  }
  let file: string;
  if (document && !document.isUntitled) {
    await document.save();
    file = document.fileName;
  } else {
    const dir = path.join(os.tmpdir(), 'visualizing-code', lang);
    fs.mkdirSync(dir, { recursive: true });
    const name = lang === 'java' ? 'Main.java' : lang === 'csharp' ? 'Program.cs' : `programm.${LANG_INFO[lang].ext}`;
    file = path.join(dir, name);
    fs.writeFileSync(file, code, 'utf8');
  }
  const win = process.platform === 'win32';
  const t = terminal();
  t.show();
  const dir = path.dirname(file);
  switch (lang) {
    case 'python':
      t.sendText(`${win ? 'python' : 'python3'} ${q(file)}`);
      break;
    case 'javascript':
      t.sendText(`node ${q(file)}`);
      break;
    case 'java':
      t.sendText(`java ${q(file)}`);
      break;
    case 'cpp': {
      const exe = path.join(dir, win ? 'programm.exe' : 'programm');
      t.sendText(`g++ -std=c++17 ${q(file)} -o ${q(exe)} && ${q(exe)}`);
      break;
    }
    case 'csharp': {
      const proj = path.join(os.tmpdir(), 'visualizing-code', 'csharp-run');
      fs.mkdirSync(proj, { recursive: true });
      fs.writeFileSync(path.join(proj, 'Program.cs'), document ? document.getText() : code, 'utf8');
      fs.writeFileSync(
        path.join(proj, 'run.csproj'),
        '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><Nullable>disable</Nullable><ImplicitUsings>disable</ImplicitUsings></PropertyGroup></Project>',
      );
      t.sendText(`dotnet run --project ${q(proj)}`);
      break;
    }
  }
}

async function exportCode(doc: any, source: vscode.TextDocument) {
  const pick = await vscode.window.showQuickPick(
    LANGS.map((l) => ({ label: LANG_INFO[l].label, lang: l })),
    { placeHolder: 'In welcher Sprache soll der Code gespeichert werden?' },
  );
  if (!pick) return;
  const { program } = fromBlockly(doc.blocks);
  program.meta = doc.meta ?? {};
  const base = path.basename(source.fileName).replace(/\.[^.]+$/, '');
  const className = pick.lang === 'java' || pick.lang === 'csharp' ? toClassName(base) : undefined;
  const res = generate(program, pick.lang, { className });
  const fileName = (className ?? base) + '.' + LANG_INFO[pick.lang].ext;
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(path.dirname(source.fileName), fileName)),
    filters: { [LANG_INFO[pick.lang].label]: LANG_INFO[pick.lang].extensions },
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(res.code, 'utf8'));
  await vscode.window.showTextDocument(target);
  if (res.warnings.length) vscode.window.showWarningMessage(res.warnings.join(' '));
}

function toClassName(base: string): string {
  const s = base.replace(/[^\p{L}\p{N}_]/gu, '');
  return /^\p{L}/u.test(s) ? s[0].toUpperCase() + s.slice(1) : 'Main';
}

export function activate(ctx: vscode.ExtensionContext) {
  const opts = { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false };
  ctx.subscriptions.push(
    vscode.window.registerCustomEditorProvider('visualizingCode.blocks', new BlockEditorProvider(ctx, 'project'), opts),
    vscode.window.registerCustomEditorProvider('visualizingCode.source', new BlockEditorProvider(ctx, 'source'), opts),

    vscode.commands.registerCommand('visualizingCode.openAsBlocks', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) return vscode.window.showWarningMessage('Öffne zuerst eine Code-Datei.');
      if (!langFromFileName(target.fsPath)) return vscode.window.showWarningMessage('Diese Dateiart wird nicht unterstützt (Python, Java, JavaScript, C#, C++, VBA).');
      await vscode.commands.executeCommand('vscode.openWith', target, 'visualizingCode.source', vscode.ViewColumn.Beside);
    }),

    vscode.commands.registerCommand('visualizingCode.convertToBlocksFile', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      const lang = target && langFromFileName(target.fsPath);
      if (!target || !lang) return vscode.window.showWarningMessage('Öffne zuerst eine Code-Datei (Python, Java, JavaScript, C#, C++ oder VBA).');
      const text = Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8');
      const res = parse(text, lang);
      const doc = { format: 'visualizing-code', version: 1, language: lang, blocks: toBlockly(res.program), meta: res.program.meta ?? {} };
      const out = vscode.Uri.file(target.fsPath.replace(/\.[^.]+$/, '') + '.blocks');
      await vscode.workspace.fs.writeFile(out, Buffer.from(JSON.stringify(doc, null, 2) + '\n', 'utf8'));
      await vscode.commands.executeCommand('vscode.openWith', out, 'visualizingCode.blocks');
      if (res.diagnostics.length) vscode.window.showWarningMessage(res.diagnostics.map((d) => (d.line ? `Zeile ${d.line}: ` : '') + d.message).join(' '));
    }),

    vscode.commands.registerCommand('visualizingCode.newProgram', async () => {
      const pick = await vscode.window.showQuickPick(
        LANGS.map((l) => ({ label: LANG_INFO[l].label, lang: l })),
        { placeHolder: 'In welcher Sprache soll der Code angezeigt werden? (Kann später gewechselt werden.)' },
      );
      if (!pick) return;
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const target = await vscode.window.showSaveDialog({
        defaultUri: folder ? vscode.Uri.joinPath(folder, 'programm.blocks') : undefined,
        filters: { 'Visualizing Code': ['blocks'] },
      });
      if (!target) return;
      await vscode.workspace.fs.writeFile(target, Buffer.from(NEW_DOC(pick.lang), 'utf8'));
      await vscode.commands.executeCommand('vscode.openWith', target, 'visualizingCode.blocks');
    }),
  );
}

export function deactivate() {}
