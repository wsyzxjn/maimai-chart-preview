import type { ChartFileType } from "@lxns-network/maimai-chart-engine";
import { getAvailableDifficulties, parseMa2Chart, parseSimaiChart, readSimaiSections } from "@lxns-network/maimai-chart-engine";

export interface ChartProblem {
  message: string;
  /** 0-based line, when the engine could attribute the failure to one. */
  line?: number;
  /** 0-based character offset inside `line`, when known. */
  column?: number;
  /** How many characters the problem covers; defaults to 1. */
  length?: number;
  /** Simai difficulty the problem belongs to, when the document has sections. */
  difficulty?: number;
}

/** Engine message for a section that never establishes a valid BPM. */
const MISSING_BPM = /缺少有效 BPM/;

/** One parse reports one failure; re-parse with the offending token blanked to collect the rest. */
const MAX_SCAN_PASSES = 24;

/** Engine errors carry a source location; anything else is treated as a document-level problem. */
function toProblem(error: unknown, difficulty?: number): ChartProblem {
  if (error instanceof Error) {
    const located = error as Error & { line?: number; column?: number; length?: number };
    if (Number.isInteger(located.line) && located.line! >= 0) {
      return {
        // The engine prefixes line-level failures with "第 N 行："; the diagnostic carries the
        // position itself, so drop the duplicate prefix.
        message: error.message.replace(/^第 \d+ 行：/, ""),
        line: located.line,
        column: Number.isInteger(located.column) ? Math.max(0, located.column!) : 0,
        length: Number.isInteger(located.length) && located.length! > 0 ? located.length! : 1,
        difficulty,
      };
    }
    return { message: error.message, difficulty };
  }
  return { message: String(error), difficulty };
}

/**
 * The engine reports a section-wide "no valid BPM" failure at the first note it cannot time.
 * That note is not the mistake, so move the problem to the `&inote_n=` declaration and drop
 * the engine's stale line prefix instead of squiggling a valid character.
 */
function relocateMissingBpm(lines: string[], problem: ChartProblem, declarationLine: number | undefined): void {
  if (declarationLine === undefined || problem.line === undefined || problem.line <= declarationLine) return;
  const raw = lines[declarationLine] ?? "";
  problem.line = declarationLine;
  problem.column = Math.max(0, raw.search(/\S/));
  problem.length = Math.max(1, raw.trim().length);
  problem.message = problem.message.replace(/^谱面(?=缺少有效 BPM)/, "");
}

/** Blank a range on one line, keeping its length so every other position stays valid. */
function blankLineRange(lines: string[], line: number, start: number, end: number): boolean {
  const text = lines[line];
  if (text === undefined) return false;
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  if (to === from) return false;
  lines[line] = `${text.slice(0, from)}${" ".repeat(to - from)}${text.slice(to)}`;
  return true;
}

/**
 * Blank the comma-separated token around a failure so the next failure can surface.
 * `protectUntil` keeps a synthetic BPM prefix on that line from being blanked away.
 */
function blankToken(lines: string[], line: number, column: number, length: number, protectUntil = 0): boolean {
  const text = lines[line];
  if (text === undefined) return false;
  const start = Math.max(protectUntil, text.lastIndexOf(",", Math.max(0, column - 1)) + 1);
  const following = text.indexOf(",", column + length);
  const end = Math.max(column + length, following === -1 ? text.length : following);
  return blankLineRange(lines, line, start, end);
}

/**
 * Parses one difficulty repeatedly, blanking the token that failed each time, so a section with
 * several mistakes reports all of them instead of only the first one the engine throws.
 */
function collectSimaiDifficultyProblems(
  text: string,
  source: ReturnType<typeof readSimaiSections>,
  difficulty: number | undefined,
): ChartProblem[] {
  const section = difficulty === undefined ? undefined : source.sections.find((entry) => entry.id === difficulty);
  // `section.body` includes the `&inote_n=` declaration line itself; only lines below it can be
  // blanked or carry a synthetic BPM without destroying the section.
  const bodyLines = (section?.body ?? source.body)
    .map((bodyLine) => bodyLine.line)
    .filter((line) => line !== section?.line);
  const bodyLineSet = new Set(bodyLines);
  const lines = text.split(/\r?\n/);
  const problems: ChartProblem[] = [];
  const seen = new Set<string>();
  let injectedLine: number | undefined;
  let bpmReported = false;
  let lastPosition = -1;

  for (let pass = 0; pass < MAX_SCAN_PASSES; pass++) {
    try {
      if (difficulty === undefined) parseSimaiChart(lines.join("\n"));
      else parseSimaiChart(lines.join("\n"), difficulty);
      break;
    } catch (error) {
      const problem = toProblem(error, difficulty);
      if (problem.line === undefined || !bodyLineSet.has(problem.line)) {
        // Metadata, declaration, comment, and document-level failures are structural: report
        // them and stop, because blanking them would derail the rest of the parse.
        problems.push(problem);
        break;
      }

      if (MISSING_BPM.test(problem.message)) {
        if (bpmReported) break;
        bpmReported = true;
        relocateMissingBpm(lines, problem, section?.line);
        problems.push(problem);
        // Keep scanning with a synthetic BPM so note-level mistakes still surface.
        const firstBodyLine = Math.min(...bodyLines);
        if (!Number.isFinite(firstBodyLine) || lines[firstBodyLine] === undefined) break;
        lines[firstBodyLine] = `(120)${lines[firstBodyLine]}`;
        injectedLine = firstBodyLine;
        continue;
      }

      const column = problem.column ?? 0;
      const position = problem.line * 100000 + column;
      const key = `${problem.message}@${problem.line}:${column}`;
      if (seen.has(key) || position <= lastPosition) {
        problems.push(problem);
        break;
      }
      seen.add(key);
      lastPosition = position;
      problems.push(problem);
      const protectUntil = problem.line === injectedLine ? "(120)".length : 0;
      if (!blankToken(lines, problem.line, column, problem.length ?? 1, protectUntil)) break;
    }
  }

  if (injectedLine !== undefined) {
    const prefixLength = "(120)".length;
    for (const problem of problems) {
      if (problem.line === injectedLine) {
        problem.column = Math.max(0, (problem.column ?? 0) - prefixLength);
      }
    }
  }
  return problems;
}

/** MA2 records are line based, so blanking the offending record line lets the next one surface. */
function collectMa2Problems(text: string): ChartProblem[] {
  const lines = text.split(/\r?\n/);
  const problems: ChartProblem[] = [];
  const seen = new Set<string>();
  for (let pass = 0; pass < MAX_SCAN_PASSES; pass++) {
    try {
      parseMa2Chart(lines.join("\n"), 4);
      break;
    } catch (error) {
      const problem = toProblem(error);
      if (problem.line === undefined) {
        problems.push(problem);
        break;
      }
      const key = `${problem.message}@${problem.line}:${problem.column ?? 0}`;
      if (seen.has(key)) {
        problems.push(problem);
        break;
      }
      seen.add(key);
      problems.push(problem);
      if (!blankLineRange(lines, problem.line, 0, (lines[problem.line] ?? "").length)) break;
    }
  }
  return problems;
}

/**
 * Validates every difficulty in the document, not only the one being previewed, so
 * typos in a secondary chart are reported while the user edits it.
 */
export function collectChartProblems(text: string, format: ChartFileType): ChartProblem[] {
  if (format === "ma2") {
    return collectMa2Problems(text);
  }

  const source = readSimaiSections(text);
  if (source.error) {
    // readSimaiSections reports declaration problems through side fields, not on an Error object.
    return [{
      message: source.error,
      line: source.errorLine,
      column: source.errorColumn ?? 0,
      length: 1,
    }];
  }

  const difficulties = Object.keys(getAvailableDifficulties(text))
    .map(Number)
    .sort((a, b) => a - b);
  if (difficulties.length === 0) {
    // A Simai file without any playable body still deserves the engine's own verdict.
    return collectSimaiDifficultyProblems(text, source, undefined);
  }

  const problems: ChartProblem[] = [];
  for (const difficulty of difficulties) {
    for (const problem of collectSimaiDifficultyProblems(text, source, difficulty)) {
      // The same section-level failure is reported once per difficulty; keep the first.
      if (problems.some((existing) => existing.line === problem.line && existing.message === problem.message)) continue;
      problems.push(problem);
    }
  }
  return problems;
}
