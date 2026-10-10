/* 文本工具：词汇标记与切句。开讲页实时字稿与结算页字稿共用同一套渲染 */
/* 给定文本 + 标记列表（相对该文本的偏移）渲染带标记的 HTML */
function escWithMarkList(text, marks){
  let html = '', last = 0;
  marks.forEach(m=>{
    if(!legendOn[m.cat]) return;
    if(m.start > last) html += esc(text.slice(last, m.start));
    html += `<mk class="${m.cat[0]}" title="${({filler:'填充词',hedging:'犹豫词',vague:'笼统词'})[m.cat]}">${esc(text.slice(m.start,m.end))}</mk>`;
    last = m.end;
  });
  html += esc(text.slice(last));
  return html;
}
function matchMarks(text){
  const entries = [];
  Object.entries(S.words).forEach(([cat, ws])=>{
    (ws||[]).forEach(w=>{
      if(!w) return;
      let i = text.indexOf(w);
      while(i !== -1){ entries.push({start:i, end:i+w.length, word:w, cat}); i = text.indexOf(w, i+1); }
    });
  });
  entries.sort((a,b)=>a.start-b.start || (b.end-b.start)-(a.end-a.start));
  const out = []; let cursor = -1;
  entries.forEach(e=>{ if(e.start >= cursor){ out.push(e); cursor = e.end; } });
  return out;
}
function escWithMarks(text){
  const marks = (S.words && Object.keys(S.words).length) ? matchMarks(text) : [];
  return escWithMarkList(text, marks);
}
/* 按句末标点切块，返回 [{text, start}]：start 是该句在全文里的偏移 */
function sentenceBlocks(t){
  const out = []; let s = 0;
  for(let i=0;i<t.length;i++){
    if('。！？；!?;…'.includes(t[i])){
      if(i > s) out.push({text: t.slice(s, i+1), start: s});
      s = i+1;
    }
  }
  if(s < t.length) out.push({text: t.slice(s), start: s});
  return out;
}
