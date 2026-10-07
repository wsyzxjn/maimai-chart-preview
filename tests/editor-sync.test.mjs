import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
import esbuild from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(tmpdir(), "maimai-editor-test-"));
const require = createRequire(import.meta.url);
await esbuild.build({
  entryPoints: [path.join(root, "src/extension.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: path.join(temporary, "host.cjs"),
});

test("playback follows with decorations without seeking, and editor focus preserves playback", async () => {
  let onSelection, onActiveEditor, onVisibleRanges, receive, disposePanel;
  const savedState = new Map([["followPlayback", false]]);
  const stateUpdates = [];
  const globalState = { get: (key, fallback) => savedState.has(key) ? savedState.get(key) : fallback, update: async (key, value) => { stateUpdates.push([key, value]); savedState.set(key, value); } };
  const commands = new Map();
  const reveals = [];
  let selectionWrites = 0;
  let cursorLine = 9;
  const messages = [];
  const decorations = [];
  const uri = (value) => ({ fsPath: value, toString: () => value });
  const document = { uri: uri("/tmp/maimai-sync-test.simai"), fileName: "/tmp/maimai-sync-test.simai", languageId: "simai", lineCount: 10, getText: () => "&bpm=120\n&inote_3=\n1,2,\n&inote_4=\n1,2,\n3,4,\n\n&lv_5=14\n&inote_5=\n5,6," };
  class Position { constructor(line, character) { this.line = line; this.character = character; } }
  class Selection { constructor(anchor, active) { this.anchor = anchor; this.active = active; } }
  class Range { constructor(...args) { this.args = args; } }
  const editor = {
    document,
    visibleRanges: [{start:{line:0},end:{line:0}}],
    get selection() { return new Selection(new Position(cursorLine,0), new Position(cursorLine,0)); },
    set selection(value) {
      selectionWrites++;
      // VS Code may deliver programmatic selection changes after a zero-delay guard expires.
      setTimeout(() => onSelection({ textEditor: editor, selections: [value], kind: 3 }), 5);
    },
    setDecorations: (_type, ranges) => decorations.push(ranges),
    revealRange(range) { reveals.push(range); onVisibleRanges?.({textEditor:editor,visibleRanges:[{start:{line:range.args[0].line},end:{line:range.args[0].line+1}}]}); },
  };
  const panel = { title: "", reveal() {}, onDidDispose(callback) { disposePanel = callback; }, webview: {
    html: "",
    asWebviewUri: (value) => value,
    postMessage: (message) => messages.push(message),
    onDidReceiveMessage: (callback) => { receive = callback; },
  } };
  const noop = () => ({ dispose() {} });
  const vscode = {
    Position, Selection, Range,
    Diagnostic:class { constructor(range,message,severity){this.range=range;this.message=message;this.severity=severity;} },
    DiagnosticSeverity:{Error:0},
    ViewColumn: { Active: 1, Beside: 2 },
    TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    languages: { createDiagnosticCollection: () => ({ ...noop(), delete() {}, set() {} }) },
    commands: { registerCommand: (id, callback) => { commands.set(id,callback); if (id === "maimai.openPreviewToSide") vscode.open = callback; return noop(); } },
    window: {
      activeTextEditor: editor,
      visibleTextEditors: [editor],
      createTextEditorDecorationType: noop,
      createWebviewPanel: () => panel,
      onDidChangeTextEditorVisibleRanges: (callback) => { onVisibleRanges = callback; return noop(); },
      onDidChangeActiveTextEditor: (callback) => { onActiveEditor = callback; return noop(); },
      onDidChangeTextEditorSelection: (callback) => { onSelection = callback; return noop(); },
    },
    workspace: { textDocuments: [], onDidOpenTextDocument: noop, onDidCloseTextDocument: noop, workspaceFolders: [], getConfiguration: () => ({ get: (_key, fallback) => fallback }), onDidChangeTextDocument: noop },
  };
  const original = Module._load;
  try {
    Module._load = function (id, ...args) { return id === "vscode" ? vscode : original.call(this, id, ...args); };
    const host = require(path.join(temporary, "host.cjs"));
    host.activate({ subscriptions: [], extensionPath: root, extensionUri: uri(root), globalState });
    vscode.open();
    receive({ type: "ready" });
    assert.equal(messages.findLast(m=>m.type==='followPlaybackState').enabled,false, "Preview restores the saved follow state");
    assert.match(panel.webview.html,/aria-pressed="false"/);
    receive({type:"setFollowPlayback",enabled:true});
    assert.equal(savedState.get("followPlayback"),true);
    messages.length = 0;
    const playback = {documentUri:document.uri.toString(), difficulty:4};
    receive({ type: "playbackState", isPlaying:true, ...playback });
    receive({ type: "cursorSync", currentBeat: 4.5, ...playback });
    receive({ type: "cursorSync", currentBeat: 6.5, ...playback });
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(messages.filter((message) => message.type === "seekToBeat").length, 0, "Playback-follow selection must never reset audio");
    assert.equal(selectionWrites, 0, "Keep the editor caret under user control");
    assert.ok(decorations.filter((ranges) => ranges.length).length === 2);
    onActiveEditor(editor);
    assert.equal(messages.filter((message) => message.type === "chartUpdate").length, 0, "Returning to the same editor must not reload the chart");
    const click = (line) => onSelection({textEditor:editor,selections:[new Selection(new Position(line,0),new Position(line,0))],kind:2});
    messages.length = 0;
    click(9);
    assert.equal(messages.filter(m=>m.type==='seekToBeat').length,0, "Clicking another difficulty while playing must not seek");
    assert.equal(messages.at(-1).enabled,false, "Browsing suspends scroll follow");
    const revealCount = reveals.length;
    receive({type:"cursorSync",currentBeat:7,...playback});
    assert.equal(reveals.length,revealCount);
    receive({type:"setFollowPlayback",enabled:true});
    assert.equal(messages.at(-1).enabled,true);
    onVisibleRanges({textEditor:editor,visibleRanges:[{start:{line:8},end:{line:10}}]});
    assert.equal(messages.at(-1).enabled,false, "Manual scrolling suspends follow");
    receive({type:"playbackState",isPlaying:false,...playback});
    messages.length = 0;
    for(const line of [0,2,3,6,7,8,9]) click(line);
    assert.equal(messages.filter(m=>m.type==='seekToBeat').length,0, "Metadata, blanks and other difficulties have no selected-chart position");
    click(5);
    assert.equal(messages.at(-1).type,"seekToBeat");
    assert.equal(messages.at(-1).beat,6);
    assert.equal(messages.at(-1).onlyWhenPaused,true);
    assert.equal(savedState.get("followPlayback"),false);
    receive({type:"selectDifficulty",difficulty:3});
    assert.equal(savedState.get("followPlayback"),false, "Difficulty changes preserve follow preference");
    assert.equal(messages.findLast(m=>m.type==='chartUpdate').selectedDifficulty,3);
    assert.equal(reveals.at(-1).args[0].line,2, "Selecting difficulty reveals its body");
    commands.get("maimai.playFromCursor")();
    const update = messages.findLast(m=>m.type==='chartUpdate');
    assert.equal(update.selectedDifficulty,5, "Explicit cursor playback selects its enclosing difficulty");
    assert.equal(update.initialBeat,4);
    assert.equal(update.autoPlay,true);
    assert.equal(savedState.get("followPlayback"),false, "Play from cursor does not override follow preference");
    disposePanel();
    host.deactivate();
    host.activate({subscriptions:[],extensionPath:root,extensionUri:uri(root),globalState});
    messages.length=0;
    vscode.open();
    receive({type:"ready"});
    assert.equal(messages.findLast(m=>m.type==='followPlaybackState').enabled,false, "Follow off survives reopening and reactivation");
    assert.ok(stateUpdates.length>0);
    document.getText=()=>"&bpm=120\n&lv_7=?\n&des_7=Seven\n&inote_7=2,\n3,\n&lv_10=EXTRA\n&des_10=Ten\n&inote_10={8}4,5,\n6,";
    document.lineCount=9;
    cursorLine=8;
    vscode.open();
    assert.deepEqual(messages.findLast(m=>m.type==='chartUpdate').availableDifficulties,[10,7]);
    assert.equal(messages.findLast(m=>m.type==='chartUpdate').hasDifficultySections,true);
    receive({type:"selectDifficulty",difficulty:7});
    assert.deepEqual(messages.findLast(m=>m.type==='chartUpdate').chart.notes.map(n=>n.position),[2,3]);
    commands.get("maimai.playFromCursor")();
    const customUpdate=messages.findLast(m=>m.type==='chartUpdate');
    assert.equal(customUpdate.selectedDifficulty,10);
    assert.equal(customUpdate.initialBeat,5);
    assert.deepEqual(customUpdate.chart.notes.map(n=>n.position),[4,5,6]);
    assert.equal(customUpdate.chart.designer,"Ten");
    document.getText=()=>"&bpm=120\n{4}1,2,";
    vscode.open();
    assert.equal(messages.findLast(m=>m.type==='chartUpdate').hasDifficultySections,false);
    document.getText=()=>"&bpm=120\n&inote_foo=1,2,";
    vscode.open();
    assert.match(messages.findLast(m=>m.type==='chartUpdate').error,/谱面段落声明/);
    assert.equal(messages.findLast(m=>m.type==='chartUpdate').chart,null);
    disposePanel();
    host.deactivate();
  } finally {
    Module._load = original;
    rmSync(temporary, { recursive: true, force: true });
  }
});
