import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { test, after } from "node:test";
import esbuild from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(tmpdir(), "maimai-completion-test-"));
const require = createRequire(import.meta.url);
await esbuild.build({
  entryPoints: [path.join(root, "src/chartCompletion.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: path.join(temporary, "completion.cjs"),
});
after(() => rmSync(temporary, { recursive: true, force: true }));

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(...args) { this.args = args; }
  get start() { return new Position(this.args[0], this.args[1]); }
}
class SnippetString {
  constructor(value) { this.value = value; }
}
class CompletionItem {
  constructor(label, kind) { this.label = label; this.kind = kind; }
}
const noop = { dispose() {} };
let registeredTriggers;
const vscode = {
  Position, Range, SnippetString, CompletionItem,
  CompletionItemKind: { Snippet: 14 },
  languages: {
    registerCompletionItemProvider: (_selector, provider, ...triggers) => {
      registered = provider;
      registeredTriggers = triggers;
      return noop;
    },
  },
};
let registered;
const original = Module._load;
Module._load = function (id, ...args) { return id === "vscode" ? vscode : original.call(this, id, ...args); };
const { registerChartCompletion } = require(path.join(temporary, "completion.cjs"));
registerChartCompletion({ subscriptions: [] });
Module._load = original;

test("registers only the single-character & trigger", () => {
  // A bare "&" would be passed as a single 2-character string and silently never fire.
  assert.ok(Array.isArray(registeredTriggers), "trigger characters must be an array");
  assert.deepEqual(registeredTriggers, ["&"]);
});

/** Minimal TextDocument stand-in covering only what the provider touches. */
function makeDocument(text, languageId) {
  const lines = text.split("\n");
  return {
    languageId,
    getText: () => text,
    lineAt: (line) => ({ text: lines[line] ?? "" }),
  };
}

function complete(document, line, character) {
  return registered.provideCompletionItems(document, new Position(line, character), {}, {}) ?? [];
}

test("offers Simai metadata keys above the first section", () => {
  const document = makeDocument("&title=Test\n\n&inote_4=\n1,2,", "simai");
  const labels = complete(document, 1, 0).map((entry) => entry.label);
  assert.ok(labels.includes("&title="));
  assert.ok(labels.includes("&bpm="));
  assert.ok(!labels.includes("Tap 1,"), "note templates are no longer offered");
});

test("metadata keys survive the already-typed & without being filtered out", () => {
  const document = makeDocument("&title=Test\n\n&inote_4=\n1,2,", "simai");
  // VS Code filters each candidate against the text its range replaces, so the label must
  // keep the same "&" prefix; otherwise the widget drops the item before it can be shown.
  const entries = complete(document, 1, 1);
  assert.deepEqual(entries.map((entry) => entry.label), ["&title=", "&artist=", "&des=", "&bpm=", "&first="]);
  for (const entry of entries) {
    const line = document.lineAt(1).text;
    const replaced = line.slice(entry.range.args[1], entry.range.args[3]);
    assert.ok(entry.label.startsWith(replaced), `label ${entry.label} must start with the replaced text ${JSON.stringify(replaced)}`);
    assert.equal(entry.insertText.value, `${entry.label}$1`, "insertion keeps the key but pre-fills no value");
  }
});

test("the replaced range swallows the typed & so it is not doubled", () => {
  const document = makeDocument("&title=Test\n&artist=Someone\n&inote_4=\n1,2,", "simai");
  for (const [column, text] of [[1, "&"], [4, "&art"]]) {
    const entry = complete(document, 1, column)[0];
    assert.deepEqual(entry.range.args, [1, column - text.length, 1, column], `range must include the & at column ${column}`);
  }
});

test("a partially typed key narrows the metadata candidates", () => {
  // Line 1 is a metadata line that still has room for more keys.
  const document = makeDocument("&title=Test\n&artist=Someone\n&inote_4=\n1,2,", "simai");
  assert.deepEqual(complete(document, 1, 1).map((entry) => entry.label), ["&title=", "&artist=", "&des=", "&bpm=", "&first="]);
  assert.deepEqual(complete(document, 1, 3).map((entry) => entry.label), ["&artist="], "only keys starting with the typed text survive");
  // "&artistx" cannot be completed to any known key.
  const unknown = makeDocument("&title=Test\n&artistx\n&inote_4=\n1,2,", "simai");
  assert.deepEqual(complete(unknown, 1, 8), [], "an unknown prefix must not fall back to every key");
});

test("a lone & inside a section body asks for metadata keys", () => {
  const document = makeDocument("&bpm=120\n&inote_4=\n1,2,\n&\n", "simai");
  assert.deepEqual(complete(document, 3, 1).map((entry) => entry.label), ["&title=", "&artist=", "&des=", "&bpm=", "&first="]);
});

test("chart bodies complete nothing", () => {
  assert.deepEqual(complete(makeDocument("&title=Test\n&inote_4=\n\n", "simai"), 2, 0), []);
  assert.deepEqual(complete(makeDocument("&bpm=120\n\n", "simai"), 1, 0), [], "unsectioned bodies stay silent too");
});

test("stays silent inside comments", () => {
  const document = makeDocument("&bpm=120\n&inote_4=\n// 1,2,\n", "simai");
  assert.deepEqual(complete(document, 2, 5), []);
});

test("offers MA2 commands only at the start of a line", () => {
  const document = makeDocument("RESOLUTION 384\nBPM_DEF 120\nNMTAP 0 0 0\n", "ma2");
  const labels = complete(document, 2, 3).map((entry) => entry.label);
  assert.ok(labels.includes("NMTAP"));
  assert.ok(labels.includes("NMHLD"));
  assert.ok(labels.includes("MET"));
  assert.deepEqual(complete(document, 2, 6), [], "record fields must not offer command completions");
  assert.deepEqual(complete(document, 2, 9), [], "mid-record positions must not offer commands");
});

test("MA2 record snippets carry one placeholder per engine-required field", () => {
  const document = makeDocument("RESOLUTION 384\nBPM_DEF 120\n\n", "ma2");
  const items = complete(document, 2, 0);
  const tap = items.find((entry) => entry.label === "NMTAP");
  const hold = items.find((entry) => entry.label === "NMHLD");
  const touchHold = items.find((entry) => entry.label === "NMTHO");
  // fields counts are command tokens plus bar, tick and the command specific values.
  assert.equal(tap.insertText.value.split("${").length - 1, 3);
  assert.equal(hold.insertText.value.split("${").length - 1, 4);
  assert.equal(touchHold.insertText.value.split("${").length - 1, 6);
});
