/* 历史抽屉与结算页的对比/趋势。趋势必须限定在同一模式内算：
   命题演讲的分数和朗读练习的分数不是一回事，跨模式比较会得出错误结论 */
let HIST = [];

/* ---------- 结算页：对比上一场 ---------- */
/* 比哪些项、怎么算，全部交给当前模式定义；这里只负责渲染 */
/* opt: {cur, prev} 两条历史记录 → 历史回看时对比它俩；不传就是「本场 vs 上一场」 */
function renderCompare(opt){
  const box = $('cmpBox'); if(!box) return;
  const m = curMode();
  let cur, prev = null;
  if(opt && opt.cur){
    cur = m.metricsOf(opt.cur);
    prev = opt.prev ? m.metricsOf(opt.prev) : null;
  } else {
    if(!S.prevEntry){
      box.innerHTML = '<div class="cmp-none">这是第一场，还没有可对比的对象。<br>下一场结算时这里会给出逐项变化。</div>';
      return;
    }
    cur = m.curMetrics(); prev = m.metricsOf(S.prevEntry);
  }
  if(!prev){
    box.innerHTML = '<div class="cmp-none">这是第一场，还没有可对比的对象。<br>下一场结算时这里会给出逐项变化。</div>';
    return;
  }
  const rows = m.compareRows || [];
  box.innerHTML = rows.map(r=>{
    const c = cur[r.a], p = prev[r.p];
    const d = Math.round((c - p) * 10) / 10;
    let cls = 'flat', txt = '持平';
    if(Math.abs(d) > r.eps){
      const good = r.better === 'high' ? d > 0 : d < 0;
      cls = r.better === 'none' ? 'flat' : (good ? 'good' : 'bad');
      txt = (d > 0 ? '↑ ' : '↓ ') + Math.abs(d);
    }
    // 值取自本次的 cur[r.a]，不是 r.c——行定义里只有 k/a/p/u/better/eps
    return `<div class="cmp-row"><span class="ck">${r.k}</span>`
         + `<span class="cv">${c}${r.u ? `<small style="font-size:13px;color:var(--muted);margin-left:2px">${r.u}</small>`:''}</span>`
         + `<span class="cd ${cls}">${txt}</span></div>`;
  }).join('');
}
/* ---------- 结算页：历史趋势 ---------- */
function renderResultTrend(){
  const box = $('resultTrend'), note = $('resultTrendNote');
  if(!box) return;
  const mode = (HIST.find(h => h.id === S.entryId) || {}).mode || S.mode;
  const list = (HIST||[]).filter(h => (h.mode || 'extemp') === mode).slice(0, 14).reverse();   // 旧 → 新，左到右
  box.innerHTML = '';
  if(list.length < 2){
    note.textContent = list.length ? '只有一场，再练几场才看得出趋势' : '';
    return;
  }
  // 不评分的模式（自由练习）没有分数曲线可画，柱子只表示"练过"
  const scored = list.filter(h => h.score != null);
  list.forEach((h,i)=>{
    const el = document.createElement('i');
    el.style.height = (h.score == null ? 6 : Math.max(4, Math.min(100, h.score))) + '%';
    el.className = (i === list.length-1) ? 'cur' : (h.score >= 85 ? 'hi' : '');
    if(h.score == null) el.classList.add('none');
    el.title = `${(h.date||'').slice(5,10)} · ${h.score == null ? '不评分' : h.score + ' 分'}`;
    box.appendChild(el);
  });
  if(!scored.length){
    note.textContent = `这个模式不评分，已练 ${list.length} 场`;
    return;
  }
  const avg = a => a.length ? Math.round(a.reduce((s,h)=>s+h.score,0)/a.length) : null;
  const n = Math.min(5, Math.floor(scored.length/2)) || 1;
  const recent = scored.slice(-n), older = scored.slice(-2*n, -n);
  const r = avg(recent), o = avg(older);
  note.textContent = `近 ${recent.length} 场均分 ${r} · 最佳 ${Math.max(...scored.map(h=>h.score))}`
    + (o !== null && older.length ? ` · 比前 ${older.length} 场 ${r-o >= 0 ? '+' : ''}${r-o}` : '');
}
function calcStreak(){
  const days = [...new Set(HIST.map(h=>(h.date||'').slice(0,10)))].sort().reverse();
  if(!days.length) return 0;
  const today = new Date();
  const dstr = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  if(days[0]!==dstr(today) && days[0]!==dstr(new Date(today.getTime()-86400000))) return 0;
  let streak=1, cur=new Date(days[0]+'T00:00:00');
  for(let i=1;i<days.length;i++){
    const prev = new Date(cur.getTime()-86400000);
    if(dstr(prev)===days[i]){ streak++; cur=prev; } else break;
  }
  return streak;
}
async function renderDrawer(){
  try{ HIST = await api.get('/api/history'); }catch(e){ HIST = []; }
  const streak = calcStreak();
  const st = $('streak');
  st.querySelector('b').textContent = streak;
  st.classList.toggle('lit', streak>0);
  $('statSessions').textContent = HIST.length;
  // 均分与最佳只算有分的场次：自由练习不评分（score 为 null），混进来会把均分拉低
  const scored = HIST.filter(h => h.score != null);
  $('statAvg').textContent = scored.length ? Math.round(scored.reduce((a,h)=>a+h.score,0)/scored.length) : '--';
  $('statBest').textContent = scored.length ? Math.max(...scored.map(h=>h.score)) : '--';
  const tr = $('trend'); tr.innerHTML = '';
  HIST.slice(0,20).reverse().forEach(h=>{
    const i = document.createElement('i');
    if(h.score == null){ i.className = 'none'; i.title = '不评分'; }
    else{ i.className = h.score>=85?'hi':''; i.title = h.score+' 分'; }
    i.style.height = Math.max(+h.score || 0, 3)+'%';
    tr.appendChild(i);
  });
  const ul = $('historyList'); ul.innerHTML = '';
  $('historyEmpty').style.display = HIST.length?'none':'';
  HIST.slice(0,40).forEach(h=>{
    const li = document.createElement('li');
    const d = h.date ? new Date(h.date) : new Date();
    const mm = (d.getMonth()+1)+'.'+d.getDate();
    const col = h.score>=85?'var(--green)':h.score>=70?'var(--amber)':'var(--red)';
    const scoreTxt = h.score == null ? '—' : h.score;
    li.innerHTML = `
      <div class="hl-top"><span class="hl-topic">${esc(h.topic || '（无题）')}</span>
        <span class="hl-score" style="color:${h.score == null ? 'var(--faint)' : col}">${scoreTxt}</span></div>
      <div class="hl-meta"><span>${mm} · ${h.dur||0}s</span>
        <span class="hl-mode">${esc((MODES[h.mode]||{}).name || '命题演讲')}</span>
        ${(h.rounds||[]).length?`<span class="f">${h.rounds.length} 轮</span>`:''}
        ${h.stuck?`<span class="f">卡 ${h.stuck}</span>`:''}
        ${h.peek?`<span class="p">看 ${h.peek}</span>`:''}</div>
      <div class="hl-acts"><button class="hl-act rep">查看这一场</button><button class="hl-act del">删除</button></div>`;
    // 整条都能点开：以前只有生成过报告的才看得着东西，现在任何一场都能回到那一屏
    li.onclick = (ev)=>{ if(ev.target.closest('.hl-act')) return; viewHistory(h); };
    li.querySelector('.rep').onclick = ()=> viewHistory(h);
    li.querySelector('.del').onclick = async (ev)=>{
      ev.stopPropagation();
      try{ await api.del('/api/history/'+h.id); renderDrawer(); }catch(e){ toast('删除失败'); }
    };
    ul.appendChild(li);
  });
}

/* ================= localStorage 迁移 ================= */
async function migrateLocal(){
  try{
    const old = JSON.parse(localStorage.getItem('tt_history')||'[]');
    const oldCustom = JSON.parse(localStorage.getItem('tt_custom')||'[]');
    if(oldCustom.length){
      const bank = {...S.bank};
      bank['自定义'] = [...new Set([...(bank['自定义']||[]), ...oldCustom])];
      S.bank = await api.put('/api/bank', bank);
      localStorage.removeItem('tt_custom');
    }
    if(old.length){
      for(const h of old){
        await api.post('/api/history', {topic:h.topic||'', cat:h.cat||'', score:h.score??0,
          mode:'extemp', peek:h.peek||0, dur:h.dur||0, transcript:'', stats:{}});
      }
      localStorage.removeItem('tt_history');
      toast('已导入旧版本地记录');
    }
  }catch(e){}
}
