import assert from "node:assert/strict";
import * as vscode from "vscode";

const DIAGNOSTIC_SOURCE = "maimai Chart Preview";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function open(document) {
  await vscode.window.showTextDocument(document, { preview: false });
  // The diagnostics service debounces by 300ms.
  await sleep(900);
}

function problemsFor(uri) {
  return vscode.languages
    .getDiagnostics(uri)
    .filter((diagnostic) => diagnostic.source === DIAGNOSTIC_SOURCE);
}

export async function run() {
  const failures = [];
  const check = async (name, body) => {
    try {
      await body();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      console.log(`not ok - ${name}: ${error.message}`);
    }
  };

  const simai = vscode.workspace.openTextDocument(vscode.Uri.file(`${vscode.workspace.workspaceFolders[0].uri.fsPath}/broken.simai`));
  const valid = vscode.workspace.openTextDocument(vscode.Uri.file(`${vscode.workspace.workspaceFolders[0].uri.fsPath}/valid.simai`));
  const ma2 = vscode.workspace.openTextDocument(vscode.Uri.file(`${vscode.workspace.workspaceFolders[0].uri.fsPath}/broken.ma2`));

  await check("Simai errors are reported without opening a preview", async () => {
    const document = await simai;
    await open(document);
    const problems = problemsFor(document.uri);
    assert.equal(problems.length, 1, `expected one problem, got ${JSON.stringify(problems.map((p) => p.message))}`);
    assert.equal(problems[0].range.start.line, 4, "reports the offending line");
    assert.match(problems[0].message, /谱面 7/, "names the difficulty that failed");
  });

  await check("a valid chart produces no problems", async () => {
    const document = await valid;
    await open(document);
    assert.deepEqual(problemsFor(document.uri), []);
  });

  await check("MA2 errors are reported", async () => {
    const document = await ma2;
    await open(document);
    const problems = problemsFor(document.uri);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].range.start.line, 2);
  });

  await check("completion stays silent inside a chart body", async () => {
    const document = await valid;
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const line = document.lineAt(2).text.length;
    const list = await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      document.uri,
      new vscode.Position(2, line),
    );
    const labels = (list?.items ?? []).map((entry) => entry.label);
    // The command also returns VS Code's own word-based suggestions; only the chart extension's
    // metadata keys and note templates must be absent from a body position.
    const ours = labels.filter(
      (label) => typeof label === "string" && (label.startsWith("&") || /^(Tap|Break|Hold|Slide|Wifi|Touch|BPM |分频|结束标记)/.test(label)),
    );
    assert.equal(ours.length, 0, `expected no chart completions in the body, got ${JSON.stringify(ours.slice(0, 8))}`);
    assert.ok(editor);
  });

  if (failures.length > 0) throw new Error(failures.join("\n"));
}
