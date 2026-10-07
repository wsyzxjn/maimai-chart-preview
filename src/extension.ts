/// <reference path="../types/vscode.d.ts" />
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { parseSimaiChart, parseMa2Chart, getAvailableDifficulties, readSimaiSections } from "@lxns-network/maimai-chart-engine";
import type { ChartDifficulty, ChartFileType } from "@lxns-network/maimai-chart-engine";
import { detectChartFormat } from "./parser/chartFormat";
import { registerChartLanguageDetection } from "./languageDetection";
import { buildSimaiSourceMap, buildMa2SourceMap, findBeatByLine, findLineByBeat, findSimaiDifficultyByLine, ChartLineMapEntry } from "./parser/sourceMap";
import type { HostToWebviewMessage, WebviewToHostMessage, WebviewAssetUris } from "./types/protocol";

let currentPanel: vscode.WebviewPanel | undefined = undefined;
let currentDocument: vscode.TextDocument | undefined = undefined;
let selectedDifficulty: number = 4;
let sourceMap: ChartLineMapEntry[] = [];
let debounceTimer: NodeJS.Timeout | undefined = undefined;
let lastPlaybackLine = -1;
let diagnostics: vscode.DiagnosticCollection | undefined;
let playbackDecoration: vscode.TextEditorDecorationType | undefined;
let isPlaying = false;
let followPlayback = true;
let extensionState: vscode.Memento | undefined;
let pendingReveal: { editor: vscode.TextEditor; line: number } | undefined;
let initialPlayback: { initialBeat: number; autoPlay: boolean } | undefined;

function setFollowPlayback(enabled: boolean) {
  if (followPlayback !== enabled) void extensionState?.update("followPlayback", enabled);
  followPlayback = enabled;
  pendingReveal = undefined;
  currentPanel?.webview.postMessage({ type: "followPlaybackState", enabled } satisfies HostToWebviewMessage);
}

function revealLine(editor: vscode.TextEditor, line: number) {
  if (editor.visibleRanges.some((range) => range.start.line <= line && range.end.line >= line)) return;
  pendingReveal = { editor, line };
  const position = new vscode.Position(line, 0);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function clearPlaybackHighlight() {
  lastPlaybackLine = -1;
  for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(playbackDecoration!, []);
}

export function activate(context: vscode.ExtensionContext) {
  extensionState = context.globalState;
  followPlayback = extensionState.get("followPlayback", true);
  diagnostics = vscode.languages.createDiagnosticCollection("maimai");
  context.subscriptions.push(diagnostics);
  playbackDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: "editor.wordHighlightBackground",
    isWholeLine: true,
  });
  context.subscriptions.push(playbackDecoration);
  // 注册打开预览命令
  const openPreview = (viewColumn: vscode.ViewColumn, playback?: { initialBeat: number; autoPlay: boolean }) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !getChartFormat(editor.document, true)) {
      vscode.window.showWarningMessage("请先打开 Simai 或 MA2 谱面（也支持自动识别包含谱面内容的 .txt 文件）。");
      return;
    }

    currentDocument = editor.document;

    if (currentPanel) {
      currentPanel.reveal(viewColumn);
      updateChartFromDocument(currentPanel, currentDocument, playback);
      return;
    }
    initialPlayback = playback;

    const panel = vscode.window.createWebviewPanel(
      "maimaiPreview",
      `maimai 预览: ${path.basename(currentDocument.fileName)}`,
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "media")),
          vscode.Uri.file(path.join(context.extensionPath, "dist")),
          vscode.Uri.file(path.join(context.extensionPath, "web")),
          ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? []),
          vscode.Uri.file(path.dirname(currentDocument.uri.fsPath)),
        ],
      }
    );

    currentPanel = panel;

    panel.onDidDispose(() => {
      if (currentDocument) diagnostics?.delete(currentDocument.uri);
      currentPanel = undefined;
      currentDocument = undefined;
      sourceMap = [];
      lastPlaybackLine = -1;
      isPlaying = false;
      pendingReveal = undefined;
      initialPlayback = undefined;
    });

    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);

    panel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => {
      switch (msg.type) {
        case "ready": {
          sendInitMessage(panel, context.extensionUri);
          setFollowPlayback(followPlayback);
          if (currentDocument) {
            updateChartFromDocument(panel, currentDocument, initialPlayback);
            initialPlayback = undefined;
          }
          break;
        }
        case "selectDifficulty": {
          if (!currentDocument || getChartFormat(currentDocument) !== "simai" || !Number.isSafeInteger(msg.difficulty) || msg.difficulty <= 0 || !getAvailableDifficulties(currentDocument.getText())[msg.difficulty]) break;
          selectedDifficulty = msg.difficulty;
          if (currentDocument) {
            updateChartFromDocument(panel, currentDocument);
            const editor = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === currentDocument?.uri.toString());
            if (editor && sourceMap.length) revealLine(editor, sourceMap[0].line);
          }
          break;
        }
        case "playbackState": {
          if (msg.documentUri === currentDocument?.uri.toString() && msg.difficulty === selectedDifficulty) isPlaying = msg.isPlaying;
          break;
        }
        case "setFollowPlayback": {
          setFollowPlayback(msg.enabled);
          const editor = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === currentDocument?.uri.toString());
          if (msg.enabled && editor && lastPlaybackLine >= 0) revealLine(editor, lastPlaybackLine);
          break;
        }
        case "cursorSync": {
          if (!currentDocument || msg.documentUri !== currentDocument.uri.toString() || msg.difficulty !== selectedDifficulty) break;
          const line = findLineByBeat(sourceMap, msg.currentBeat);
          const editor = vscode.window.visibleTextEditors.find(
            (candidate) => candidate.document.uri.toString() === currentDocument?.uri.toString(),
          );
          if (line === null || !editor) break;
          if (line === lastPlaybackLine) break;
          lastPlaybackLine = line;
          const position = new vscode.Position(line, 0);
          editor.setDecorations(playbackDecoration!, [new vscode.Range(position, position)]);
          if (followPlayback) revealLine(editor, line);
          break;
        }
        case "showError": {
          vscode.window.showErrorMessage(msg.message);
          break;
        }
      }
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("maimai.openPreview", () => {
      openPreview(vscode.ViewColumn.Active);
    }),
    vscode.commands.registerCommand("maimai.openPreviewToSide", () => {
      openPreview(vscode.ViewColumn.Beside);
    }),
    vscode.commands.registerCommand("maimai.playFromCursor", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !getChartFormat(editor.document, true)) return;
      const text = editor.document.getText();
      const line = editor.selection.active.line;
      const ma2 = getChartFormat(editor.document, true) === "ma2";
      const difficulty = ma2 ? 4 : findSimaiDifficultyByLine(text, line);
      const entries = ma2 ? buildMa2SourceMap(text) : difficulty === null ? [] : buildSimaiSourceMap(text, difficulty);
      const beat = findBeatByLine(entries, line);
      if (difficulty === null || beat === null) {
        vscode.window.showWarningMessage("请将光标放在谱面正文或 MA2 音符记录上，再从光标播放。");
        return;
      }
      selectedDifficulty = difficulty;
      openPreview(vscode.ViewColumn.Beside, { initialBeat: beat, autoPlay: true });
    })
  );

  // 监听文档修改并防抖更新
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (currentPanel && currentDocument && e.document.uri.toString() === currentDocument.uri.toString()) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (currentPanel && currentDocument) {
            updateChartFromDocument(currentPanel, currentDocument);
          }
        }, 200);
      }
    })
  );

  // 监听切换活动编辑器
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isChartDocument(editor.document)) {
        if (currentDocument?.uri.toString() === editor.document.uri.toString()) return;
        currentDocument = editor.document;
        if (currentPanel) {
          currentPanel.title = `maimai 预览: ${path.basename(currentDocument.fileName)}`;
          updateChartFromDocument(currentPanel, currentDocument);
        }
      }
    })
  );

  // 监听光标移动以定位小节
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const config = vscode.workspace.getConfiguration("maimai.preview");
      if (!currentPanel || !currentDocument) return;
      if (e.textEditor.document.uri.toString() !== currentDocument.uri.toString()) return;
      setFollowPlayback(false);
      if (isPlaying || !config.get("autoSyncCursor", true)) return;

      const cursorLine = e.selections[0].active.line;
      const targetBeat = findBeatByLine(sourceMap, cursorLine);
      if (targetBeat !== null) {
        currentPanel.webview.postMessage({
          type: "seekToBeat",
          beat: targetBeat,
          autoPlay: false,
          onlyWhenPaused: true,
        } as HostToWebviewMessage);
      }
    })
  );

  context.subscriptions.push(vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
    if (!isPlaying || !followPlayback || event.textEditor.document.uri.toString() !== currentDocument?.uri.toString()) return;
    const reveal = pendingReveal;
    pendingReveal = undefined;
    if (reveal?.editor === event.textEditor && event.visibleRanges.some((range) => range.start.line <= reveal.line && range.end.line >= reveal.line)) return;
    setFollowPlayback(false);
  }));
  registerChartLanguageDetection(context);
}

function isChartDocument(doc: vscode.TextDocument): boolean {
  return getChartFormat(doc) !== null;
}

function getChartFormat(doc: vscode.TextDocument, inspectContent = false): ChartFileType | null {
  const filename = path.basename(doc.fileName).toLowerCase();
  if (doc.languageId === "ma2" || filename.endsWith(".ma2")) return "ma2";
  if (doc.languageId === "simai" || filename.endsWith(".simai") || filename.endsWith(".maidata") || filename === "maidata.txt") return "simai";
  if (inspectContent && doc.languageId === "plaintext" && filename.endsWith(".txt")) return detectChartFormat(doc.getText(new vscode.Range(new vscode.Position(0, 0), doc.positionAt(65536))));
  return null;
}

function sendInitMessage(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
  const chartAssetsDir = vscode.Uri.joinPath(extensionUri, "media", "assets", "chart");
  const getAsset = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(chartAssetsDir, file)).toString();

  const assets: WebviewAssetUris = {
    sensorUrl: getAsset("sensor.webp"),
    answerSoundUrl: getAsset("answer.wav"),
    tapSoundUrl: getAsset("tap.wav"),
    touchSoundUrl: getAsset("touch.wav"),
    breakSoundUrl: getAsset("break.wav"),
    slideSoundUrl: getAsset("slide.wav"),
    cheerSoundUrl: getAsset("cheer.wav"),
    exSoundUrl: getAsset("ex.wav"),
    fireworkSoundUrl: getAsset("firework.wav"),
    breakSlideSoundUrl: getAsset("break_slide.wav"),
    breakSlideCheerSoundUrl: getAsset("break_slide_cheer.wav"),
    touchHoldSoundUrl: getAsset("touch_hold.wav"),
  };

  const config = vscode.workspace.getConfiguration("maimai.preview");
  const settings = {
    hiSpeed: config.get("defaultHiSpeed", 5.0),
    judgmentLineDesign: config.get("judgmentLineDesign", "sensor"),
    showFireworks: config.get("showFireworks", true),
    enableHitsound: config.get("enableHitsound", true),
    musicVolume: config.get("musicVolume", 1.0),
    seVolume: config.get("seVolume", 0.5),
    timingOffsetMs: config.get("timingOffsetMs", 0),
  };

  panel.webview.postMessage({
    type: "init",
    assets,
    settings,
  } as HostToWebviewMessage);
}

function updateChartFromDocument(panel: vscode.WebviewPanel, doc: vscode.TextDocument, playback?: { initialBeat: number; autoPlay: boolean }) {
  isPlaying = false;
  clearPlaybackHighlight();
  const rawText = doc.getText();
  const format = getChartFormat(doc, true);
  if (!format) return;
  const hasDifficultySections = format === "simai" && readSimaiSections(rawText).hasSectionDeclarations;
  const availableDifficulties = format === "ma2"
    ? [4]
    : Object.entries(getAvailableDifficulties(rawText))
      .filter(([, available]) => available)
      .map(([difficulty]) => Number(difficulty))
      .sort((a, b) => b - a);

  if (!availableDifficulties.includes(selectedDifficulty)) {
    selectedDifficulty = availableDifficulties[0] || 4;
  }

  // 尝试查找同目录下的音频文件 (如 track.mp3, bgm.mp3, music.mp3 等)
  let bgmUri: string | undefined = undefined;
  const docDir = path.dirname(doc.uri.fsPath);
  const possibleAudioFiles = ["track.mp3", "track.wav", "track.ogg", "bgm.mp3", "music.mp3", "audio.mp3"];
  for (const name of possibleAudioFiles) {
    const audioPath = path.join(docDir, name);
    if (fs.existsSync(audioPath)) {
      bgmUri = panel.webview.asWebviewUri(vscode.Uri.file(audioPath)).toString();
      break;
    }
  }

  try {
    const chart = format === "ma2"
      ? parseMa2Chart(rawText, selectedDifficulty as ChartDifficulty)
      : parseSimaiChart(rawText, selectedDifficulty);
    sourceMap = format === "ma2" ? buildMa2SourceMap(rawText) : buildSimaiSourceMap(rawText, selectedDifficulty);
    if (!chart.title) chart.title = path.basename(doc.fileName);
    diagnostics?.delete(doc.uri);

    panel.webview.postMessage({
      type: "chartUpdate",
      documentUri: doc.uri.toString(),
      chart,
      format,
      hasDifficultySections,
      rawText,
      availableDifficulties,
      selectedDifficulty,
      bgmUri,
      ...playback,
    } as HostToWebviewMessage);
  } catch (err: any) {
    sourceMap = [];
    const message = err.message || String(err);
    diagnostics?.set(doc.uri, [
      new vscode.Diagnostic(
        new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0),
        message,
        vscode.DiagnosticSeverity.Error,
      ),
    ]);
    panel.webview.postMessage({
      type: "chartUpdate",
      documentUri: doc.uri.toString(),
      chart: null,
      format,
      hasDifficultySections,
      rawText,
      error: message,
      availableDifficulties,
      selectedDifficulty,
      bgmUri,
    } as HostToWebviewMessage);
  }
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webviewApp.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "web", "styles", "app.css"));
  const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "codicons", "codicon.css"));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${codiconUri}">
  <link rel="stylesheet" href="${styleUri}">
  <title>maimai Chart Preview</title>
</head>
<body>
  <div id="app">
    <div class="header-bar">
      <div class="song-info">
        <span class="codicon codicon-music" style="font-size: 14px;"></span>
        <span class="song-title" id="songTitle">加载中...</span>
        <span class="song-meta" id="songMeta"></span>
      </div>
      <div class="header-controls">
        <button class="icon-action-btn follow-button${followPlayback ? " active" : ""}" id="followPlaybackBtn" title="${followPlayback ? "跟随播放：自动滚动到当前行" : "跟随已停止：点击恢复自动滚动"}" aria-label="${followPlayback ? "跟随播放已开启" : "跟随播放已停止"}" aria-pressed="${followPlayback}">
          <span class="codicon codicon-target"></span>
          <span id="followPlaybackLabel" class="follow-label">${followPlayback ? "跟随中" : "跟随关闭"}</span>
        </button>
        <select class="vscode-select" id="diffSelect" title="切换谱面难度">
          <option value="4">EXPERT</option>
        </select>
        <div class="speed-control" id="speedControl">
          <button class="text-action-btn speed-toggle" id="speedToggleBtn" type="button" aria-label="调整 Note 速度" aria-expanded="false" aria-controls="hiSpeedPanel">
            速度 <span id="hiSpeedLabel">5.0</span><span class="codicon codicon-chevron-down"></span>
          </button>
          <div class="speed-panel" id="hiSpeedPanel" role="group" aria-label="Note 速度">
            <label class="control-label" for="hiSpeedSlider">Note 速度</label>
            <input id="hiSpeedSlider" type="range" min="3" max="9" step="0.1" value="5" aria-label="Note 速度滑条" title="Note 下落速度，不改变音乐速度">
            <input id="hiSpeedValue" class="number-input" type="number" min="3" max="9" step="0.1" value="5.0" aria-label="Note 速度数值">
            <span class="speed-help">只改变 Note 下落速度</span>
          </div>
        </div>
      </div>
    </div>

    <div class="canvas-container">

      <div class="error-banner" id="errorBanner"></div>
      <canvas id="chartCanvas"></canvas>
    </div>

    <div class="footer-bar">
      <div class="timeline-row">
        <span class="time-display" id="timeDisplay" aria-label="当前时间与总时长">00:00 / 00:00</span>
        <div class="timeline-slider-wrap">
          <output class="timeline-preview" id="timelinePreview" hidden></output>
          <input type="range" id="timelineSlider" min="0" max="100" value="0" step="0.1" aria-label="播放位置" title="拖动以跳转到目标时间">
        </div>
      </div>
      <div class="controls-row">
        <div class="transport-controls">
          <button class="icon-action-btn" id="seekBackBtn" aria-label="后退一小节" title="后退 1 小节 (Shift + ←)">
            <span class="codicon codicon-arrow-left"></span>
          </button>
          <button class="icon-action-btn play-button" id="playBtn" aria-label="播放" title="播放 / 暂停 (Space)">
            <span class="codicon codicon-play" id="playIcon"></span>
          </button>
          <button class="icon-action-btn" id="seekForwardBtn" aria-label="前进一小节" title="前进 1 小节 (Shift + →)">
            <span class="codicon codicon-arrow-right"></span>
          </button>
        </div>
        <div class="audio-controls">
          <label class="volume-control" title="伴奏音乐音量">音乐<input id="musicVolume" aria-label="音乐音量" type="range" min="0" max="1" step="0.05" value="1"><output id="musicVolumeLabel" class="volume-value">100%</output></label>
          <div class="se-controls">
            <button class="icon-action-btn" id="soundToggleBtn" aria-label="静音 SE" aria-pressed="false" title="SE 开关 (按键 M)">
              <span class="codicon codicon-unmute" id="soundIcon"></span>
            </button>
            <label class="volume-control" title="所有 SE 音量（含正解音、判定音和持续音）">SE<input id="seVolume" aria-label="SE 音量" type="range" min="0" max="1" step="0.05" value="0.5"><output id="seVolumeLabel" class="volume-value">50%</output></label>
          </div>
        </div>
        <details class="settings-control" id="playbackSettings">
          <summary class="icon-action-btn" title="播放设置" aria-label="播放设置"><span class="codicon codicon-settings-gear"></span></summary>
          <div class="settings-panel" role="group" aria-label="播放设置">
            <div class="panel-heading"><span>播放设置</span><button class="icon-action-btn" id="settingsCloseBtn" type="button" aria-label="关闭播放设置"><span class="codicon codicon-close"></span></button></div>
            <label class="settings-field" for="timingOffset"><span>SE 时间偏移</span><span class="number-with-unit"><input id="timingOffset" class="number-input" type="number" aria-label="SE 时间偏移" min="-500" max="500" step="5" value="0"><span>ms</span></span></label>
            <p class="settings-help">正值延后，负值提前。</p>
          </div>
        </details>
      </div>
    </div>
  </div>

  <script src="${scriptUri}"></script>
</body>
</html>`;
}

export function deactivate() {
  if (debounceTimer) clearTimeout(debounceTimer);
  diagnostics?.dispose();
  diagnostics = undefined;
  playbackDecoration?.dispose();
  playbackDecoration = undefined;
}
