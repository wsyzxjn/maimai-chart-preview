import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { test, after } from "node:test";
import esbuild from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(tmpdir(), "maimai-detection-test-"));
const require = createRequire(import.meta.url);
for (const [name, file] of [["format", "src/parser/chartFormat.ts"], ["lifecycle", "src/languageDetection.ts"]]) {
  await esbuild.build({entryPoints:[path.join(root,file)],bundle:true,platform:"node",format:"cjs",external:["vscode"],outfile:path.join(temporary,`${name}.cjs`)});
}
after(()=>rmSync(temporary,{recursive:true,force:true}));
const { detectChartFormat } = require(path.join(temporary,"format.cjs"));

test("detects multi-difficulty, single-difficulty and unfinished Simai charts",()=>{
  assert.equal(detectChartFormat(readFileSync(path.join(root,"tests/fixtures/multi-difficulty.simai"),"utf8")),"simai");
  assert.equal(detectChartFormat("\ufeff&title=Test\r\n&inote_4=\r\n(120){4}1,2,"),"simai");
  assert.equal(detectChartFormat("&bpm=120\n{4}1,2,3,4,"),"simai");
  assert.equal(detectChartFormat("&bpm=120\n&inote_4=\n1h[unfinished"),"simai");
  assert.equal(detectChartFormat("&bpm=120\n&inote_7=\n1,2,"),"simai");
  assert.equal(detectChartFormat("&title=Custom\n&inote_10=(120){4}1,2,"),"simai");
  assert.equal(detectChartFormat("&bpm=120\n&inote_0=\n1,2,"),null);
  assert.equal(detectChartFormat("&title=Work in progress\n&inote_4=\n1,2,"),"simai");
});

test("detects MA2 from combined headers and records or a version declaration",()=>{
  for (const file of ["notes.ma2","slides.ma2","meta.ma2"]) {
    assert.equal(detectChartFormat(readFileSync(path.join(root,"tests/fixtures/ma2",file),"utf8")),"ma2");
  }
  assert.equal(detectChartFormat("VERSION 0.00.00 1.04.00\nBPM_DEF 120 120 120 120\nRESOLUTION 384"),"ma2");
  assert.equal(detectChartFormat("RESOLUTION 0\nBPM_DEF 120\nNMTAP 0 0 1"),null);
  assert.equal(detectChartFormat("RESOLUTION 384\nBPM_DEF -1\nNMTAP 0 0 1"),null);
});

test("leaves unrelated text, isolated metadata and fenced examples untouched",()=>{
  for (const text of ["ordinary notes 1, 2, 3", "&title=Meeting\n&artist=Someone", "&bpm=120", "RESOLUTION 384\nBPM_DEF 120", "# NMTAP 0 0 1", '```simai\n&bpm=120\n&inote_4=\n1,2,\n```']) {
    assert.equal(detectChartFormat(text),null,text);
  }
  assert.equal(detectChartFormat("x".repeat(65536)+"\n&bpm=120\n&inote_4=\n1,2,"),null);
});

test("opened documents, debounced edits and manual language choices follow safe lifecycle rules",async()=>{
  let onOpen,onClose,onChange;
  let enabled=true;
  const associations={};
  const writes=[];
  const document=(name,text,languageId="plaintext")=>({fileName:`/tmp/${name}`,uri:{toString:()=>name},languageId,lineCount:text.split('\n').length,isClosed:false,positionAt:offset=>({line:0,character:Math.min(offset,text.length)}),getText:()=>text,text});
  const chart="&bpm=120\n&inote_4=\n1,2,";
  const existing=document('11820.txt',chart);
  const vscode={
    Range:class {},
    Position:class { constructor(line,character){this.line=line;this.character=character;} },
    workspace:{textDocuments:[existing],getConfiguration:(section)=>({get:(key,fallback)=>section==='files'?associations:key==='autoDetectCharts'?enabled:fallback}),onDidOpenTextDocument:cb=>{onOpen=cb;return {dispose(){}}},onDidCloseTextDocument:cb=>{onClose=cb;return {dispose(){}}},onDidChangeTextDocument:cb=>{onChange=cb;return {dispose(){}}}},
    languages:{match:({pattern},doc)=>pattern==='*.txt'&&doc.fileName.endsWith('.txt')?10:0,setTextDocumentLanguage:async(doc,format)=>{writes.push([doc.fileName,format]);onClose(doc);doc.languageId=format;onOpen(doc);return doc;}}
  };
  const original=Module._load;
  const subscriptions=[];
  try {
    Module._load=function(id,...args){return id==='vscode'?vscode:original.call(this,id,...args)};
    const {registerChartLanguageDetection}=require(path.join(temporary,"lifecycle.cjs"));
    registerChartLanguageDetection({subscriptions});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(existing.languageId,'simai');
    assert.equal(writes.length,1,"Language close/open recursion must not re-detect");
    for(const doc of [document('readme.txt','ordinary prose'),document('code.txt',chart,'markdown'),document('data.json',chart)])onOpen(doc);
    assert.equal(writes.length,1);
    associations['*.txt']='plaintext';onOpen(document('mapped.txt',chart));delete associations['*.txt'];
    assert.equal(writes.length,1,"Explicit plaintext association must remain plaintext");
    enabled=false;onOpen(document('disabled.txt',chart));enabled=true;
    assert.equal(writes.length,1);
    onClose(existing);existing.languageId='plaintext';onOpen(existing);
    onChange({document:existing});
    await new Promise(resolve=>setTimeout(resolve,230));
    assert.equal(writes.length,1,"Manual language override must not be reclaimed on edits");
    const editing=document('new.txt','&bpm=120');onOpen(editing);editing.getText=()=>chart;
    onChange({document:editing});onChange({document:editing});
    await new Promise(resolve=>setTimeout(resolve,230));
    assert.equal(editing.languageId,'simai');
    assert.equal(writes.length,2,"Debounced typing detects once");
    const ma2=document('ma2-copy.txt','RESOLUTION 384\nBPM_DEF 120\nNMTAP 0 0 1');onOpen(ma2);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(ma2.languageId,'ma2');
    const pending=document('closed.txt','&bpm=120');onOpen(pending);pending.getText=()=>chart;onChange({document:pending});pending.isClosed=true;onClose(pending);
    await new Promise(resolve=>setTimeout(resolve,230));
    assert.equal(writes.length,3,"Closing a pending file cancels detection");
  }finally{for(const subscription of subscriptions)subscription.dispose();Module._load=original}
});
