/* 结算页外壳：收尾录音 → 让模式算分 → 填充通用区域（成绩头 / 指标卡 / 字稿 / AI）
   分数怎么算、指标卡有哪些，全部由当前模式决定（mode.end / mode.cells） */
/* 填结算页这一屏。新结算和历史回看共用同一套填法——
   两条路只要有一处漏填，历史里打开就会缺一块 */
function fillResult(o){
  $('resultTopic').textContent = o.topic ?? '';
  $('resultCat').textContent = o.cat ?? '';
  // score 为 null = 这个模式不评分（自由练习）：显示占位，不染色也不做动画
  S.score = o.score == null ? null : o.score;
  const noScore = S.score == null;
  const sn = $('scoreNum');
  sn.textContent = noScore ? '—' : S.score;
  sn.className = 'score-num' + (noScore ? '' : (S.score>=95?' good':S.score>=70?' mid':' bad'));
  if(!noScore && o.animate !== false){ sn.style.animation='none'; void sn.offsetWidth; sn.style.animation=''; }
  $('scoreRating').textContent = o.rating || '';
  $('scoreRule').textContent = o.rule || '';
  // 指标卡由模式给出：[{v, k, pen}]
  $('statRow').innerHTML = (o.cells || []).map(c=>
    `<div class="stat-cell"><div class="sv${c.pen?' pen':''}">${c.v}</div><div class="sk">${c.k}</div></div>`).join('');

  // 模式专属的比对视图（朗读的原文标注），没有就不显示
  const rc = $('readCompare');
  if(rc){
    if(o.compareHtml){ rc.hidden = false; $('rcText').innerHTML = o.compareHtml; }
    else { rc.hidden = true; $('rcText').innerHTML = ''; }
  }
  // 转写区
  S.editing = false;
  if((o.transcript || '').trim()){
    $('transcriptSec').style.display = '';
    $('resultGrid').classList.remove('solo');
    renderTranscript(); renderWordStats();
  } else {
    $('transcriptSec').style.display = 'none';
    $('resultGrid').classList.add('solo');
    if(o.toastEmpty) toast('无转写文本（引擎为"无"或未出结果），只有计分');
  }
  syncNoteToggle();
  // 回看历史时不开放「修正转写」：改了也存不回那一场，按钮留着只会误导
  const et = $('editTranscriptBtn');
  if(et) et.style.display = o.viewing ? 'none' : '';
  setTimeout(()=>{
    if(o.audioURL){ $('audioPlayer').src = o.audioURL; $('audioWrap').style.display=''; }
    else $('audioWrap').style.display='none';
  },200);
}

/* 老记录里没存指标卡（那会儿只存了分数），回看时用存下来的字段凑一版，
   总比一屏空卡片强 */
function fallbackCells(h){
  const c = [];
  if(h.dur) c.push({v: Math.floor(h.dur/60) + ':' + String(h.dur%60).padStart(2,'0'), k:'时长'});
  if((h.rounds||[]).length) c.push({v: h.rounds.length, k:'轮数'});
  if(h.stuck) c.push({v: h.stuck, k:'卡壳', pen:true});
  if(h.peek) c.push({v: h.peek, k:'看稿', pen:true});
  if(h.hint) c.push({v: h.hint, k:'提示', pen:true});
  if(h.patience != null) c.push({v: h.patience, k:'耐心剩余', pen: h.patience <= (h.init_patience||100)*0.3});
  return c;
}

/* 历史里点开某一场：把那一屏原样复现，报告有的话一起带出来 */
async function viewHistory(h){
  if(S.speaking && !confirm('本场还没结束，查看历史会丢弃这一场。确定吗？')) return;
  clearInterval(S.speakTimer); clearHint();
  await stopEngines(true);
  S.speaking = false; S.paused = false;
  if(S.recorder && S.recorder.state !== 'inactive'){ try{ S.recorder.stop(); }catch(e){} }

  // 切到那一场的模式：指标卡、复盘、报告都是按模式走的
  const mid = h.mode || 'extemp';
  if(MODES[mid] && mid !== S.mode){
    S.mode = mid;
    $('homeBtn').textContent = MODES[mid].homeLabel || '回到开头';
    renderModeSwitch();
  }
  S.topic = h.topic || ''; S.topicCat = h.cat || '';
  S.transcript = h.transcript || '';
  S.stats = (h.stats && Object.keys(h.stats).length) ? h.stats : null;
  S.analysis = (h.analysis && (h.analysis.summary || (h.analysis.sentences||[]).length)) ? h.analysis : null;
  S.peek = h.peek || 0; S.hint = h.hint || 0; S.stuck = h.stuck || 0;
  S.entryId = h.id;
  S.audioURL = null;

  fillResult({topic: h.topic || '（无题）',
              cat: h.cat || (MODES[mid]||{}).name || '',
              score: h.score, rating: h.rating, rule: h.rule,
              cells: (h.cells && h.cells.length) ? h.cells : fallbackCells(h),
              transcript: S.transcript, audioURL: null, viewing: true});

  // AI 区：复盘按钮对这一场的字稿生效；报告有就显示，没有留着按钮现场生成
  const hasAI = !!(S.cfg.ai && S.cfg.ai.base_url && S.cfg.ai.model);
  $('aiSec').style.display = hasAI ? '' : 'none';
  $('aiBtn').disabled = false; $('aiBtn').textContent = S.analysis ? '重新复盘' : 'AI 复盘';
  $('aiStatus').textContent = ''; $('aiStatus').className = 'ai-status'; $('aiStatus').style.display = '';
  if(S.analysis && S.analysis.summary){
    $('aiSummary').style.display = ''; $('aiSummary').textContent = S.analysis.summary;
  } else { $('aiSummary').style.display = 'none'; $('aiSummary').textContent = ''; }
  if(S.analysis && (S.analysis.sentences||[]).length){
    $('transcriptText').classList.add('show-notes'); syncNoteToggle();
  }
  $('reportBtn').disabled = false; $('reportBtn').textContent = '生成报告';
  $('reportStatus').textContent = ''; $('reportStatus').className = 'ai-status'; $('reportStatus').style.display='';
  $('reportMd').innerHTML = ''; $('reportMd').style.display = 'none';
  S.report = null;
  if(hasAI){
    try{
      const r = await api.get('/api/report/'+h.id);
      S.report = r;
      $('reportMd').innerHTML = md2html(r.markdown); $('reportMd').style.display = '';
      $('reportBtn').textContent = '重新生成'; $('reportStatus').style.display = 'none';
    }catch(e){ /* 当时没生成报告：留着按钮，想看再生成 */ }
  }

  // 对比上一场：拿同模式里比它更早的那一条；趋势图按这个模式画
  const same = HIST.filter(x => (x.mode || 'extemp') === mid);
  const idx = same.findIndex(x => x.id === h.id);
  S.prevEntry = idx >= 0 ? (same[idx+1] || null) : null;
  renderCompare({cur: h, prev: S.prevEntry});
  renderResultTrend();
  closeDrawer('drawer'); setPhase('result');
}

async function endSpeak(){
  if(!S.speaking) return;           // 防重入：结算只出一次
  S.speaking = false;
  clearInterval(S.speakTimer);
  clearHint();                      // 讲完了，提示条收起来
  if(S.readying && S._skipReady) S._skipReady();   // 准备倒计时直接收掉
  if(S.paused){ S.paused = false; }                // 暂停中结束：时长用累计值
  await stopEngines(true);        // 收尾：把最后半句定稿后再读文本
  const dur = Math.round(speakSec());
  if(S.speakStart){ S.speakElapsed += Date.now()-S.speakStart; S.speakStart = null; }
  updateSpeakUI();
  if(S.recorder && S.recorder.state !== 'inactive') S.recorder.stop();

  // 模式算分：返回 {score, rating, rule, cells, entry, topic, cat}
  const m = curMode();
  const res = await m.end(dur);

  fillResult({topic: res.topic ?? S.topic, cat: res.cat ?? S.topicCat,
              score: res.score, rating: res.rating, rule: res.rule, cells: res.cells,
              transcript: S.transcript, compareHtml: res.compareHtml,
              audioURL: S.audioURL, toastEmpty: true});

  // AI 区：复盘与报告都按需触发，不自动烧 token
  const hasAI = S.cfg.ai.base_url && S.cfg.ai.model;
  $('aiSec').style.display = hasAI ? '' : 'none';
  $('aiBtn').disabled = false; $('aiBtn').textContent = 'AI 复盘';
  $('aiStatus').textContent = ''; $('aiStatus').className = 'ai-status'; $('aiStatus').style.display='';
  $('aiSummary').style.display='none'; $('aiSummary').textContent='';
  $('reportStatus').textContent = ''; $('reportStatus').className = 'ai-status';
  $('reportMd').innerHTML = ''; $('reportMd').style.display='none';
  S.analysis = null; S.report = null;

  // 存历史：通用字段 + 模式附加字段（老记录缺字段时按 0 处理）
  try{
    const entry = await api.post('/api/history', Object.assign({
      topic: S.topic, cat: S.topicCat,
      score: res.score == null ? null : res.score,   // null = 不评分，别存 0 污染均分
      mode: S.mode, dur,
      // 这一屏的关键内容存下来，历史里点开才能原样复现（指标卡/评级/规则）
      rating: res.rating || '', rule: res.rule || '', cells: res.cells || [],
      transcript: S.transcript,
      // align 是朗读的比对结果，报告与「对比上一场」都要读它
      stats: S.stats ? {categories:S.stats.categories, habits:S.stats.habits,
                        char_count:S.stats.char_count, chars_per_minute:S.stats.chars_per_minute,
                        avg_sentence_len:S.stats.avg_sentence_len,
                        align:S.stats.align || null} : {},
      analysis: res.analysis || {},
    }, res.entry || {}));
    S.entryId = entry.id;
  }catch(e){ toast('历史保存失败：'+e.message); }
  await renderDrawer();
  // 上一场 = 同模式的历史里除本次之外的第一条：不同模式的分数不可比，跨模式比会得出错误结论
  const curModeId = (HIST.find(h => h.id === S.entryId) || {}).mode || S.mode;
  S.prevEntry = HIST.find(h => h.id !== S.entryId && (h.mode || curModeId) === curModeId) || null;
  renderCompare(); renderResultTrend();
  // 讲完自动跑一次复盘（设置里可关）：省掉手动点那一下
  if(S.cfg.ai?.auto_analyze && hasAI && S.transcript.trim()){
    setTimeout(()=>{ try{ $('aiBtn').click(); }catch(e){} }, 400);
  }
  setPhase('result');
}

/* AI 复盘时给后端的原文：朗读模式要带上原文，AI 才能对照着评 */
function aiReference(){ return curMode().reference ? curMode().reference() : ''; }

/* ================= 转写标记 ================= */
/* 把全文级标记切到某一句的局部坐标系里 */
function marksForSlice(marks, start, len){
  return marks
    .filter(m=>m.end > start && m.start < start + len)
    .map(m=>({cat:m.cat, start: Math.max(0, m.start-start), end: Math.min(len, m.end-start)}));
}
function renderTranscript(){
  const box = $('transcriptText');
  const marks = (S.stats?.marks)||[];
  box.classList.remove('editing');
  box.contentEditable = 'false';
  const d = S.cfg.display || {};
  const nl = d.sentence_newline !== false, sp = d.show_punct !== false;
  if(!nl){
    box.innerHTML = escWithMarkList(S.transcript, marks) || '<span style="color:var(--faint)">（空）</span>';
    return;
  }
  // 按句分行：句号只控制显示，统计与标记仍基于完整文本的偏移
  const map = noteMap();
  const html = sentenceBlocks(S.transcript).map(b=>{
    const text = sp ? b.text : b.text.replace(/[。！？；!?;…]+$/,'');
    if(!text.trim()) return '';
    const note = findNote(text, map);
    const cls = 'sent' + (note ? ` noted sev-${note.severity || 'info'}` : '');
    const body = escWithMarkList(text, marksForSlice(marks, b.start, text.length));
    return `<div class="${cls}">${body}${noteHtml(note)}</div>`;
  }).join('');
  box.innerHTML = html || '<span style="color:var(--faint)">（空）</span>';
}
/* ---------- 内联点评：把 AI 复盘的逐句意见挂到对应句子下面 ---------- */
/* AI 回的引文未必跟切句完全一致（它常截半句、多带一个标点），
   所以用「去掉标点与空白」后的文本做匹配，再退一步用包含关系兜底 */
const normQuote = s => String(s||'').replace(/[\s，。！？；：、,.!?;:"“”‘’（）()《》]/g,'');
function noteMap(){
  const m = new Map();
  (S.analysis?.sentences||[]).forEach(s=>{ if(s.quote) m.set(normQuote(s.quote), s); });
  return m;
}
function findNote(text, map){
  if(!map || !map.size) return null;
  const n = normQuote(text);
  if(map.has(n)) return map.get(n);
  for(const [k,v] of map){
    if(k.length >= 6 && (n.includes(k) || k.includes(n))) return v;
  }
  return null;
}
function noteHtml(s){
  if(!s) return '';
  const issues = (s.issues||[]).map(i=>`<div class="sn-i">· ${esc(i.note || i)}</div>`).join('');
  const sug = s.suggestion ? `<div class="sn-s">→ ${esc(s.suggestion)}</div>` : '';
  if(!issues && !sug) return '';
  return `<div class="sent-note">${issues}${sug}</div>`;
}
/* 点评默认展开（复盘完就是想看它），按钮只负责收起/再展开 */
function syncNoteToggle(){
  const btn = $('noteToggle'); if(!btn) return;
  const has = !!((S.analysis?.sentences||[]).length);
  btn.disabled = !has;
  const box = $('transcriptText');
  if(!has) box.classList.remove('show-notes');
  btn.textContent = box.classList.contains('show-notes') ? '隐藏点评' : '显示点评';
}
$('noteToggle').onclick = ()=>{
  $('transcriptText').classList.toggle('show-notes');
  syncNoteToggle();
};
function renderLegend(){
  const box = $('markLegend'); box.innerHTML = '';
  LEGEND.forEach(l=>{
    const item = document.createElement('div');
    item.className = 'legend-item' + (legendOn[l.cat]?'':' off');
    const count = S.stats?.categories[l.cat]?.count ?? 0;
    const col = getComputedStyle(document.documentElement).getPropertyValue(l.colorVar);
    item.innerHTML = `<span class="sw" style="background:${col}"></span>${l.name} <b>${count}</b>`;
    item.onclick = ()=>{
      legendOn[l.cat] = !legendOn[l.cat];
      renderLegend(); renderTranscript();
    };
    box.appendChild(item);
  });
}
function renderWordStats(){
  renderLegend();
  const st = S.stats;
  const box = $('wordStats');
  box.innerHTML = st ? `
    <span class="word-stat">总字数 <b>${st.char_count}</b></span>
    <span class="word-stat">语速 <b>${st.chars_per_minute}</b> 字/分</span>
    <span class="word-stat">平均句长 <b>${st.avg_sentence_len}</b> 字</span>` : '';
  const habits = st?.habits || [];
  $('habitLine').textContent = habits.length
    ? '高频口头禅：' + habits.map(h=>`${h.word}（${h.count} 次）`).join('、') : '';
}
$('editTranscriptBtn').onclick = async ()=>{
  const box = $('transcriptText');
  if(!S.editing){
    S.editing = true;
    box.contentEditable = 'true'; box.classList.add('editing'); box.textContent = S.transcript;
    $('editTranscriptBtn').textContent = '完成修正';
    box.focus();
  } else {
    S.editing = false;
    S.transcript = box.textContent.trim();
    box.contentEditable = 'false'; box.classList.remove('editing');
    S.stats = await api.post('/api/analyze/words', {transcript: S.transcript, duration_sec: S.stats.duration_sec});
    renderTranscript(); renderWordStats();
    $('editTranscriptBtn').textContent = '修正转写';
    toast('已按修正后文本重新统计');
  }
};

/* ================= AI 复盘 ================= */
/* 复盘结果不另起一块列表，直接内联到字稿对应的句子下面（见 noteHtml），
   这里只负责整体结论。按需触发，不自动烧 token。 */
$('aiBtn').onclick = async ()=>{
  if(!S.transcript.trim()){ toast('没有转写文本'); return; }
  const btn = $('aiBtn'), st = $('aiStatus');
  btn.disabled = true;
  st.className = 'ai-status';
  st.innerHTML = '<span class="spin"></span>AI 复盘中，约需十几秒…';
  try{
    S.analysis = await api.post('/api/analyze/sentences', {
      topic: S.topic, transcript: S.transcript,
      mode: S.mode, reference: aiReference(),
    });
    st.textContent = ''; st.style.display='none';
    renderTranscript();                                  // 把逐句意见挂进字稿
    $('transcriptText').classList.add('show-notes');      // 复盘完就是想看它，默认展开
    syncNoteToggle();
    if(S.analysis.summary){
      $('aiSummary').style.display=''; $('aiSummary').textContent = S.analysis.summary;
    }
  }catch(e){
    st.className = 'ai-status err'; st.textContent = '复盘失败：' + e.message;
  }
  btn.disabled = false; btn.textContent = '重新复盘';
};

/* ================= 报告 ================= */
const md2html = md => {
  const lines = md.split('\n'); let out = '', inList = false;
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  for(const l of lines){
    const t = l.trim();
    if(/^##\s/.test(t)){ if(inList){out+='</ul>';inList=false;} out += `<h2>${inline(t.slice(3))}</h2>`; }
    else if(/^#\s/.test(t)){ if(inList){out+='</ul>';inList=false;} out += `<h1>${inline(t.slice(2))}</h1>`; }
    else if(/^[-*]\s/.test(t)){ if(!inList){out+='<ul>';inList=true;} out += `<li>${inline(t.slice(2))}</li>`; }
    else if(t){ if(inList){out+='</ul>';inList=false;} out += `<p>${inline(t)}</p>`; }
  }
  if(inList) out += '</ul>';
  return out;
};
$('reportBtn').onclick = async ()=>{
  const btn = $('reportBtn'), st = $('reportStatus');
  btn.disabled = true;
  st.className = 'ai-status';
  st.innerHTML = '<span class="spin"></span>报告生成中…';
  try{
    // 面试模式要额外带上每一轮的问答与面试官耐心，报告才是按轮复盘的
    const extra = curMode().reportExtra ? curMode().reportExtra() : {};
    const rep = await api.post('/api/report', {
      entry_id: S.entryId || String(Date.now()),
      // 不能从 scoreNum 读：不评分时那里是「—」，+ 出来是 NaN 会让后端 422
      topic: S.topic, score: S.score == null ? null : S.score,
      peek: S.peek,
      duration_sec: S.stats?.duration_sec ?? 0,
      stats: S.stats || {}, habits: S.stats?.habits || [],
      analysis: S.analysis || {},
      mode: S.mode,
      rounds: extra.rounds || [],
      patience: extra.patience ?? null,
      init_patience: extra.init_patience ?? 100,
    });
    S.report = rep;
    $('reportMd').innerHTML = md2html(rep.markdown);
    $('reportMd').style.display = '';
    st.textContent = ''; st.style.display='none';
  }catch(e){
    st.className = 'ai-status err'; st.textContent = '生成失败：' + e.message;
  }
  btn.disabled = false; btn.textContent = '重新生成';
};
