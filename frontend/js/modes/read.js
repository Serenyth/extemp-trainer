/* 朗读练习模式：选材料 → 照着读 → 结算（漏读 / 错读 / 多读 / 重复）
   没有备稿阶段，也没有「看稿」扣分——朗读考的是准，不是脱稿 */
let artCat = '全部';
let artIdx = -1;                       // 选中的材料在 S.articles 里的下标
let artEditIdx = -1;                   // 正在编辑的下标；-1 = 新增模式

function artCats(){
  return ['全部', ...Array.from(new Set((S.articles || []).map(a => a.cat || '未分类')))];
}
/* 类型不单独维护：它就是每篇材料上的一个字段，分类列表从材料里算出来。
   改一篇的类型就等于改分类，写个新的就等于新建分类 */
function artCatNames(){
  return artCats().filter(c => c !== '全部');
}
function artVisible(){
  return (S.articles || [])
    .map((a, i)=>({a, i}))
    .filter(x => artCat === '全部' || (x.a.cat || '未分类') === artCat);
}
function renderArtChips(){
  const box = $('artCatChips');
  if(!box) return;
  box.innerHTML = '';
  artCats().forEach(c=>{
    const b = document.createElement('button');
    b.className = 'cat-chip' + (artCat === c ? ' on' : '');
    b.textContent = c;
    b.onclick = ()=>{ artCat = c; artIdx = -1; renderPick(); };
    box.appendChild(b);
  });
}
function renderArtList(){
  const box = $('artList');
  if(!box) return;
  box.innerHTML = '';
  const list = artVisible();
  $('toReadSpeakBtn').classList.toggle('ready', artIdx >= 0 && !!S.articles[artIdx]);
  if(!list.length){
    box.innerHTML = '<div class="art-empty">这一类还没有材料 · 在下面「管理材料」里加一篇</div>';
    $('artPreview').innerHTML = '<span class="art-ph">选一篇材料，照着它读一遍</span>';
    return;
  }
  list.forEach(({a, i})=>{
    const b = document.createElement('button');
    b.className = 'art-item' + (artIdx === i ? ' on' : '') + (artEditIdx === i ? ' editing' : '');
    b.innerHTML = `<span class="ai-t">${esc(a.title)}</span>`
                + `<span class="ai-n">${esc(a.cat || '未分类')} · ${(a.text || '').length} 字</span>`
                + '<span class="ai-edit" title="编辑这篇">编辑</span>';
    b.onclick = ()=>{ artIdx = i; renderPick(); };
    // 编辑按钮嵌在 button 里，得拦住冒泡，否则会同时触发"选中"
    b.querySelector('.ai-edit').onclick = e=>{ e.stopPropagation(); startEditArt(i); };
    box.appendChild(b);
  });
  const a = S.articles[artIdx];
  $('artPreview').innerHTML = a
    ? `<div class="ap-head">${esc(a.title)}<span>${esc(a.cat || '未分类')}</span></div>`
      + `<div class="ap-body">${esc(a.text)}</div>`
    : '<span class="art-ph">选一篇材料，照着它读一遍</span>';
}
function renderPick(){ renderArtChips(); renderArtList(); renderArtForm(); }

/* ---------- 材料的增删改 ---------- */
let artFormShown = null;               // 上次填的是哪个目标：'new' 或下标
function renderArtForm(){
  const dl = $('artCatList');
  if(dl) dl.innerHTML = artCatNames().map(c=>`<option value="${esc(c)}">`).join('');
  const ed = artEditIdx >= 0, a = ed ? S.articles[artEditIdx] : null;
  $('artFormTitle').textContent = ed ? '编辑：' + (a?.title || '') : '新增';
  $('artSaveBtn').textContent = ed ? '保存修改' : '添加';
  $('artCancelBtn').hidden = !ed;
  $('artDelBtn').hidden = !ed;
  // 只在编辑目标变了才重填：否则切个分类标签就把用户打了一半的草稿冲掉了
  const key = ed ? String(artEditIdx) : 'new';
  if(key === artFormShown) return;
  artFormShown = key;
  $('artTitle').value = a ? a.title : '';
  $('artCatInput').value = a ? (a.cat || '未分类') : '';
  $('artText').value = a ? a.text : '';
}
function startEditArt(i){
  artEditIdx = i; artIdx = i;
  $('artFold').classList.add('open');
  renderPick();
  $('artTitle').focus();
}
function cancelEditArt(){
  artEditIdx = -1;
  renderPick();
}
async function saveArt(){
  const title = $('artTitle').value.trim();
  const cat = $('artCatInput').value.trim() || '未分类';
  const text = $('artText').value.trim();
  if(!title || !text){ toast('标题和正文都要填'); return; }
  const list = (S.articles || []).slice();
  const ed = artEditIdx >= 0;
  if(ed) list[artEditIdx] = {title, cat, text};
  else list.push({title, cat, text});
  try{
    S.articles = await api.put('/api/articles', {articles: list});
    // 新增后选中它（后端会清洗字段，用标题+正文定位比用下标稳）
    artIdx = ed ? artEditIdx : (S.articles || []).findIndex(a => a.title === title && a.text === text);
    artEditIdx = -1;
    artCat = cat;                              // 跟进到该类型，免得看着"列表空了"
    renderPick();
    toast(ed ? '已保存修改' : '已添加');
  }catch(e){ toast('保存失败：' + e.message); }
}
async function delArt(){
  if(artEditIdx < 0) return;
  const a = S.articles[artEditIdx];
  if(!confirm(`删除「${a.title}」？不可恢复。`)) return;
  const list = (S.articles || []).slice();
  list.splice(artEditIdx, 1);
  try{
    S.articles = await api.put('/api/articles', {articles: list});
    // 删空了也不补内置材料：下次 load() 会把内置那套兜底塞回来，
    // 这是有意的兜底，别让手滑的人面对一个彻底空白的库
    if(S.article && S.article.title === a.title) S.article = null;
    artEditIdx = -1; artIdx = -1; artCat = '全部';
    renderPick();
    toast('已删除');
  }catch(e){ toast('删除失败：' + e.message); }
}

$('artSaveBtn').onclick = saveArt;
$('artCancelBtn').onclick = cancelEditArt;
$('artDelBtn').onclick = delArt;

function startRead(){
  const a = S.articles[artIdx];
  if(!a){ toast('先选一篇材料'); return; }
  S.article = a;
  S.topic = a.title;
  S.topicCat = '朗读 · ' + (a.cat || '未分类');
  startSpeak();
}

/* ================= 模式注册 ================= */
registerMode({
  id: 'read',
  name: '朗读练习',
  phases: ['read-pick', 'speak', 'result'],
  // 朗读没有「看稿」可扣，也不该提示——提示是命题演讲那套备稿逻辑带出来的
  speak: {peek: false, hint: false, source: true, recLabel: 'REC · 照着原文读', scoreLabel: '完整度'},

  enter(){ renderPick(); setPhase('read-pick'); },
  homeLabel: '换一篇',
  again(){ this.enter(); },

  /* 开讲时挂在字稿上方的原文：读到的字变暗、漏的标红、当前落点给游标 */
  source(){
    const ref = (S.article || {}).text || '';
    return alignSourceHtml(ref, S.transcript);
  },
  tick(){
    const src = $('readSource');
    const ref = (S.article || {}).text || '';
    // 实时完整度：开讲页的「当前分」是按看稿/提示扣的，朗读用不上，改成读到多少
    const el = $('lsScore');
    if(el && ref) el.textContent = S.transcript.trim() ? alignStats(ref, S.transcript).coverage + '%' : '—';
    if(!src || src.hidden || !S.article) return;
    const html = this.source();
    if(html === src._last) return;        // 转写没变化时别重排，省得每 500ms 刷一次 DOM
    src._last = html;
    src.innerHTML = html;
    const cur = src.querySelector('.al-cur');
    if(cur && cur.offsetTop) src.scrollTop = Math.max(0, cur.offsetTop - src.clientHeight / 2);
  },

  /* 给 AI 的参考原文：没有它，AI 只能凭感觉评，说不出漏在哪 */
  reference(){ return (S.article || {}).text || ''; },

  async end(dur){
    const ref = (S.article || {}).text || '';
    const a = alignStats(ref, S.transcript);
    if(S.transcript.trim()){
      S.stats = await api.post('/api/analyze/words', {transcript: S.transcript, duration_sec: dur});
    }
    if(!S.stats) S.stats = {};
    S.stats.align = a;                    // 存进历史：报告与「对比上一场」都读它

    const C = MODECFG();
    const lp = +(C.leak_penalty ?? 1), ep = +(C.err_penalty ?? 0.5), rp = +(C.repeat_penalty ?? 2);
    // 每一种扣分都封顶：漏读一大段不该把分数直接砸到 0，那样分数就没有区分度了
    const dm = Math.min(a.miss * lp, +(C.leak_cap ?? 40));
    const de = Math.min(a.err * ep, +(C.err_cap ?? 30));
    const dr = Math.min(a.repeat * rp, +(C.repeat_cap ?? 20));
    const score = Math.max(0, Math.round(100 - dm - de - dr));
    const rating = score >= 98 ? '一字不差' : score >= 92 ? '偶有出入'
                 : score >= 80 ? '还得再练' : '离原文有点远';
    const r1 = n => Math.round(n * 10) / 10;
    return {
      score, rating,
      rule: `完整度 ${a.coverage}% · 准确率 ${a.accuracy}%`
          + ` · 漏读 −${r1(dm)} · 错读 −${r1(de)} · 重复 −${r1(dr)}`,
      cells: [
        {v: Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0'), k: '时长'},
        {v: a.coverage + '%', k: '完整度'},
        {v: a.accuracy + '%', k: '准确率'},
        {v: a.miss, k: '漏读', pen: true},
        {v: a.err, k: '错读', pen: true},
        {v: a.add, k: '多读', pen: true},
        {v: a.repeat, k: '重复', pen: true},
      ],
      entry: {align: a},
      compareHtml: `<div class="rc-sum">原文 <b>${a.ref_len}</b> 字 · 读到 <b>${a.ref_len - a.miss}</b>`
        + ` · 漏读 <b class="pen">${a.miss}</b> · 错读 <b class="pen">${a.err}</b>`
        + ` · 多读 <b class="pen">${a.add}</b> · 重复 <b class="pen">${a.repeat}</b></div>`
        + `<div class="rc-body">${alignHtml(ref, S.transcript)}</div>`,
    };
  },

  /* 对比上一场：朗读看准确率 / 完整度 / 漏读 / 错读 / 重复 */
  metricsOf(h){
    const al = (h?.stats || {}).align || {};
    return {
      score: +(h?.score ?? 0),
      accuracy: +(al.accuracy ?? 0),
      coverage: +(al.coverage ?? 0),
      miss: +(al.miss ?? 0),
      err: +(al.err ?? 0),
      repeat: +(al.repeat ?? 0),
    };
  },
  curMetrics(){
    return this.metricsOf({score: +($('scoreNum')?.textContent || 0), stats: {align: (S.stats || {}).align || {}}});
  },
  compareRows: [
    {k: '准确率', a: 'accuracy', p: 'accuracy', u: '%', better: 'high', eps: 1},
    {k: '完整度', a: 'coverage', p: 'coverage', u: '%', better: 'high', eps: 1},
    {k: '漏读', a: 'miss', p: 'miss', u: '字', better: 'low', eps: 0.5},
    {k: '错读', a: 'err', p: 'err', u: '字', better: 'low', eps: 0.5},
    {k: '重复', a: 'repeat', p: 'repeat', u: '次', better: 'low', eps: 0.5},
  ],
});
