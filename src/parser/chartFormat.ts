import type { ChartFileType } from "@lxns-network/maimai-chart-engine";

/** A bounded, multi-line signature check; unfinished chart bodies may still be identified. */
export function detectChartFormat(text: string): ChartFileType | null {
  const sample = text.slice(0, 65536).replace(/^\uFEFF/, "");
  if (/^\s*(?:```|~~~)/m.test(sample)) return null;
  const lines = sample.split(/\r?\n/).map((line) => line.trim());
  const positive = "(?:\\d+(?:\\.\\d+)?)";
  const resolution = lines.find((line) => /^RESOLUTION\s+\d+\s*$/i.test(line));
  const ma2Bpm = lines.find((line) => new RegExp(`^BPM_DEF\\s+${positive}(?:\\s+${positive})*\\s*$`, "i").test(line));
  const ma2Record = lines.some((line) => /^(?:(?:NM|BR|EX|BX|CN)(?:TAP|HLD|STR|TTP|THO|S[A-Z_]{2})|BPM|MET)\s+\d+\s+\d+\s+\S+/i.test(line));
  const ma2Version = lines.some((line) => /^VERSION\s+\d+(?:\.\d+)*(?:\s+\d+(?:\.\d+)*)*$/i.test(line));
  if (resolution && ma2Bpm && Number(resolution.split(/\s+/)[1]) > 0 && Number(ma2Bpm.split(/\s+/)[1]) > 0 && (ma2Record || ma2Version)) return "ma2";

  const inote = lines.some((line) => /^&inote_[1-9]\d*\s*=/i.test(line));
  const bpm = lines.some((line) => /^&bpm=\d+(?:\.\d+)?$/i.test(line) && Number(line.slice(5)) > 0);
  const inlineBpm = lines.some((line) => /^(?:&inote_[1-9]\d*\s*=)?\s*\(\d+(?:\.\d+)?\)/i.test(line));
  const divisor = lines.some((line) => /\{\d+(?:\.\d+)?\}/.test(line) && !line.startsWith("&"));
  const noteSequence = lines.some((line) => /^(?:&inote_[1-9]\d*\s*=)?(?:\(\d+(?:\.\d+)?\)|\{\d+(?:\.\d+)?\})*\s*(?:[1-8]|[ABCDE][1-8]?)[^\s]*,/i.test(line));
  if ((inote && (bpm || inlineBpm || noteSequence)) || (bpm && divisor && noteSequence)) return "simai";
  return null;
}
