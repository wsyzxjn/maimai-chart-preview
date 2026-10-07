import { readSimaiSections } from "@lxns-network/maimai-chart-engine";

export interface ChartLineMapEntry {
  line: number;      // 0-based
  beat: number;      // 谱面节拍 (包含 leadIn 偏移)
  measure: number;   // 1-based 小节
}

/**
 * 建立行号与 Beat / 小节的对应关系。
 * 光标在编辑器中移动时快速定位节拍；播放时反向高亮编辑器中的行。
 */
export function buildSimaiSourceMap(
  simaiText: string,
  targetDifficulty: number = 4,
  leadInBeats: number = 4
): ChartLineMapEntry[] {
  const source = readSimaiSections(simaiText);
  const entries: ChartLineMapEntry[] = [];
  if (source.error) return entries;
  const body = source.hasSectionDeclarations
    ? source.sections.find((section) => section.id === targetDifficulty)?.body ?? []
    : source.body;

  let currentBeat = 0;
  let currentDivisor = 4;

  for (const { line: lineIndex, text } of body) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    // 记录该行起始对应 beat
    entries.push({
      line: lineIndex,
      beat: currentBeat + leadInBeats,
      measure: Math.floor(currentBeat / 4) + 1,
    });

    let col = 0;
    while (col < trimmed.length) {
      const char = trimmed[col];
      if (char === "E" && /(?:^|,)\s*$/.test(trimmed.slice(0, col)) && /^(?:\s*,|\s*$)/.test(trimmed.slice(col + 1))) return entries;
      if (char === "{") {
        const divMatch = trimmed.slice(col).match(/^\{(\d+(?:\.\d+)?)\}/);
        if (divMatch) {
          currentDivisor = parseFloat(divMatch[1]);
          col += divMatch[0].length;
          continue;
        }
      }
      if (char === "(") {
        const bpmMatch = trimmed.slice(col).match(/^\((\d+(?:\.\d+)?)\)/);
        if (bpmMatch) {
          col += bpmMatch[0].length;
          continue;
        }
      }
      if (char === ",") {
        currentBeat += 4 / currentDivisor;
      }
      col++;
    }
  }

  return entries;
}

/** Returns the enclosing Simai difficulty; metadata outside an inote section has no difficulty. */
export function findSimaiDifficultyByLine(text: string, targetLine: number): number | null {
  const source = readSimaiSections(text);
  if (source.error) return null;
  if (!source.hasSectionDeclarations) {
    return source.body.some((line) => line.line === targetLine && line.text.trim() !== "") ? 4 : null;
  }
  return source.sections.find((section) => section.body.some((line) => line.line === targetLine && line.text.trim() !== ""))?.id ?? null;
}

/** MA2 records contain explicit bar/tick positions; headers have no playhead position. */
export function buildMa2SourceMap(ma2Text: string, leadInBeats: number = 4): ChartLineMapEntry[] {
  const lines = ma2Text.split(/\r?\n/);
  const resolutionLine = lines.find((line) => /^RESOLUTION\s+/i.test(line.trim()));
  const resolution = Number(resolutionLine?.trim().split(/\s+/)[1]);
  if (!Number.isFinite(resolution) || resolution <= 0) return [];

  const entries: ChartLineMapEntry[] = [];
  for (const [line, text] of lines.entries()) {
    const tokens = text.trim().split(/\s+/);
    const command = tokens[0].toUpperCase();
    if (!/^(?:BPM|MET|(?:NM|BR|EX|BX|CN)(?:TAP|HLD|STR|TTP|THO|SI_|SCR|SCL|SXR|SXL|SUL|SUR|SV_|SVP|SF_|SWF|SSL|SSR|SLL|SLR))$/.test(command)) continue;
    const bar = Number(tokens[1]);
    const tick = Number(tokens[2]);
    if (!Number.isInteger(bar) || bar < 0 || !Number.isInteger(tick) || tick < 0) continue;
    const chartBeat = (bar + tick / resolution) * 4;
    entries.push({ line, beat: chartBeat + leadInBeats, measure: Math.floor(chartBeat / 4) + 1 });
  }
  return entries;
}

export function findBeatByLine(entries: ChartLineMapEntry[], targetLine: number): number | null {
  return entries.find((entry) => entry.line === targetLine)?.beat ?? null;
}

export function findLineByBeat(entries: ChartLineMapEntry[], targetBeat: number): number | null {
  if (entries.length === 0) return null;
  let best: ChartLineMapEntry | null = null;
  for (const entry of entries) {
    if (entry.beat <= targetBeat && (!best || entry.beat >= best.beat)) {
      best = entry;
    }
  }
  return best ? best.line : entries.reduce((earliest, entry) => entry.beat < earliest.beat ? entry : earliest).line;
}
