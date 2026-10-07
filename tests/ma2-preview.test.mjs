import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import esbuild from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(tmpdir(), "maimai-preview-test-"));
const require = createRequire(import.meta.url);
try {
  await esbuild.build({
    entryPoints: [path.join(root, "src/parser/sourceMap.ts")],
    bundle: true,
      platform: "node",
    format: "cjs",
    outfile: path.join(temporary, "sourceMap.cjs"),
  });
  await esbuild.build({
    stdin: { contents: 'export { parseSimaiChart, parseMa2Chart, getAvailableDifficulties } from "@lxns-network/maimai-chart-engine";', resolveDir: root, loader: "ts" },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(temporary, "parser.cjs"),
  });
  const { buildMa2SourceMap, buildSimaiSourceMap, findBeatByLine, findLineByBeat, findSimaiDifficultyByLine } = require(path.join(temporary, "sourceMap.cjs"));
  const { parseMa2Chart, parseSimaiChart } = require(path.join(temporary, "parser.cjs"));

  test("custom numeric Simai sections retain exact line and beat mapping", () => {
    const text = "&title=Custom\n&bpm=120\n&lv_7=?\n&des_7=Seven\n&inote_7=2,\n3,\n&lv_10=EXTRA\n&des_10=Ten\n  &inote_10 = {8}4,5,\n6,";
    const map7 = buildSimaiSourceMap(text, 7);
    const map10 = buildSimaiSourceMap(text, 10);
    assert.deepEqual(map7.map(({line,beat})=>[line,beat]), [[4,4],[5,5]]);
    assert.deepEqual(map10.map(({line,beat})=>[line,beat]), [[8,4],[9,5]]);
    assert.equal(findBeatByLine(map7,9),null);
    assert.equal(findSimaiDifficultyByLine(text,9),10);
    assert.equal(findSimaiDifficultyByLine(text,7),null);
    assert.deepEqual(parseSimaiChart(text,10).notes.map(n=>n.position),[4,5,6]);
    assert.equal(parseSimaiChart(text,10).designer,"Ten");
    assert.deepEqual(buildSimaiSourceMap("&bpm=120\n&inote_foo=1,",4),[]);
    assert.equal(findSimaiDifficultyByLine("&bpm=120\n&inote_foo=1,",2),null);
  });

  test("MA2 record positions agree with parsed notes, including unsorted records", () => {
    const text = ["RESOLUTION 384", "BPM_DEF 120", "# note records are deliberately unsorted", "NMTAP 2 192 3", "NMTAP 0 96 0", "NMTAP 1 0 1"].join("\r\n");
    const map = buildMa2SourceMap(text);
    const chart = parseMa2Chart(text, 4);
    assert.equal(map.length, 3);
    assert.deepEqual(map.map(({ beat }) => beat), [14, 5, 8]);
    assert.deepEqual(chart.notes.map((note) => note.timing).sort((a, b) => a - b), [5, 8, 14]);
    assert.equal(findBeatByLine(map, 3), 14);
    assert.equal(findBeatByLine(map, 4), 5);
    assert.equal(findLineByBeat(map, 0), 4);
    assert.equal(findLineByBeat(map, 5), 4);
    assert.equal(findLineByBeat(map, 10), 5);
    assert.equal(findLineByBeat(map, 15), 3);
  });

  test("MA2 timing, hold, touch and slide fixtures pass through the shared engine", () => {
    for (const file of ["meta.ma2", "notes.ma2", "slides.ma2"]) {
      const text = readFileSync(path.join(root, "tests/fixtures/ma2", file), "utf8");
      const chart = parseMa2Chart(text, 4);
      const map = buildMa2SourceMap(text);
      assert.ok(chart.bpmEvents.every((event) => Number.isFinite(event.timing) && event.bpm > 0));
      assert.ok(map.every((entry) => Number.isFinite(entry.beat) && entry.beat >= 4));
      if (file !== "meta.ma2") assert.ok(chart.notes.length > 0);
      for (const note of chart.notes) assert.ok(Number.isFinite(note.timingMs));
    }
  });

  test("MA2 ignores headers, comments, statistics and invalid source positions", () => {
    const map = buildMa2SourceMap("RESOLUTION 384\nBPM_DEF 120\nVERSION 0 0\nT_REC_TAP 2 3\n# NMTAP 0 0 0\nBPM 0 0 120\nNMTAP nope 0 0\nNMTAP 0 -1 0\nNMTAP 1 0 0");
    assert.deepEqual(map.map(({ line }) => line), [5, 8]);
    assert.deepEqual(buildMa2SourceMap("RESOLUTION 0\nNMTAP 0 0 0"), []);
    assert.throws(() => parseMa2Chart("BPM_DEF 120", 4), /RESOLUTION/);
    assert.throws(() => parseMa2Chart("RESOLUTION 384", 4), /BPM_DEF/);
  });

  test("Simai cursor mapping and multi-difficulty parsing continue to work", () => {
    const text = "&bpm=120\n&inote_3=\n1,2,\n&inote_4=\n{4}3,4,";
    const map = buildSimaiSourceMap(text, 4);
    assert.equal(findBeatByLine(map, 4), 4);
    assert.equal(findLineByBeat(map, 5), 4);
    const chart = parseSimaiChart(text, 4);
    assert.deepEqual(chart.notes.map((note) => note.position), [3, 4]);
  });

  test("Simai line lookup excludes other difficulties, metadata and blank lines", () => {
    const text = "&bpm=120\n&inote_3=\n1,2,\n&lv_4=13\n&inote_4=\n{4}3,4,\n\n&artist=Artist\n&inote_5=\n5,";
    const map = buildSimaiSourceMap(text, 4);
    assert.deepEqual(map.map(entry=>entry.line), [5]);
    for (const line of [0, 1, 2, 3, 4, 6, 7, 8, 9, 99]) assert.equal(findBeatByLine(map,line),null);
    assert.equal(findSimaiDifficultyByLine(text,2),3);
    assert.equal(findSimaiDifficultyByLine(text,5),4);
    assert.equal(findSimaiDifficultyByLine(text,9),5);
    assert.equal(findSimaiDifficultyByLine(text,7),null);
  });

  test("inline inote bodies advance following line positions correctly", () => {
    const text = "&bpm=120\n&inote_4={8}1,2,\n3,4,";
    const map = buildSimaiSourceMap(text, 4);
    assert.equal(findBeatByLine(map,1),4);
    assert.equal(findBeatByLine(map,2),5);
    assert.equal(findBeatByLine(buildMa2SourceMap('RESOLUTION 384\nBPM_DEF 120\nNMTAP 0 0 0'),0),null);
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
