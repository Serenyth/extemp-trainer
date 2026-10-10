/* 启动与全局事件绑定。最后加载，此时其余模块都已就绪 */
$('drawBtn').onclick = draw;
$('toPrepBtn').onclick = enterPrep;
$('startPrepBtn').onclick = startPrep;
$('startSpeakBtn').onclick = startSpeak;
$('backDrawBtn').onclick = ()=>{ clearInterval(S.prepTimer); S.prepTimer=null; cancelAutoStart(); setPhase('draw'); };
$('peekBtn').onclick = tapPeek;
$('hintBtn').onclick = tapHint;
$('pauseSpeakBtn').onclick = ()=>{ S.paused ? resumeSpeak() : pauseSpeak(); };
$('endSpeakBtn').onclick = endSpeak;
$('toReadSpeakBtn').onclick = startRead;
$('freeStartBtn').onclick = startFree;
$('freeTopic').addEventListener('keydown', e=>{ if(e.key==='Enter') startFree(); });
/* 面试模式：挑简历 → 选人设 → 开面 */
$('intvToSetupBtn').onclick = ()=>{ setPhase('intv-setup'); renderPersonas(); renderIntvMeta(); };
$('intvBackBtn').onclick = ()=>{ setPhase('intv-resume'); renderResumes(); };
$('resumeSaveBtn').onclick = saveResume;
$('resumeCancelBtn').onclick = resetResumeForm;
$('resumeDelBtn').onclick = delResume;
$('resumeBtn').onclick = ()=>{
  if(!S.resume){ toast('这场没带简历'); return; }
  $('resumeViewText').textContent = S.resume.text;
  $('resumeViewTitle').textContent = S.resume.name;
  $('resumeView').classList.add('show');
};
$('resumeViewClose').onclick = ()=>$('resumeView').classList.remove('show');
$('personaSaveBtn').onclick = savePersona;
$('personaCancelBtn').onclick = resetPersonaForm;
$('personaDelBtn').onclick = delPersona;
$('pGenOpeningBtn').onclick = genOpening;
$('intvStartBtn').onclick = startInterview;
/* 结算页这两个按钮的意思随模式变：命题演讲是"回到抽题"，朗读是"换一篇" */
$('againBtn').onclick = ()=>{ const m = curMode(); (m.again || m.enter).call(m); };
$('homeBtn').onclick = ()=>curMode().enter();
$('customAddBtn').onclick = addCustom;
$('customInput').addEventListener('keydown', e=>{ if(e.key==='Enter') addCustom(); });
$('clearBtn').onclick = async ()=>{
  if(!confirm('确定清空全部训练记录与报告？不可恢复。')) return;
  await api.post('/api/history/clear-all', {});
  renderDrawer(); toast('已清空');
};
document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){
    closeDrawer('settingsDrawer'); closeDrawer('drawer');
    $('peekOverlay').classList.remove('show'); clearInterval(S.peekTimer);
  }
  // 准备倒计时期间：空格/回车跳过，直接进入正式开讲
  if(S.readying && (e.code==='Space' || e.code==='Enter')){
    e.preventDefault();
    if(S._skipReady) S._skipReady();
  }
});

/* ================= 模式切换 ================= */
/* 顺序按注册顺序来，新增模式不用改这里 */
function renderModeSwitch(){
  const box = $('modeSwitch');
  box.innerHTML = '';
  Object.values(MODES).forEach(m=>{
    const b = document.createElement('button');
    b.className = 'mode-btn' + (m.id === S.mode ? ' on' : '');
    b.textContent = m.name;
    b.dataset.mode = m.id;
    b.onclick = ()=>switchMode(m.id);
    box.appendChild(b);
  });
}
async function switchMode(id){
  if(!MODES[id] || id === S.mode) return;
  // 训练进行中切模式会丢掉这一场，先问一句；真要切就硬停，不留半开的录音
  if(S.speaking && !confirm('本场还没结束，切换模式会丢弃这一场。确定吗？')) return;
  stopEngines();
  clearInterval(S.speakTimer); S.speakTimer = null;
  clearInterval(S.prepTimer); S.prepTimer = null;
  clearInterval(S.autoTimer); S.autoTimer = null;
  S.speaking = false; S.paused = false; S.readying = false;
  S.speakStart = null; S.speakElapsed = 0;
  S.prepLeft = S.prepTotal;
  S.mode = id;
  const m = MODES[id];
  $('homeBtn').textContent = m.homeLabel || '回到开头';
  renderModeSwitch();
  m.enter();
}

/* ================= 启动 ================= */
(async function init(){
  try{
    [S.cfg, S.bank, S.words, S.articles, S.resumes, S.personas] = await Promise.all([
      api.get('/api/config'), api.get('/api/bank'), api.get('/api/words'),
      api.get('/api/articles'), api.get('/api/resumes'), api.get('/api/personas')]);
    S.persona = (S.personas || []).find(p=>p.id === ((S.cfg?.modes||{}).interview||{}).persona)
             || (S.personas || [])[0] || null;
  }catch(e){
    document.body.innerHTML = '<div style="padding:60px;font-family:monospace;color:#E24B4A;text-align:center">后端未启动。<br><br>请运行 backend 目录下：<br>venv\\Scripts\\python -m uvicorn main:app --host 0.0.0.0 --port 8642</div>';
    return;
  }
  S.prepTotal = (TRAIN().prep_durations||[5,10,20,30])[0]*60;
  S.prepLeft = S.prepTotal;
  $('peekRule').textContent = `− ${TRAIN().peek_penalty} / 次`;
  $('hintRule').textContent = `− ${TRAIN().hint_penalty ?? 5} / 次`;
  await applyTheme();
  applyDisplay();
  await migrateLocal();
  buildCatChips(); buildDurRow(); renderCustom(); renderPrep(); renderDrawer();
  resetNotes('three');
  renderModeSwitch();
  $('homeBtn').textContent = curMode().homeLabel || '回到开头';
  curMode().enter();
})();
