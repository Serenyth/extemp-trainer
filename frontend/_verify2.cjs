const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
let m, n = 0, ok = true;
while ((m = re.exec(src))) {
  n++;
  try { new Function(m[1]); console.log('script OK (' + m[1].length + ' chars)'); }
  catch (e) { ok = false; console.log('script FAIL: ' + e.message); }
}
const has = s => src.includes(s);
const checks = {
  '断句等待输入框': has('id="spSilence"'),
  'fillSettings 回填 silence': has("$('spSilence').value = ((c.speech.silence_ms ?? 1200)/1000).toFixed(1);"),
  'speech 保存含 silence_ms': /silence_ms:\s*Math\.round\(Math\.min\(3, Math\.max\(0\.6, \+\$\('spSilence'\)\.value\|\|1\.2\)\*1000\)\)/.test(src),
  '每句换行开关': has('id="dNewline"'),
  '句末标点开关': has('id="dPunct"'),
  'sentenceBlocks 定义': has('function sentenceBlocks('),
  'escWithMarkList 定义': has('function escWithMarkList('),
  'marksForSlice 定义': has('function marksForSlice('),
  'renderTranscript 分句渲染': has('marksForSlice(marks, b.start, text.length)'),
  'renderSubtitle 分句渲染': has("sentenceBlocks(S.transcript).map(b=>`<div class=\"sent\">"),
  'display 保存含新开关': has("sentence_newline: $('dNewline').value === 'true'"),
  '保存后即时重渲染': has('if(S.stats) renderTranscript();'),
};
for (const [k, v] of Object.entries(checks)) console.log((v ? 'OK  ' : 'FAIL') + '  ' + k);
console.log('div 配对:', (src.match(/<div\b/g) || []).length, (src.match(/<\/div>/g) || []).length);
console.log('换行形态:', src.includes('\r\n') ? 'CRLF' : 'LF');
process.exit(ok && Object.values(checks).every(Boolean) ? 0 : 1);
