/* 命题演讲模式：抽题 → 备稿（含提纲笔记）→ 开讲 → 结算
   开讲与结算用通用引擎（speak.js / result.js），这里只管命题演讲自己的输入与流程 */
function buildCatChips(){
  const box = $('catChips'); box.innerHTML = '';
  const cats = ['全部混合', ...Object.keys(S.bank)];
  cats.forEach(c=>{
    const b = document.createElement('button');
    b.className = 'cat-chip' + (S.cat===c?' on':''); b.textContent = c;
    b.onclick = ()=>{ S.cat=c; $('catFoldLabel').textContent='分类 · '+c; buildCatChips(); };
    box.appendChild(b);
  });
}
function topicPool(){
  if(S.cat==='全部混合'){
    const all = [];
    Object.entries(S.bank).forEach(([c,arr])=>arr.forEach(t=>all.push({t,c})));
    return all;
  }
  return (S.bank[S.cat]||[]).map(t=>({t, c:S.cat}));
}
let scrambleTimer = null;
const SCRAMBLE_STEPS = 12;      // 滚动帧数；帧间隔逐帧拉长，越接近落定越慢
function draw(){
  const pool = topicPool();
  if(!pool.length){ toast('该分类下没有命题'); return; }
  const hero = $('topicHero');
  clearTimeout(scrambleTimer);
  hero.classList.add('scrambling'); hero.classList.remove('settled');
  $('toPrepBtn').classList.remove('show');
  let n = 0;
  const step = ()=>{
    $('topicText').textContent = pool[Math.floor(Math.random()*pool.length)].t;
    n++;
    if(n > SCRAMBLE_STEPS){
      const pick = pool[Math.floor(Math.random()*pool.length)];
      S.topic = pick.t; S.topicCat = pick.c;
      const tt = $('topicText'); tt.textContent = pick.t; tt.className = 'topic-text settle';
      $('topicCat').textContent = pick.c;
      hero.classList.remove('scrambling'); hero.classList.add('settled');
      $('toPrepBtn').classList.add('show');
      resetNotes(S.otTpl || 'three');   // 换题就换笔记，保留上次选的骨架
      sfxLand();
      return;
    }
    sfxTick(0.55 + 0.5 * n / SCRAMBLE_STEPS);   // 越接近结果越响
    scrambleTimer = setTimeout(step, 60 + Math.round(140 * Math.pow(n/SCRAMBLE_STEPS, 2.2)));
  };
  scrambleTimer = setTimeout(step, 60);
}

/* ================= 备稿 ================= */
function buildDurRow(){
  const row = $('durRow');
  row.querySelectorAll('.dur-btn').forEach(b=>b.remove());
  (TRAIN().prep_durations||[5,10,20,30]).forEach(m=>{
    const b = document.createElement('button');
    b.className = 'dur-btn' + (S.prepTotal===m*60?' on':''); b.textContent = m+'m';
    b.onclick = ()=>{ if(S.prepTimer) return; S.prepTotal=m*60; S.prepLeft=m*60; buildDurRow(); renderPrep(); };
    row.appendChild(b);
  });
}
function renderPrep(){
  const cd = $('prepCountdown');
  cd.textContent = fmt(S.prepLeft);
  cd.classList.toggle('warn', S.prepLeft<=60 && S.prepLeft>0);
  $('prepBarFill').style.transform = 'scaleX('+(S.prepTotal?S.prepLeft/S.prepTotal:1)+')';
}
/* 备稿时间到后的自动开讲倒计时：倒数结束直接 startSpeak；手动点开讲会取消它 */
function cancelAutoStart(){
  clearInterval(S.autoTimer); S.autoTimer = null;
  $('autoStartTip').hidden = true;
}
function startAutoStart(){
  cancelAutoStart();
  const sec = Math.max(0, +(TRAIN().auto_start_sec ?? 5) || 0);
  const tip = $('autoStartTip');
  if(sec <= 0){ tip.hidden = true; return; }        // 0 = 不自动开讲
  let left = sec;
  tip.hidden = false;
  tip.innerHTML = `<b>${left}</b> 秒后自动开讲`;
  S.autoTimer = setInterval(()=>{
    left--;
    if(left <= 0){
      cancelAutoStart();
      // 兜底：万一期间点了换题/重抽，别在别的页面上硬开讲
      const onPrep = $('stage-prep').classList.contains('active');
      if(!S.speaking && onPrep) startSpeak();
      return;
    }
    tip.innerHTML = `<b>${left}</b> 秒后自动开讲`;
  }, 1000);
}
function startPrep(){
  if(S.prepTimer) return;
  $('startPrepBtn').disabled = true; $('startPrepBtn').textContent = '备稿中…';
  S.prepTimer = setInterval(()=>{
    S.prepLeft--; renderPrep();
    if(S.prepLeft<=0){ clearInterval(S.prepTimer); S.prepTimer=null;
      $('timeupNote').classList.add('show');
      $('startSpeakBtn').textContent='时间到 · 立即开讲';
      // 时间到后，主操作转移到"开讲"
      $('startPrepBtn').classList.remove('primary-action');
      $('startSpeakBtn').classList.add('primary-action');
      startAutoStart(); }
  },1000);
  renderPrep();
}
function enterPrep(){
  $('prepTopic').textContent = S.topic; $('prepCat').textContent = S.topicCat;
  S.prepLeft = S.prepTotal;
  $('timeupNote').classList.remove('show');
  $('startPrepBtn').disabled=false; $('startPrepBtn').textContent='开始倒计时';
  $('startPrepBtn').classList.add('primary-action');
  $('startSpeakBtn').classList.remove('primary-action');
  $('startSpeakBtn').textContent='跳过备稿，直接开讲';
  clearInterval(S.prepTimer); S.prepTimer=null;
  cancelAutoStart();
  if(!S.outline || !S.outline.length) resetNotes('three');
  renderPrep(); setPhase('prep');
  // 备稿有 5~10 分钟，正好把 9 秒级的模型加载藏在这里做完，开讲时就不用等了
  if(S.cfg.speech.engine === 'sherpa' || S.cfg.speech.engine === 'whisper')
    api.post('/api/speech/warmup', {}).then(()=>{ S.warmed = true; }).catch(()=>{});
}

/* ================= 备稿提纲 ================= */
const OT_KINDS = [
  {k:'c', name:'结论', ph:'一句话结论'},
  {k:'p', name:'支撑', ph:'一条理由或依据'},
  {k:'x', name:'例子', ph:'具体的人 / 事 / 数字'},
  {k:'e', name:'收尾', ph:'最后一句怎么收'},
  {k:'n', name:'备注', ph:'随时想到的'},
];
const OT_NAME = OT_KINDS.reduce((m,o)=>(m[o.k]=o.name, m), {});
const OT_PH   = OT_KINDS.reduce((m,o)=>(m[o.k]=o.ph, m), {});
const OT_TPLS = { three:['c','p','p','p','e'], prep:['c','p','x','e'], psr:['n','p','c','e'], story:['n','n','n','e'] };
const OT_LONG = 24;      // 单条超过这个字数就标黄：那是在写整句，不是在记要点
let otDrag = null, otAfter = false;

function resetNotes(tpl){
  const rows = OT_TPLS[tpl];
  S.outline = (rows || OT_TPLS.three).map(k=>({k, v:''}));
  S.otTpl = rows ? tpl : '';
  const ta = $('notesArea'); if(ta) ta.value = '';
  renderOutline();
}
function otFilled(){ return (S.outline||[]).filter(r=>r.v.trim()).length; }
function outlineText(){
  return (S.outline||[]).filter(r=>r.v.trim()).map(r=>`${OT_NAME[r.k]||''} · ${r.v.trim()}`).join('\n');
}
function notesText(){
  const a = outlineText(), b = ($('notesArea').value||'').trim();
  return [a,b].filter(Boolean).join('\n\n');
}
function otCount(){
  const n = otFilled();
  const chars = (S.outline||[]).reduce((s,r)=>s+r.v.trim().length, 0) + ($('notesArea').value||'').trim().length;
  $('notesCount').textContent = `${n}/${(S.outline||[]).length} 条 · ${chars} 字`;
}
function otFocus(i){
  const els = document.querySelectorAll('.ot-row .ot-text');
  if(els[i]) els[i].focus();
}
function otClearOver(){ document.querySelectorAll('.ot-row').forEach(r=>r.classList.remove('ot-over-t','ot-over-b')); }
function syncTplChips(){
  document.querySelectorAll('#otTpl .ot-chip').forEach(c=>{
    if(c.dataset.tpl === 'clear') return;
    c.classList.toggle('on', c.dataset.tpl === S.otTpl);
  });
}
function renderOutline(){
  const list = $('otList');
  list.innerHTML = '';
  S.outline.forEach((r,i)=>{
    const row = document.createElement('div');
    row.className = 'ot-row'; row.dataset.i = i;
    row.innerHTML =
      '<span class="ot-grip" title="拖动排序">≡</span>' +
      '<select class="ot-kind">' + OT_KINDS.map(o=>`<option value="${o.k}"${o.k===r.k?' selected':''}>${o.name}</option>`).join('') + '</select>' +
      '<input class="ot-text" type="text">' +
      '<button class="ot-del" title="删除这行">×</button>';
    const inp = row.querySelector('.ot-text');
    inp.value = r.v; inp.placeholder = OT_PH[r.k] || '';
    if(r.v.trim().length > OT_LONG) inp.classList.add('long');

    row.querySelector('.ot-kind').onchange = e=>{
      r.k = e.target.value; S.otTpl = ''; syncTplChips();
      inp.placeholder = OT_PH[r.k] || '';
    };
    inp.oninput = e=>{
      r.v = e.target.value;
      inp.classList.toggle('long', r.v.trim().length > OT_LONG);
      otCount();
    };
    inp.onkeydown = e=>{
      if(e.key === 'Enter'){
        e.preventDefault();
        S.outline.splice(i+1, 0, {k:r.k, v:''}); S.otTpl = '';
        renderOutline(); otFocus(i+1);
      }else if(e.key === 'Backspace' && !r.v && S.outline.length > 1){
        e.preventDefault();
        S.outline.splice(i,1); renderOutline(); otFocus(Math.max(0, i-1));
      }else if(e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
        e.preventDefault();
        const j = e.key === 'ArrowUp' ? i-1 : i+1;
        if(j < 0 || j >= S.outline.length) return;
        const t = S.outline[j]; S.outline[j] = S.outline[i]; S.outline[i] = t;
        renderOutline(); otFocus(j);
      }
    };
    row.querySelector('.ot-del').onclick = ()=>{
      if(S.outline.length <= 1) S.outline = [{k:'c', v:''}];
      else S.outline.splice(i,1);
      S.otTpl = ''; renderOutline();
    };
    // 只有按住左侧把手才允许拖，避免在输入框里选字被误拖
    const grip = row.querySelector('.ot-grip');
    grip.addEventListener('mousedown', ()=>{ row.draggable = true; });
    grip.addEventListener('mouseup', ()=>{ row.draggable = false; });
    row.addEventListener('dragstart', e=>{
      otDrag = i; row.classList.add('drag');
      e.dataTransfer.effectAllowed = 'move';
      try{ e.dataTransfer.setData('text/plain', r.v); }catch(_){}
    });
    row.addEventListener('dragend', ()=>{ otDrag = null; row.draggable = false; row.classList.remove('drag'); otClearOver(); });
    row.addEventListener('dragover', e=>{
      if(otDrag === null || otDrag === i) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      otAfter = (e.clientY - rect.top) > rect.height/2;
      otClearOver(); row.classList.add(otAfter ? 'ot-over-b' : 'ot-over-t');
    });
    row.addEventListener('drop', e=>{
      if(otDrag === null) return;
      e.preventDefault();
      const from = otDrag;
      let to = otAfter ? i+1 : i;
      if(from < to) to--;
      otDrag = null; otClearOver();
      if(to === from) return;
      S.outline.splice(to, 0, S.outline.splice(from,1)[0]);
      S.otTpl = ''; renderOutline();
    });
    list.appendChild(row);
  });
  otCount(); syncTplChips();
}
$('notesArea').addEventListener('input', otCount);
$('otAddBtn').onclick = ()=>{
  const last = S.outline[S.outline.length-1];
  S.outline.push({k: last ? last.k : 'c', v:''});
  S.otTpl = ''; renderOutline(); otFocus(S.outline.length-1);
};
$('otTpl').addEventListener('click', e=>{
  const b = e.target.closest('.ot-chip'); if(!b) return;
  const t = b.dataset.tpl;
  if(t === 'clear'){
    if(otFilled() || ($('notesArea').value||'').trim()) resetNotes(S.otTpl || 'three');
    return;
  }
  resetNotes(t);
});

/* ================= 自定义命题（默认落在「自定义」分类，可改到任意分类） ================= */
const NEW_CAT = '__new__';            // 下拉里"新建分类"那一项的标记值
function bankCats(){
  const cats = Object.keys(S.bank || {});
  if(!cats.includes('自定义')) cats.push('自定义');
  return cats;
}
function fillCatSelect(sel, cur){
  sel.innerHTML = bankCats().map(c=>`<option value="${esc(c)}"${c===cur?' selected':''}>${esc(c)}</option>`).join('')
                + `<option value="${NEW_CAT}">＋ 新建分类…</option>`;
}
/* 新建分类：问一个名字；取消就退回原分类 */
function askNewCat(fallback){
  const name = (prompt('新分类名') || '').trim();
  return name || fallback;
}
async function addCustom(){
  const v = $('customInput').value.trim();
  if(!v) return;
  let cat = $('customCat').value;
  if(cat === NEW_CAT) cat = askNewCat('自定义');
  const bank = {...S.bank};
  bank[cat] = [...(bank[cat]||[]), v];
  try{
    S.bank = await api.put('/api/bank', bank);
    $('customInput').value = '';
    renderCustom(); buildCatChips();
  }catch(e){ toast('保存失败：'+e.message); }
}
/* 把「自定义」里第 i 条挪到另一个分类；挪完如果「自定义」空了就把这个分类去掉，
   免得抽题页留下一个点开是空的分类 */
async function moveCustom(i, to){
  const bank = {...S.bank};
  const t = (bank['自定义']||[])[i];
  if(t === undefined || to === '自定义') return;
  bank['自定义'] = bank['自定义'].filter((_,k)=>k!==i);
  if(!bank['自定义'].length) delete bank['自定义'];
  bank[to] = [...(bank[to]||[]), t];
  try{ S.bank = await api.put('/api/bank', bank); renderCustom(); buildCatChips(); }
  catch(e){ toast('保存失败：'+e.message); }
}
async function delCustom(i){
  const bank = {...S.bank};
  bank['自定义'].splice(i,1);
  if(!bank['自定义'].length) delete bank['自定义'];
  try{ S.bank = await api.put('/api/bank', bank); renderCustom(); buildCatChips(); }
  catch(e){ toast('删除失败：'+e.message); }
}
function renderCustom(){
  const ul = $('customList'); ul.innerHTML = '';
  fillCatSelect($('customCat'), '自定义');
  const list = S.bank['自定义'] || [];
  if(!list.length){ ul.innerHTML = '<div class="custom-empty">暂无自定义命题</div>'; return; }
  list.forEach((t,i)=>{
    const li = document.createElement('li');
    li.innerHTML = `<span class="ct">${esc(t)}</span><select class="cc"></select><button class="del">移除</button>`;
    const sel = li.querySelector('.cc');
    fillCatSelect(sel, '自定义');
    sel.onchange = ()=>{
      const to = sel.value === NEW_CAT ? askNewCat('自定义') : sel.value;
      if(to === '自定义'){ sel.value = '自定义'; return; }
      moveCustom(i, to);
    };
    li.querySelector('.del').onclick = ()=>delCustom(i);
    ul.appendChild(li);
  });
}

/* ================= 模式注册 ================= */
registerMode({
  id: 'extemp',
  name: '命题演讲',
  phases: ['draw','prep','speak','result'],
  speak: {peek: true, source: false, recLabel: 'REC · 不低头 · 不看稿', stuckPenalty: true},

  enter(){ setPhase('draw'); },
  homeLabel: '回到抽题',
  again(){ setPhase('draw'); draw(); },

  /* 结算：算分 + 指标卡 + 要存进历史的字段 */
  async end(dur){
    const T = TRAIN();
    let score = Math.max(0, T.base_score - S.peek*T.peek_penalty - S.hint*(T.hint_penalty ?? 5)
                            - (S.stuckPenalty || 0));
    let fillerNote = '';
    if(S.transcript.trim()){
      S.stats = await api.post('/api/analyze/words', {transcript: S.transcript, duration_sec: dur});
      if(T.filler_scoring){
        const fpm = S.stats.categories.filler.per_minute;
        if(fpm > T.filler_threshold){
          const extra = Math.floor((fpm - T.filler_threshold) * (dur/60) / 2);
          score = Math.max(0, score - extra);
          fillerNote = `填充词超限另扣 ${extra} 分`;
        }
      }
    }
    closeStuck();                       // 讲完时还卡着的那次也算进去
    let stuckNote = '';
    if(S.stuckPenalty) stuckNote = ` · 卡壳 −${S.stuckPenalty} 分（${S.stuck} 次）`;
    const rating = score>=95?'脱稿如流':score>=85?'小有磕绊':score>=70?'依赖明显':'重在参与';
    const chars = S.transcript.replace(/\s/g,'').length;
    return {
      score, rating,
      rule: `基础 ${T.base_score} · 看稿 −${T.peek_penalty}/次 · 提示 −${T.hint_penalty ?? 5}/次` + (fillerNote?' · '+fillerNote:'') + stuckNote,
      cells: [
        {v: Math.floor(dur/60)+':'+String(dur%60).padStart(2,'0'), k:'时长'},
        {v: dur >= 10 ? Math.round(chars/(dur/60)) : '—', k:'语速'},
        {v: S.stuck, k:'卡壳', pen:true},
        {v: S.stuck ? fmt(Math.round(S.stuckMs/1000/S.stuck)) : '0:00', k:'平均卡壳', pen:true},
        {v: fmt(Math.round(S.stuckMs/1000)), k:'卡壳总时长', pen:true},
        {v: S.peek, k:'看稿', pen:true},
        {v: S.hint, k:'提示', pen:true},
      ],
      entry: {peek: S.peek, hint: S.hint, stuck: S.stuck, stuck_ms: S.stuckMs,
              stuck_penalty: S.stuckPenalty || 0},
    };
  },

  /* 对比上一场：命题演讲看分数 / 语速 / 卡壳 / 口头禅 / 词汇密度 */
  metricsOf(h){
    const st = h?.stats || {}, cat = st.categories || {};
    const mins = Math.max(1/60, +(h?.dur || 0) / 60);
    const wc = (cat.filler?.count||0) + (cat.hedging?.count||0) + (cat.vague?.count||0);
    return {
      score: +(h?.score ?? 0),
      wpm: Math.round(+(st.chars_per_minute ?? 0) || 0),
      stuck: +(h?.stuck ?? 0),
      habit: (st.habits||[]).length ? Math.max(...st.habits.map(x=>+(x.count||0))) : 0,
      density: Math.round(wc / mins * 10) / 10,
    };
  },
  curMetrics(){
    const st = S.stats || {};
    return this.metricsOf({
      score: +($('scoreNum')?.textContent || 0),
      dur: Math.round(speakSec()),
      stuck: S.stuck,
      stats: {categories: st.categories || {}, habits: st.habits || {},
              chars_per_minute: st.chars_per_minute || 0},
    });
  },
  compareRows: [
    {k:'分数',     a:'score',   p:'score',   u:'',     better:'high', eps:0.5},
    {k:'语速',     a:'wpm',     p:'wpm',     u:'字/分', better:'none', eps:5},
    {k:'卡壳',     a:'stuck',   p:'stuck',   u:'次',   better:'low',  eps:0.5},
    {k:'口头禅',   a:'habit',   p:'habit',   u:'次',   better:'low',  eps:0.5},
    {k:'词汇密度', a:'density', p:'density', u:'次/分', better:'low',  eps:0.3},
  ],
});
