import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test, after } from "node:test";
import esbuild from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(tmpdir(), "maimai-diagnostics-test-"));
const require = createRequire(import.meta.url);
await esbuild.build({
  entryPoints: [path.join(root, "src/parser/chartDiagnostics.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(temporary, "diagnostics.cjs"),
});
after(() => rmSync(temporary, { recursive: true, force: true }));
const { collectChartProblems } = require(path.join(temporary, "diagnostics.cjs"));

test("accepts every shipped fixture and the multi-difficulty sample", () => {
  assert.deepEqual(collectChartProblems(readFileSync(path.join(root, "tests/fixtures/multi-difficulty.simai"), "utf8"), "simai"), []);
  for (const file of ["notes.ma2", "slides.ma2", "meta.ma2"]) {
    assert.deepEqual(collectChartProblems(readFileSync(path.join(root, "tests/fixtures/ma2", file), "utf8"), "ma2"), [], file);
  }
});

test("reports Simai errors in every difficulty, not just the previewed one", () => {
  const problems = collectChartProblems("&bpm=120\n&inote_4=\n1,2,\n&inote_7=\n1,Q,", "simai");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 4);
  assert.equal(problems[0].difficulty, 7);
});

test("keeps valid difficulties silent while a sibling section is broken", () => {
  const problems = collectChartProblems("&bpm=120\n&inote_4=\n1,2,3,4,\n&inote_5=\n9,", "simai");
  assert.equal(problems.length, 1);
  assert.equal(problems[0].difficulty, 5);
});

test("a section missing BPM marks its declaration instead of the first note", () => {
  const problems = collectChartProblems("&title=Test\n&inote_4=\n1,2,\n\n&inote_7=\n1,8,", "simai");
  assert.deepEqual(
    problems.map((problem) => [problem.difficulty, problem.line, problem.column, problem.length, problem.message]),
    [
      [4, 1, 0, 9, "缺少有效 BPM"],
      [7, 4, 0, 9, "缺少有效 BPM"],
    ],
  );
});

test("collects every note problem in one difficulty instead of stopping at the first", () => {
  const problems = collectChartProblems("&bpm=120\n&inote_5=\n1,xx,sd,2,\n", "simai");
  assert.deepEqual(
    problems.map((problem) => [problem.line, problem.column, problem.length, problem.message]),
    [
      [2, 2, 2, "无法识别的 Note：xx"],
      [2, 5, 2, "无法识别的 Note：sd"],
    ],
  );
});

test("still collects note problems for a section that has no BPM", () => {
  const problems = collectChartProblems("&title=Test\n&inote_7=\n1-9[4:1],sd,\n", "simai");
  assert.deepEqual(
    problems.map((problem) => [problem.line, problem.column, problem.length, problem.message]),
    [
      [1, 0, 9, "缺少有效 BPM"],
      [2, 0, 8, "Slide 路径无效：1-9[4:1]"],
      [2, 9, 2, "无法识别的 Note：sd"],
    ],
  );
});

test("collects every malformed MA2 record", () => {
  const problems = collectChartProblems("RESOLUTION 384\nBPM_DEF 120\nNMTAP 0 0\nNMHLD 1 0\n", "ma2");
  assert.deepEqual(problems.map((problem) => problem.line), [2, 3]);
});

test("a section-level failure is reported once, not per difficulty", () => {
  const problems = collectChartProblems("&bpm=120\n&inote_4=\n1,2,\n&inote_4=\n1,2,", "simai");
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /重复声明/);
});

test("locates metadata and note errors on their source line", () => {
  const [bpm] = collectChartProblems("&bpm=0\n&inote_4=\n1,2,", "simai");
  assert.equal(bpm.line, 0);
  assert.match(bpm.message, /BPM/);

  const [note] = collectChartProblems("&bpm=120\n&inote_4=\n1,\nQ,", "simai");
  assert.equal(note.line, 3);
  assert.equal(note.column, 0);
});

test("MA2 problems carry the offending record line", () => {
  const [problem] = collectChartProblems("RESOLUTION 384\nBPM_DEF 120\nNMTAP 0 0\n", "ma2");
  assert.equal(problem.line, 2);
});
