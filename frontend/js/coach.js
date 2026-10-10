/* 表达提示：本地即时信号 + AI 段落建议
   说话过程中不能给长文点评（没人会去看），只给一句话的方向提醒，挂在字稿正下方。
   两种来源：本地信号（0 延迟、0 token：语速/口头禅密集）与 AI 段落建议（跑题/缺例子/方向）。 */
let coachQueue = [], coachBusy = false, coachOn = true, coachSeen = new Set(), coachCount = 0;
let hintLock = 0, lastHintText = '';
const signalCd = {};        // 单个本地信号的冷却时间戳，避免一直重复同一条
function coachCfg(){
  const c = S.cfg?.coach || {};
  return {every: Math.max(1, +c.every || 3), minChars: Math.max(2, +c.min_chars || 8)};
}
function enqueueSentences(chunk){
  // 用累积的尾部逐字扫描句末标点
  const tail = S.transcript.slice(S._scanned || 0);
  const {every, minChars} = coachCfg();
  let lastCut = 0;
  for(let i = 0; i < tail.length; i++){
    const ch = tail[i];
    if('。！？；!?;'.includes(ch)){
      const sent = tail.slice(lastCut, i + 1).trim();
      if(sent.length >= 4 && !coachSeen.has(sent)){
        coachSeen.add(sent);
        // 频率与最短句长过滤：太短的碎片不点评，按 every 隔几句才送一次 AI
        if(sent.replace(/[。！？；!?;]/g,'').length >= minChars){
          coachCount++;
          if(every <= 1 || coachCount % every === 0) coachQueue.push(sent);
        }
      }
      lastCut = i + 1;
    }
  }
  S._scanned = (S._scanned || 0) + lastCut;
  pumpCoach();
}
async function pumpCoach(){
  if(coachBusy || !coachOn || !coachQueue.length) return;
  if(S.cfg.coach?.enabled === false) return;        // 关掉实时 AI 提示：本地信号照常
  // 面试模式：面试官正在听你说话，屏幕上不该自己弹提示（而且面试里也没有人给你递小抄）。
  // 本地信号（语速/口头禅）不受影响，见 checkLocalSignals
  if((curMode().speak || {}).coach === false) return;
  if(!(S.cfg.ai.base_url && S.cfg.ai.model)) return;
  coachBusy = true;
  coachQueue.shift();                       // 段落本身的文本已含在下发的 recent 里
  try{
    const r = await api.post('/api/analyze/hint', {
      topic: S.topic,
      recent: S.transcript.slice(-220),
      hints: (S.hintsGiven||[]).slice(-4),
      mode: S.mode, reference: aiReference(),
    });
    if(r.hint){ S.hintsGiven.push(r.hint); showHint(r.hint, r.kind || '提示'); }
  }catch(e){ /* AI 不可用就静默跳过，本地信号照常工作 */ }
  coachBusy = false;
  if(coachQueue.length) setTimeout(pumpCoach, 1500);   // 节流：两次 AI 呼叫之间留出间隔
}
/* 本地即时信号：语速过快 / 口头禅密集。纯前端算，不经过 AI */
function checkLocalSignals(){
  if(!S.speaking || S.paused || S.readying) return;
  if(Date.now() < hintLock) return;         // 当前这条还没展示够，别顶掉
  // 1) 语速：对最近 30 秒做滑动窗口，样本不足 15 秒不判断
  S._rate = S._rate || [];
  S._rate.push([Date.now(), S.transcript.length]);
  while(S._rate.length > 2 && Date.now() - S._rate[0][0] > 30000) S._rate.shift();
  const a = S._rate[0], b = S._rate[S._rate.length - 1];
  const dt = (b[0] - a[0]) / 1000, dc = b[1] - a[1];
  if(dt >= 15){
    const cpm = Math.round(dc / (dt / 60));
    const fast = +(TRAIN().wpm_fast ?? 330) || 330;
    const slow = +(TRAIN().wpm_slow ?? 0) || 0;
    if(cpm >= fast && Date.now() > (signalCd.wpm || 0)){
      signalCd.wpm = Date.now() + 60000;    // 同一信号 60 秒内不再提
      showHint(`语速 ${cpm} 字/分，试着放慢一点`, '语速', 'loc');
      return;
    }
    if(slow > 0 && cpm <= slow && Date.now() > (signalCd.wpmSlow || 0)){
      signalCd.wpmSlow = Date.now() + 60000;
      showHint(`语速 ${cpm} 字/分，偏慢了，把节奏提起来`, '语速', 'loc');
      return;
    }
  }
  // 2) 口头禅密集：最近 200 字里同一个词出现 N 次以上（N 可在设置里改）
  const recent = S.transcript.slice(-200);
  const dict = Object.values(S.words || {}).flat();
  const burst = Math.max(2, +(TRAIN().filler_burst ?? 3) || 3);
  for(const w of dict){
    if(!w) continue;
    const n = recent.split(w).length - 1;
    if(n >= burst && Date.now() > (signalCd[w] || 0)){
      signalCd[w] = Date.now() + 120000;
      showHint(`刚才连着说了 ${n} 次「${w}」`, '口头禅', 'loc');
      return;
    }
  }
}
/* 一次只显示一条：新的顶掉旧的，但至少要停留 6 秒。
   tone 决定颜色：loc=本地即时信号（红，语速/口头禅）
                 ai=AI 段落建议（琥珀，跑题/缺例子/结构）
                 dir=点「提示」换来的具体内容建议（蓝，停留更久、可手动点掉） */
function showHint(text, kind, tone, force){
  if(!text) return;
  const box = $('speakHint');
  if(!box) return;
  const now = Date.now();
  if(!force && now < hintLock && text !== lastHintText) return;
  $('hintKind').textContent = kind || '提示';
  $('hintText').textContent = text;
  box.classList.remove('loc', 'dir');
  if(tone === 'loc' || tone === 'dir') box.classList.add(tone);
  box.hidden = false;
  box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
  lastHintText = text; hintLock = now + 6000;
  clearTimeout(S.hintTimer); S.hintTimer = null;
  // 停留时长：方向提示用完整的 hint_sec（长一点，够读完）；段落建议/本地信号短一些，别占着位置
  const sec = +(S.cfg?.coach?.hint_sec ?? 24) || 0;
  const hold = tone === 'dir' ? sec : (sec === 0 ? 10 : Math.min(sec, 10));
  if(hold > 0) S.hintTimer = setTimeout(()=>{ box.hidden = true; }, hold * 1000);
}
function clearHint(){
  clearTimeout(S.hintTimer); S.hintTimer = null;
  const box = $('speakHint'); if(box) box.hidden = true;
  lastHintText = ''; hintLock = 0;
}
// 手动点掉：看完就收，不用干等自动消失
$('speakHint').addEventListener('click', ()=>{ clearHint(); });
/* 「提示」按钮：扣分换一条具体内容建议——卡壳时的主动求助。
   要点：把备稿笔记一并给 AI，它才知道"你本来打算讲什么、还剩什么没讲" */
async function tapHint(){
  S.hint++; $('hintCount').textContent = '×' + S.hint;
  const b = $('hintBtn'); b.classList.remove('pressed'); void b.offsetWidth; b.classList.add('pressed');
  if(!(S.cfg.ai.base_url && S.cfg.ai.model)){
    showHint('没配 AI，方向提示用不了', '提示', 'loc'); return;
  }
  // 想方向的时间不该算进你的表达时长：生成期间暂停，拿到就继续
  const autoPause = TRAIN().auto_pause !== false;
  const wasPaused = S.paused;
  const canPause = autoPause && S.speaking && !S.paused && !S.readying;
  if(canPause) await pauseSpeak();
  showHint('想方向中…', '方向', 'dir', true);   // 主动索取：顶掉当前这条，立刻显示
  try{
    const r = await api.post('/api/analyze/hint', {
      topic: S.topic, recent: S.transcript.slice(-220),
      hints: (S.hintsGiven||[]).slice(-4), manual: true, notes: notesText(),
      mode: (curMode() || {}).id, question: (typeof intvQ === 'string' ? intvQ : ''),
    });
    const t = r.hint || '接着刚才的例子再往深说一层';
    S.hintsGiven.push(t);
    showHint(t, r.kind || '方向', 'dir', true);         // dir=蓝色，跟段落建议区分
  }catch(e){
    showHint('AI 没回，按自己的节奏接着讲', '提示', 'loc');
  }
  // 面试里求助是有代价的：面试官看着你卡壳要方向，耐心往下掉（可在人设里关掉）
  if((curMode() || {}).id === 'interview' && typeof intvCostHint === 'function') intvCostHint();
  if(canPause && !wasPaused) resumeSpeak();
}
