// Real extension-host check: opens chart documents in VS Code and reads back the
// diagnostics the extension publishes. Run with: node tests/vscode-integration.mjs
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runTests } from "@vscode/test-electron";

const root = path.resolve(import.meta.dirname, "..");
const workspace = mkdtempSync(path.join(tmpdir(), "maimai-vscode-it-"));
writeFileSync(
  path.join(workspace, "broken.simai"),
  "&bpm=120\n&inote_4=\n1,2,\n&inote_7=\n1,Q,\n",
);
writeFileSync(
  path.join(workspace, "valid.simai"),
  "&bpm=120\n&inote_4=\n1,2,\n&inote_7=\n1,2,\n",
);
writeFileSync(path.join(workspace, "broken.ma2"), "RESOLUTION 384\nBPM_DEF 120\nNMTAP 0 0\n");

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, "tests", "vscode-suite", "index.mjs"),
    launchArgs: [workspace, "--disable-extensions", "--disable-gpu"],
  });
  console.log("VS Code integration checks passed.");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
