/* 开讲阶段：计时、准备倒计时、暂停/继续、卡壳统计、看稿扣分
   这是通用阶段的引擎，各模式共用；扣分规则与「看稿」本身由模式决定 */
/* 累计「真正在说」的秒数：暂停的间隙不算进时长和语速 */
function speakSec(){
  return (S.speakElapsed + (S.speakStart ? Date.now()-S.speakStart : 0)) / 1000;
}
/* 准备倒计时：返回 Promise，倒数结束或被跳过时 resolve */
function runReadyCountdown(n){
  return new Promise(resolve=>{
    const ov = $('readyOverlay'), num = $('readyNum');
    let left = Math.max(1, n|0), done = false;
    const finish = ()=>{
      if(done) return; done = true;
      clearTimeout(S.readyTimer); S.readyTimer = null;
      ov.classList.remove('show');
      S.readying = false; S._skipReady = null;
      updateSpeakUI(); resolve();
    };
    const tick = ()=>{
      if(left <= 0){ finish(); return; }
      num.textContent = left;
      num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop');
      left--;
      S.readyTimer = setTimeout(tick, 1000);
    };
    S.readying = true; S._skipReady = finish;
    ov.onclick = finish;
    updateSpeakUI();
    ov.classList.add('show');
    tick();
  });
}
/* 暂停 / 继续：录音与计时同时停走，识别先 flush 保证最后半句不丢 */
async function pauseSpeak(){
  if(!S.speaking || S.paused || S.readying) return;
  closeStuck();                     // 暂停前先把还开着的那次卡壳结算掉
  S.paused = true;
  S.speakElapsed += Date.now() - S.speakStart;   // 把当前这段结算进累计时长
  S.speakStart = null;
  clearInterval(S.speakTimer); S.speakTimer = null;
  try{ if(S.recorder && S.recorder.state === 'recording') S.recorder.pause(); }catch(e){}
  await stopEngines(true);                        // 麦克风流保留在 S._stream，只是不再识别
  updateSpeakUI();
}
async function resumeSpeak(){
  if(!S.speaking || !S.paused) return;
  S.paused = false;
  S.speakStart = Date.now();
  S.lastTextAt = Date.now();        // 暂停的那段不算卡壳，从头计
  clearInterval(S.speakTimer);
  S.speakTimer = setInterval(speakTick, 500);
  try{ if(S.recorder && S.recorder.state === 'paused') S.recorder.resume(); }catch(e){}
  const engine = S.cfg.speech.engine;
  if(S._stream && engine !== 'none') startEngine(S._stream, engine);
  updateSpeakUI();
}
function updateSpeakUI(){
  const paused = S.paused, readying = S.readying;
  // 面试官还没开口（看简历 / 看这一轮 / 想下一问）时按「继续」没有意义，
  // 还会打断开场节奏。文案由模式给出，三种状态各说各的
  const lbl = typeof intvBusyLabel === 'function' ? intvBusyLabel() : '';
  const busy = !!lbl;
  const btn = $('pauseSpeakBtn');
  btn.textContent = paused ? '继续' : '暂停';
  btn.classList.toggle('paused', paused);
  btn.disabled = readying || !S.speaking || busy;
  $('recDot').classList.toggle('paused', (paused || readying) && !busy);
  const label = $('recLabel');
  const idle = ((curMode() || {}).speak || {}).recLabel || 'REC · 不低头 · 不看稿';
  label.textContent = busy ? lbl
                    : readying ? '准备中'
                    : (paused ? '已暂停 · 计时与录音已停' : idle);
  label.classList.toggle('paused', (paused || readying) && !busy);
}
/* 开讲页的模式差异：朗读要显示原文、没有「看稿」可扣；
   命题演讲相反。放进一个函数，免得散落在各处各改一半 */
function applySpeakMode(){
  const sp = (curMode() || {}).speak || {};
  // 面试模式要留着「提示」按钮（卡住时指个方向），但不能有「看稿」
  $('peekBtn').hidden = !sp.peek;
  $('hintBtn').hidden = sp.hint === false;
  $('penaltyCol').hidden = !sp.peek && sp.hint === false;
  // 「当前分」是按看稿/提示扣出来的：朗读恒为 100、自由练习根本没有分，
  // 所以让模式自己决定——换标签填实时值（朗读=完整度），或者整块收掉
  $('lsScoreRow').hidden = sp.score === false;
  const lbl = $('lsScoreRow') && $('lsScoreRow').querySelector('span');
  if(lbl) lbl.textContent = sp.scoreLabel || '当前分';
  // 题目行归模式管：面试没有「题目」，面板上就是面试官的问题，
  // 而 S.topic 还压着上一场命题演讲的题目，照写就会串场
  const tEl = $('speakTopic');
  const showTopic = sp.topic !== false;
  tEl.hidden = !showTopic;
  tEl.textContent = showTopic ? (S.topic || '') : '';
  // 面试专属：耐心条、看简历按钮、结束按钮文案
  $('patienceRow').hidden = !sp.patience;
  $('resumeBtn').hidden = !sp.resume;
  $('endSpeakBtn').textContent = sp.endLabel || '结束汇报';
  const src = $('readSource');
  if(sp.source){
    src.hidden = false;
    const m = curMode();
    src.innerHTML = m.source ? m.source() : '';
  } else { src.hidden = true; src.innerHTML = ''; }
}
/* 一场多轮时每轮的起点：整场的时长照常累计，本轮另算 */
function beginRound(){
  S._roundBase = S.speakElapsed / 1000;
  S._roundStuck = S.stuck;
  S.roundFrom = S.transcript.length;
  S.stuckOpen = false; S.lastTextAt = 0;
  S._probed = false;                // 本轮还没因为卡壳被面试官接过话
}
function roundSec(){ return Math.max(0, speakSec() - (S._roundBase || 0)); }
function roundStuck(){ return Math.max(0, S.stuck - (S._roundStuck || 0)); }
function roundText(){ return (S.transcript || '').slice(S.roundFrom || 0); }
/* 本场状态重置：一场训练开始时清一次。多轮模式只在第一轮走这里 */
function resetSpeakState(){
  S.peek=0; S.transcript=''; S.stats=null; S.analysis=null; S.report=null; S.entryId=null;
  S.stuck=0; S.stuckMs=0; S.stuckOpen=false; S.stuckFrom=0; S.lastTextAt=0;
  S.stuckPenalty=0; S._stuckPenN=0;   // 卡壳扣分：本场累计的分、已经扣到第几个区间
  S.partial=''; S._lastPartial=''; S._finalVer=0;
  S._scanned=0; coachQueue=[]; coachBusy=false; coachSeen=new Set(); coachCount=0;
  S.hint=0; S.hintsGiven=[]; S._rate=[];
  S.paused=false; S.speakElapsed=0; S.speakStart=null; S.readying=false; S._stream=null;
  S.roundFrom=0; S._roundBase=0; S._roundStuck=0; S._probed=false;
}
async function startSpeak(){
  if(S.speaking) return;            // 防重入：开讲中再点无效
  S.speaking = true;
  stopEngines();                    // 清掉可能残留的旧连接/旧采集器
  clearInterval(S.prepTimer); S.prepTimer = null;
  cancelAutoStart();                // 手动开讲：取消自动开讲倒计时
  resetSpeakState();
  clearHint();
  $('peekCount').textContent=''; $('hintCount').textContent='';
  // 题目行交给 applySpeakMode：面试没有题目，别把上一场命题演讲的题目带过来
  $('subtitleBox').innerHTML = '<span class="ph">实时转写</span>';
  applySpeakMode();                  // 原文面板 / 扣分按钮，按模式决定
  const engine = S.cfg.speech.engine;

  // 进入开讲先把实时统计清零：否则会残留上一轮的数字，
  // 一直显示到说出第一句话被转写结果覆盖为止
  updateLiveStats();
  $('speakTime').textContent = '00:00';
  setPhase('speak');                 // 先切到开讲页，倒计时才看得见
  updateSpeakUI();

  // 麦克风授权放在倒计时之前问：免得倒数结束后还卡在权限弹窗
  const audio = await setupAudio(engine);
  if(!S.speaking) return;            // 期间被结束

  // 引擎必须在倒计时之前起来（会 await 到后端回 ready）：
  // 首次加载模型 + 首帧预热要花掉一两秒，放在倒计时之后这笔时间就落在第一句话上，
  // 表现是"第一句要等说完才出字，后面才正常流式"
  if(audio){
    // 首次加载模型要 8~9 秒，这段时间页面上只有这一处在动，得做得足够显眼：
    // 描边 + 底色 + 转圈 + 呼吸，别只留一行小字
    const note = $('micNote'), txt = $('micNoteText'), noteText = txt.textContent;
    txt.textContent = S.warmed ? '识别准备中…' : '识别模型加载中…';
    note.classList.add('show', 'loading');
    S.loading = true;                  // 加载期间不送音频：送了也会被后端丢掉
    try{ await startEngine(audio, engine); }   // 返回 Promise：收到 ready / error 才放行
    finally{ S.loading = false; }
    note.classList.remove('show', 'loading');
    txt.textContent = noteText;
    if(!S.speaking) return;          // 加载期间点了结束汇报
  }

  // 面试模式不用「准备倒计时」：面试官问完会自己给思考时间，两个倒计时叠着很怪
  const sp = (curMode() || {}).speak || {};
  const ready = sp.ready === false ? 0 : (+(TRAIN().ready_countdown ?? 3) || 0);
  if(ready > 0){
    await runReadyCountdown(Math.min(30, ready));
    if(!S.speaking) return;          // 倒计时里点了结束汇报
  }

  beginRound();                     // 多轮模式的第 1 轮，从这里起算本轮时长
  S.speakStart = Date.now();
  clearInterval(S.speakTimer);
  S.speakTimer = setInterval(speakTick, 500);
  updateSpeakUI();
}

/* 开讲计时器每 500ms 打一次的点。开始和从暂停里恢复都只跑这一个，
   否则两处逻辑会慢慢走偏——面试模式的实时反应曾因为只在「开始」那条路上
   挂了 tickMode，导致答完第一题之后 intvTick 再也没被触发 */
function speakTick(){
  $('speakTime').textContent = fmt(speakSec());
  tickStuck();                  // 多久没出字算卡壳
  tickStuckPenalty();           // 卡壳当场扣分（命题演讲）
  updateLiveStats();
  checkLocalSignals();          // 语速/口头禅：本地算，跟着计时器走
  tickMode();                   // 模式自己的实时刷新（面试：沉默多久、要不要接话）
}

/* ---------------- 减分按钮 ---------------- */
/* 卡壳统计：多久没出新字算卡一次，累计次数与总时长；讲完时没闭合的那次也要结算
   判定秒数可以让模式自己定——面试里想 5 秒是常事，用演讲那套 3 秒会一直误判 */
function stuckSec(){
  const m = curMode();
  if(m && m.stuckSec) return Math.max(1, +m.stuckSec() || 3);
  return Math.max(1, +(TRAIN().stuck_sec ?? 3) || 3);
}
function tickStuck(){
  if(!S.speaking || S.paused || S.readying || !S.speakStart) return;
  const now = Date.now();
  // 开场还没出过字给 5 秒宽限：站在那儿想开场白不算卡壳
  if(!S.lastTextAt && now - S.speakStart < 5000) return;
  const base = S.lastTextAt || S.speakStart;
  if(!S.stuckOpen && now - base >= stuckSec()*1000){
    S.stuckOpen = true; S.stuckFrom = base;
  }
}
function closeStuck(){
  if(!S.stuckOpen) return;
  S.stuck++; S.stuckMs += Math.max(0, Date.now() - S.stuckFrom);
  S.stuckOpen = false;
}
/* ---------------- 卡壳扣分 ----------------
   命题演讲里「站着不说话」要当场扣分，不然脱稿训练最难的一环没有代价。
   沉默每跨过一个判定区间就扣一次：一直不吭声就一直扣，开口了重新计。
   只在这类按「扣分」算分的模式里生效（朗读、自由说不算分，不加这个） */
function stuckPenaltySec(){
  const T = TRAIN();
  return Math.max(1, +(T.stuck_penalty_sec) || +(T.stuck_sec) || 3);
}
function stuckPenaltyOn(){
  const m = curMode();
  if(!m || m.speak?.stuckPenalty !== true) return false;
  const T = TRAIN();
  return T.stuck_penalty_on !== false && (+T.stuck_penalty || 0) > 0;
}
function tickStuckPenalty(){
  if(!stuckPenaltyOn()) return;
  if(!S.speaking || S.paused || S.readying || !S.speakStart) return;
  const iv = stuckPenaltySec();
  const gap = Math.max(0, Date.now() - (S.lastTextAt || S.speakStart)) / 1000;
  if(gap < iv){ S._stuckPenN = 0; return; }   // 又开口了，从头计
  const n = Math.floor(gap / iv);
  const done = S._stuckPenN || 0;
  if(n <= done) return;
  // 一次 tick 里跨过多个区间（切后台、卡顿）就一次补全，别把欠的扣漏了
  S._stuckPenN = n;
  const per = +TRAIN().stuck_penalty || 0;
  S.stuckPenalty = (S.stuckPenalty || 0) + per * (n - done);
  toast(`卡壳 ${Math.round(gap)} 秒 · −${per * (n - done)} 分`);
  if(typeof flashStuckPen === 'function') flashStuckPen();
  updateLiveStats();
}
function tapPeek(){
  S.peek++; $('peekCount').textContent = '×'+S.peek;
  const b = $('peekBtn'); b.classList.remove('pressed'); void b.offsetWidth; b.classList.add('pressed');
  clearHint();                       // 看稿时把提示收掉，免得两条信息打架
  // 自动暂停：看稿期间不算你的表达时间，纸条收掉后自动继续
  const autoPause = TRAIN().auto_pause !== false;
  S._peekPaused = autoPause && S.speaking && !S.paused && !S.readying;
  if(S._peekPaused) pauseSpeak();
  const notes = notesText();
  $('paperNotes').innerHTML = notes ? esc(notes) : '<span class="p-empty">（备稿阶段没有记要点）</span>';
  $('paperPenalty').textContent = `已记为看稿一次 · −${TRAIN().peek_penalty} 分`;
  $('peekOverlay').classList.add('show');
  // 纸条停留多久可设置（看稿时长/次）；进度条动画时长跟着走
  const dur = Math.max(1, Math.min(30, +(TRAIN().peek_duration ?? 3) || 3));
  let left = dur; $('paperCountdown').textContent = left;
  const bar = $('paperBar');
  bar.style.transition='none'; bar.style.width='100%'; void bar.offsetWidth;
  bar.style.transition=`width ${dur}s linear`; bar.style.width='0%';
  clearInterval(S.peekTimer);
  S.peekTimer = setInterval(()=>{
    left--; $('paperCountdown').textContent = Math.max(left,0);
    if(left<=0){
      clearInterval(S.peekTimer); $('peekOverlay').classList.remove('show');
      if(S._peekPaused){ S._peekPaused = false; resumeSpeak(); }
    }
  },1000);
}
