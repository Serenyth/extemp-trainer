/* 开讲页的实时层：字稿渲染与本地统计。不经过后端，500ms 一次随计时器刷新 */
/* 开讲页左侧图例：与结束页 mark-legend 一样可点击开关标记 */
function renderLiveLegend(){
  const box = $('liveLegend'); if(!box) return;
  box.innerHTML = '';
  const cnt = S.liveCnt || {filler:0, hedging:0, vague:0};
  LEGEND.forEach(l=>{
    const item = document.createElement('div');
    item.className = 'legend-item' + (legendOn[l.cat]?'':' off');
    item.title = legendOn[l.cat] ? '点击隐藏该类标记' : '点击显示该类标记';
    const col = getComputedStyle(document.documentElement).getPropertyValue(l.colorVar);
    item.innerHTML = `<span class="sw" style="background:${col}"></span>${l.name} <b>${cnt[l.cat]||0}</b>`;
    item.onclick = ()=>{
      legendOn[l.cat] = !legendOn[l.cat];
      renderLiveLegend(); renderSubtitle();
    };
    box.appendChild(item);
  });
}
/* 字稿渲染：定稿文本 + 正在说的预览（预览会被定稿覆盖）；可按句换行 */
function renderSubtitle(){
  const box = $('subtitleBox');
  const nl = (S.cfg.display||{}).sentence_newline !== false;
  let body;
  if(nl && (S.transcript || S.partial)){
    const blocks = sentenceBlocks(S.transcript).map(b=>`<div class="sent">${escWithMarks(b.text)}</div>`);
    const ph = partialHtml(S.partial);
    if(ph) blocks.push(`<div class="sent">${ph}<span class="cursor"></span></div>`);
    else if(blocks.length) blocks[blocks.length-1] = blocks[blocks.length-1].replace(/<\/div>$/, '<span class="cursor"></span></div>');
    body = blocks.join('');
  } else {
    body = (S.transcript ? escWithMarks(S.transcript) : '<span class="ph">实时转写</span>')
         + partialHtml(S.partial) + '<span class="cursor"></span>';
  }
  box.innerHTML = body;
  box.scrollTop = box.scrollHeight;
}
function partialHtml(text){
  if(!text) return '';
  const prev = S._lastPartial || '';
  // 与上一条预览的公共前缀保持不动，只让新增的字淡入 → 观感接近逐字流式
  const html = (prev && text.startsWith(prev) && text.length > prev.length)
    ? escWithMarks(prev) + '<span class="fresh">' + esc(text.slice(prev.length)) + '</span>'
    : escWithMarks(text);
  return '<span class="partial">' + html + '</span>';
}
/* 扣到一次就让那块闪一下：扣分这种事得当场看见，不然只体现在分数上太隐蔽 */
function flashStuckPen(){
  const sb = $('stuckPenBtn');
  if(!sb) return;
  sb.classList.remove('hit'); void sb.offsetWidth; sb.classList.add('hit');
}
/* 有新字出来 = 正在讲：刷新"最后一次出字"的时间戳，还开着的那次卡壳就此闭合 */
function noteSpeech(){
  const now = Date.now();
  S.lastTextAt = now;
  if(S.stuckOpen) closeStuck();
}
function pushFinal(text){
  if(!text) return;
  S.transcript += text;
  S.partial = ''; S._lastPartial = '';
  renderSubtitle();
  enqueueSentences(text);
  noteSpeech();
  updateLiveStats();
}
function pushPartial(text, ver){
  if(!text) return;
  if(typeof ver === 'number' && ver < (S._finalVer || 0)) return;   // 过期预览直接丢弃
  if(text === S.partial) return;                                    // 没变化就别重建 DOM
  S.partial = text;
  renderSubtitle();
  S._lastPartial = text;
  noteSpeech();
}
/* 实时统计（本地轻量统计，无需往返后端） */
function updateLiveStats(){
  const t = S.transcript;
  const dur = S.speakStart ? speakSec() : S.speakElapsed/1000;
  const chars = t.replace(/\s/g,'').length;
  const marks = matchMarks(t);
  const cnt = {filler:0, hedging:0, vague:0};
  marks.forEach(m=>cnt[m.cat]++);
  // 当前分：基础分 − 看稿/提示/卡壳的扣分，边讲边变（填充词扣分要等结算才算）
  const T = TRAIN();
  const score = Math.max(0, T.base_score - S.peek*T.peek_penalty
                             - S.hint*(T.hint_penalty ?? 5) - (S.stuckPenalty || 0));
  const row = $('lsScoreRow');
  if(row){
    $('lsScore').textContent = score;
    row.classList.toggle('warn', score < T.base_score && score >= T.base_score*0.7);
    row.classList.toggle('bad', score < T.base_score*0.7);
  }
  $('lsChars').textContent = chars;
  // 语速：不足 10 秒的样本没意义，先显示占位
  $('lsWpm').textContent = dur >= 10 ? Math.round(chars / (dur/60)) : '—';
  // 卡壳：还没闭合的那次也算进次数与总时长，否则显示会慢一拍
  const st = S.stuck + (S.stuckOpen ? 1 : 0);
  const ms = S.stuckMs + (S.stuckOpen ? Date.now() - S.stuckFrom : 0);
  $('lsStuck').textContent = st;
  $('lsStuckAvg').textContent = st ? fmt(Math.round(ms/1000/st)) : '0:00';
  $('lsStuckTot').textContent = fmt(Math.round(ms/1000));
  // 开了卡壳扣分才显示这一行（朗读、自由说没有这一项）
  const penRow = $('lsStuckPenRow');
  if(penRow){
    penRow.hidden = !stuckPenaltyOn();
    $('lsStuckPen').textContent = '−' + (S.stuckPenalty || 0);
  }
  // 扣分按钮旁边那块：卡壳不是按钮，是一块会自己变多的计数
  const sb = $('stuckPenBtn');
  if(sb){
    sb.hidden = !stuckPenaltyOn();
    const per = +TRAIN().stuck_penalty || 0;
    $('stuckPenRule').textContent = `− ${per} / ${stuckPenaltySec()} 秒`;
    const times = per ? Math.round((S.stuckPenalty || 0) / per) : 0;
    $('stuckPenCount').textContent = times ? '×' + times : '';
  }
  $('lsFiller').textContent = cnt.filler;
  $('lsHedge').textContent = cnt.hedging;
  $('lsVague').textContent = cnt.vague;
  S.liveCnt = cnt;
  renderLiveLegend();
  const counts = {};
  const tokens = t.match(/[\u4e00-\u9fff]{2,4}/g) || [];
  tokens.forEach(w=>counts[w] = (counts[w]||0)+1);
  const habits = Object.entries(counts).filter(([w,c])=>c>=3)
    .sort((a,b)=>b[1]-a[1]).slice(0,3);
  $('lsHabits').innerHTML = habits.length
    ? '高频：' + habits.map(([w,c])=>`${w}·${c}`).join('  ') : '';
}
