import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test, after } from "node:test";
import esbuild from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const directory = mkdtempSync(path.join(tmpdir(), "maimai-syntax-test-"));
const require = createRequire(import.meta.url);
await esbuild.build({
  stdin: { contents: 'export { parseSimaiChart, parseMa2Chart, readSimaiSections } from "@lxns-network/maimai-chart-engine";', resolveDir: root, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", outfile: path.join(directory, "engine.cjs"),
});
await esbuild.build({entryPoints:[path.join(root,"src/parser/sourceMap.ts")],bundle:true,platform:"node",format:"cjs",outfile:path.join(directory,"map.cjs")});
after(() => rmSync(directory, { recursive: true, force: true }));
const { parseSimaiChart, parseMa2Chart, readSimaiSections } = require(path.join(directory, "engine.cjs"));
const { buildSimaiSourceMap, findSimaiDifficultyByLine } = require(path.join(directory, "map.cjs"));
const simai = (body) => `&bpm=120\n&inote_5=\n${body}`;

test("comments do not create notes, timing changes, difficulty sections or cursor positions", () => {
  const text = simai("1, // ignored,2,(0){0}\n/* comment,8,\n&inote_10=\n*/2,\n3,");
  const chart = parseSimaiChart(text, 5);
  assert.deepEqual(chart.notes.map(n=>[n.position,n.timing,n.timingMs]), [[1,4,2000],[2,5,2500],[3,6,3000]]);
  assert.deepEqual(Object.keys(chart.availableDifficulties),["5"]);
  assert.deepEqual(buildSimaiSourceMap(text,5).map(e=>[e.line,e.beat]),[[2,4],[5,5],[6,6]]);
  assert.equal(findSimaiDifficultyByLine(text,4),null);
  assert.equal(findSimaiDifficultyByLine(text,5),5);
  assert.equal(readSimaiSections("// &inote_6=\n&bpm=120\n{4}1,").hasSectionDeclarations,false);
  assert.equal(parseSimaiChart("// \n&bpm=120\n&inote_10=1, // 8,\n/* &inote_5=1, */2,",10).notes.length,2);
});

test("comment masking preserves token separation and metadata values",()=>{
  const chart=parseSimaiChart("&title=https://example.test/chart\n&des_5=/* literal name */\n&bpm=120\n&inote_5=1/* ignored */h[4:1],\n/* start\nmultiline */2,",5);
  assert.equal(chart.title,"https://example.test/chart");
  assert.equal(chart.designer,"/* literal name */");
  assert.throws(()=>parseSimaiChart('&bpm=120\n&inote_10=(120)1,typo,',10),error=>error.line===1&&error.column===17);
  assert.throws(()=>parseSimaiChart('\ufeff&bpm=0\n1,'),error=>error.line===0&&error.column===1);
  assert.deepEqual(chart.notes.map(n=>n.type),["hold-start","hold-end","tap"]);
  assert.throws(()=>parseSimaiChart(simai("1,\n/* unclosed"),5),/注释.*未闭合|未闭合.*注释/);
});

test("unknown notes, missing slide paths and malformed timing fail instead of silently disappearing",()=>{
  for(const token of ['garbage,','0,','9,','A9,','Ch,','1w[4:1],','1-9[4:1],','1h[0:1],','1-5[0#4:1],','1-5[0:1],']) {
    assert.throws(()=>parseSimaiChart(simai(token),5),Error,token);
  }
  const text=simai("1,\n  nonsense,");
  try { parseSimaiChart(text,5); assert.fail('Expected unknown token error'); }
  catch(error) { assert.equal(error.line,3); assert.equal(error.column,2); assert.ok(error.length>=8); }
  assert.deepEqual(parseSimaiChart(simai("1,E,2,"),5).notes.map(n=>n.position),[1]);
  assert.deepEqual(buildSimaiSourceMap(simai("1,\nE\n2,"),5).map(e=>e.line),[2,3]);
  assert.deepEqual(parseSimaiChart(simai("E3,1,"),5).notes.map(n=>n.position),["E3",1]);
  assert.equal(parseSimaiChart(simai('1h[1:0],2h[#0],'),5).notes.filter(n=>n.isHoldStart).length,2);
  assert.equal(findSimaiDifficultyByLine(text,1),null);
});

test("invalid Simai time parameters cannot create NaN or infinite note times",()=>{
  for(const text of [simai('(0)1,2,'),simai('(bad)1,'),simai('{0}1,'),'&bpm=0\n1,','&bpm=-120\n1,','&bpm=120garbage\n1,',simai('<HS*0>1,'),'&first=Infinity\n&bpm=120\n1,']) {
    assert.throws(()=>parseSimaiChart(text,5),Error,text);
  }
});

test("MA2 incomplete records and invalid numerical fields produce meaningful errors",()=>{
  const head='RESOLUTION 384\nBPM_DEF 120\n';
  for(const record of ['NMTTP 0 0 0','NMTHO 0 0 0 192','NMTAP 0 0 99','NMTAP -1 0 1','NMHLD 0 0 1 -10','BPM 1 0 0','MET 0 0 0.5 4','MET 0 0 4 0','TAP 0 0 1','UNKNOWN 0 0 1']) {
    assert.throws(()=>parseMa2Chart(head+record,4),Error,record);
  }
  for(const head of ['RESOLUTION 0\nBPM_DEF 120','RESOLUTION 384\nBPM_DEF 0','RESOLUTION nope\nBPM_DEF 120']) {
    assert.throws(()=>parseMa2Chart(head+'\nNMTAP 0 0 0',4),Error,head);
  }
  try { parseMa2Chart(head+'NMTTP 0 0 0',4); assert.fail('Expected field error'); }
  catch(error) { assert.equal(error.line,2); assert.match(error.message,/NMTTP|字段/); assert.doesNotMatch(error.message,/undefined|toUpperCase/); }
});

test("standard advanced Slide forms, HS and timing variations stay supported",()=>{
  const text=simai('1?-5[4:1],1!-5[4:1],1@-5[4:1],1-5[4:1]*>7[8:1],1-4[8:1]>5[8:1],1V35[4:1],1-5[0##1],1-5[#1],<HS*-1>2,');
  const chart=parseSimaiChart(text,5);
  assert.equal(chart.notes.length,9);
  assert.ok(chart.notes.every(n=>Number.isFinite(n.timingMs)));
  assert.equal(chart.notes.at(-1).hiSpeed,-1);
});
