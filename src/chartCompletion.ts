import * as vscode from "vscode";
import { readSimaiSections } from "@lxns-network/maimai-chart-engine";

const METADATA_KEYS = ["title", "artist", "des", "bpm", "first"] as const;

/** MA2 record commands with their field counts, matching the engine's Ma2Parser. */
const MA2_RECORDS: ReadonlyArray<{ command: string; fields: number; detail: string }> = [
  { command: "NMTAP", fields: 4, detail: "Tap：NMTAP <小节> <tick> <键位0-7>" },
  { command: "BRTAP", fields: 4, detail: "Break Tap：BRTAP <小节> <tick> <键位0-7>" },
  { command: "EXTAP", fields: 4, detail: "EX Tap：EXTAP <小节> <tick> <键位0-7>" },
  { command: "BXTAP", fields: 4, detail: "EX Break Tap：BXTAP <小节> <tick> <键位0-7>" },
  { command: "NMHLD", fields: 5, detail: "Hold：NMHLD <小节> <tick> <键位> <持续tick>" },
  { command: "NMTTP", fields: 6, detail: "Touch：NMTTP <小节> <tick> <区域> <键位>" },
  { command: "NMTHO", fields: 7, detail: "Touch Hold：NMTHO <小节> <tick> <键位> <持续tick> <区域> <起始>" },
  { command: "NMSI_", fields: 7, detail: "Slide 起点：NMSI_ <小节> <tick> <键位> <结束tick> <持续tick> <目标键位>" },
  { command: "NMSUL", fields: 7, detail: "Slide 上弧：NMSUL <小节> <tick> <键位> <结束tick> <持续tick> <目标键位>" },
  { command: "NMSUR", fields: 7, detail: "Slide 下弧：NMSUR <小节> <tick> <键位> <结束tick> <持续tick> <目标键位>" },
  { command: "NMSSL", fields: 7, detail: "Slide 左侧直滑：NMSSL <小节> <tick> <键位> <结束tick> <持续tick> <目标键位>" },
  { command: "NMSSR", fields: 7, detail: "Slide 右侧直滑：NMSSR <小节> <tick> <键位> <结束tick> <持续tick> <目标键位>" },
  { command: "NMSVP", fields: 7, detail: "Slide V 型：NMSVP <小节> <tick> <键位> <结束tick> <持续tick> <目标键位>" },
  { command: "NMSF_", fields: 7, detail: "Slide 圆弧：NMSF_ <小节> <tick> <键位> <结束tick> <持续tick> <目标键位>" },
  { command: "NMSWF", fields: 7, detail: "Slide 复合圆弧：NMSWF <小节> <tick> <键位> <结束tick> <持续tick> <目标键位>" },
  { command: "NMSLL", fields: 7, detail: "Slide 折线向左：NMSLL <小节> <tick> <键位> <结束tick> <持续tick> <目标键位>" },
  { command: "NMSLR", fields: 7, detail: "Slide 折线向右：NMSLR <小节> <tick> <键位> <结束tick> <持续tick> <目标键位>" },
  { command: "BPM", fields: 4, detail: "BPM 变化：BPM <小节> <tick> <bpm>" },
  { command: "MET", fields: 4, detail: "节拍数变化：MET <小节> <tick> <每小节拍数>" },
];

/** MA2 header declarations the engine reads. */
const MA2_HEADERS: ReadonlyArray<{ command: string; detail: string }> = [
  { command: "RESOLUTION", detail: "每小节 tick 数，必须是正整数" },
  { command: "BPM_DEF", detail: "默认 BPM，必须是有限正数" },
  { command: "TITLE", detail: "曲名" },
  { command: "ARTIST", detail: "艺术家" },
  { command: "DESIGNER", detail: "谱师" },
  { command: "CREATOR", detail: "制作者" },
  { command: "PLAYLEVEL", detail: "推荐等级" },
  { command: "VERSION", detail: "格式版本" },
];

function item(label: string, detail: string, insert: string, kind = vscode.CompletionItemKind.Snippet): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(label, kind);
  completion.detail = detail;
  completion.insertText = new vscode.SnippetString(insert);
  return completion;
}

/** Metadata lines start with "&"; "&inote_n=" lines declare chart sections instead. */
function isMetadataLine(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("&") && !/^\s*&inote/i.test(trimmed);
}

function simaiMetadataItems(typed: string): vscode.CompletionItem[] {
  // The replacement range starts at the "&", and VS Code derives the filter text from that
  // range. Labels must therefore keep the "&" prefix, or every candidate is filtered out.
  return METADATA_KEYS.filter((key) => key.startsWith(typed)).map((key) => {
    // No pre-filled value: the tab stop sits right after "=" so the value is typed directly.
    return item(`&${key}=`, `Simai 元数据 &${key}=`, `&${key}=$1`);
  });
}

function ma2Items(): vscode.CompletionItem[] {
  return [
    ...MA2_HEADERS.map((header) => item(header.command, header.detail, `${header.command} `)),
    ...MA2_RECORDS.map((record) => {
      // One tab stop per field keeps the engine's field-count contract visible while typing.
      const placeholders = Array.from({ length: record.fields - 1 }, (_, index) => `\${${index + 1}:0}`).join(" ");
      return item(record.command, record.detail, `${record.command} ${placeholders}`);
    }),
  ];
}

export function registerChartCompletion(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [{ language: "simai" }, { language: "ma2" }],
      {
        provideCompletionItems(document, position) {
          const line = document.lineAt(position.line).text;
          const inComment = /\/\/|\/\*/.test(line.slice(0, position.character));
          if (inComment) return undefined;

          if (document.languageId === "ma2") {
            // A record command is only meaningful before the bar/tick fields begin.
            const isCommandPosition = /^\s*[A-Za-z_]*$/.test(line.slice(0, position.character));
            if (!isCommandPosition) return undefined;
            const start = line.length - line.trimStart().length;
            const range = new vscode.Range(position.line, start, position.line, position.character);
            const suggestions = ma2Items();
            for (const completion of suggestions) completion.range = range;
            return suggestions;
          }

          const source = readSimaiSections(document.getText());
          const inSectionBody = source.sections.some((section) =>
            section.body.some((bodyLine) => bodyLine.line === position.line),
          );
          const inUnsctionedBody = !source.hasSectionDeclarations
            && source.body.some((bodyLine) => bodyLine.line === position.line);
          const isMetadataPosition = isMetadataLine(line) || (!inSectionBody && !inUnsctionedBody);

          if (isMetadataPosition) {
            // The range must cover the "&" too, otherwise the inserted "&key=" doubles it.
            const typed = line.slice(0, position.character).match(/&([A-Za-z]*)$/)?.[0] ?? "";
            const key = typed.slice(1);
            const suggestions = simaiMetadataItems(key);
            if (suggestions.length === 0) return undefined;
            for (const completion of suggestions) {
              completion.range = new vscode.Range(position.line, position.character - typed.length, position.line, position.character);
            }
            return suggestions;
          }
          // Chart bodies deliberately complete nothing: only metadata keys are offered.
          return undefined;
        },
      },
      // Each trigger must be a single-character string, otherwise it can never match.
      "&",
    ),
  );
}
