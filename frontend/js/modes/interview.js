/* 面试模拟模式：挑简历 → 选面试官 → 多轮问答 → 一场一份复盘
   跟前面三个模式最大的不同：一场里有多轮，所以开讲引擎被拆成了「本场」与「本轮」两层。
   本场的东西（字稿、总时长、卡壳总数、耐心）跨轮累计，本轮的东西（本轮字稿、本轮时长）
   靠 roundFrom / _roundBase 这两个起点算出来。 */
let intvQ = '';            // 本轮面试官问的那句话
let intvThinkLeft = 0;     // 思考时间剩余秒数
let intvThinkTimer = null;
let intvSkipThink = null;
let intvEditing = -1;      // 简历表单：-1 = 新增，其余 = 正在编辑第几份
let personaEditing = -1;   // 人设表单：-1 = 新增，其余 = 正在编辑第几位
let intvEnding = false;    // 正在收尾本轮（tick 每 500ms 调一次，得挡住重入）
let intvReact = null;      // 面试官的即时反应 {text, kind}
let intvReactTimer = null;
let intvCutTimer = null;   // 「被打断」红边闪一下的收尾用
let intvCloseTimer = null; // 收尾话之后留给考生回一句的时间

const DIM_KEYS = ['relevance', 'structure', 'evidence', 'length', 'clarity'];
const DIM_NAME = {relevance:'针对性', structure:'结构', evidence:'证据',
                  length:'时长控制', clarity:'清晰度'};
const DIM_W    = {relevance:.30, structure:.20, evidence:.25, length:.10, clarity:.15};

function intvCfg(){ return ((S.cfg || {}).modes || {}).interview || {}; }
function pCfg(){ return intvCfg().patience || {}; }
/* 这位面试官到底计不计较：人设里关掉扣耐心就只在面板上提一句，数字不动 */
function patienceOn(){ return (S.persona || {}).patience_on !== false; }
/* 没有固定轮数了：问多久由面试官（AI 收尾标记 / 耐心归零）或考生自己决定。
   这个上限只是兜底——万一模型一直不吐 end，别让面试永远开不完 */
const INTV_HARD_CAP = 12;
/* 单轮建议时长：人设自带一个上限（压力面只给你 90 秒），没配就用全局的 */
function suggestSec(){ return +(S.persona?.max_sec) || +intvCfg().suggest_sec || 90; }
/* 思考时间：设置页选「由面试官决定」时用人设自带的秒数 */
function thinkSec(){
  if(intvCfg().think_enabled === false) return 0;
  const v = S.intvThink;
  if(v === 'persona' || v == null) return +(S.persona?.think_sec) || 0;
  return Math.max(0, +v || 0);
}

/* ================= 第一步：挑简历 ================= */
function renderResumes(){
  const box = $('resumeList');
  if(!box) return;
  box.innerHTML = S.resumes.length ? S.resumes.map((r,i)=>`
    <div class="resume-item${S.resume && S.resume.name === r.name ? ' on' : ''}" data-i="${i}">
      <div class="ri-main">
        <div class="ri-name">${esc(r.name)}</div>
        ${r.target ? `<div class="ri-target">${esc(r.target)}</div>` : ''}
        <div class="ri-len">${r.text.length} 字</div>
      </div>
      <button class="ri-edit" onclick="editResume(${i})">编辑</button>
    </div>`).join('') : '<div class="resume-empty">还没有简历，在下面「管理简历」里粘一份进来。</div>';
  box.querySelectorAll('.resume-item').forEach(el=>{
    el.onclick = e=>{ if(e.target.closest('.ri-edit')) return; pickResume(+el.dataset.i); };
  });
  const noAI = !aiReady();
  $('intvNoAI').hidden = !noAI;
  $('intvToSetupBtn').disabled = noAI;
}
function pickResume(i){
  S.resume = S.resumes[i] || null;
  if(S.resume && !$('intvTarget').value) $('intvTarget').value = S.resume.target || '';
  renderResumes();
}
function editResume(i){
  intvEditing = i;
  const r = S.resumes[i] || {name:'', text:''};
  $('resumeName').value = r.name || '';
  $('resumeText').value = r.text || '';
  $('resumeFormTitle').textContent = i >= 0 ? '编辑' : '新增';
  $('resumeSaveBtn').textContent = i >= 0 ? '保存' : '添加';
  $('resumeCancelBtn').hidden = false;
  $('resumeDelBtn').hidden = i < 0;
  $('resumeFold').classList.add('open');
}
function resetResumeForm(){
  intvEditing = -1;
  $('resumeName').value = ''; $('resumeText').value = '';
  $('resumeFormTitle').textContent = '新增';
  $('resumeSaveBtn').textContent = '添加';
  $('resumeCancelBtn').hidden = true;
  $('resumeDelBtn').hidden = true;
}
async function saveResume(){
  const name = $('resumeName').value.trim();
  const text = $('resumeText').value.trim();
  if(!name || !text){ toast('名称和正文都要填'); return; }
  const list = S.resumes.slice();
  if(intvEditing >= 0) list[intvEditing] = {name, target: list[intvEditing].target || '', text};
  else list.push({name, target: '', text});
  try{
    S.resumes = await api.put('/api/resumes', {resumes: list});
  }catch(e){ toast('保存失败：' + e.message); return; }
  S.resume = S.resumes[intvEditing >= 0 ? intvEditing : S.resumes.length - 1] || null;
  resetResumeForm();
  renderResumes();
  toast('已保存');
}
async function delResume(){
  if(intvEditing < 0) return;
  if(!confirm('删除这份简历？')) return;
  const list = S.resumes.filter((_, i)=>i !== intvEditing);
  try{ S.resumes = await api.put('/api/resumes', {resumes: list}); }
  catch(e){ toast('删除失败：' + e.message); return; }
  S.resume = null;
  resetResumeForm();
  renderResumes();
}

/* ================= 第二步：选人设 ================= */
function renderPersonas(){
  const box = $('personaList');
  if(!box) return;
  box.innerHTML = (S.personas || []).map((p,i)=>`
    <div class="persona${S.persona && S.persona.id === p.id ? ' on' : ''}" data-id="${p.id}">
      <div class="p-main">
        <div class="p-name">${esc(p.name)}</div>
      <div class="p-desc">${esc(p.desc)}</div>
      <div class="p-meta">耐心 ${p.init_patience} · 思考 ${p.think_sec}s · 单轮 ${p.max_sec}s · ${p.interrupt ? '会打断' : '不打断'}${p.patience_on === false ? ' · 不扣耐心' : ''}</div>
      </div>
      <button class="ri-edit" onclick="editPersona(${i})">编辑</button>
    </div>`).join('');
  box.querySelectorAll('.persona').forEach(el=>{
    el.onclick = e=>{ if(e.target.closest('.ri-edit')) return;
      S.persona = (S.personas || []).find(p=>p.id === el.dataset.id) || S.persona; renderPersonas(); };
  });
}
function editPersona(i){
  personaEditing = i;
  const p = (S.personas || [])[i] || {};
  $('pName').value = p.name || '';
  $('pDesc').value = p.desc || '';
  $('pStyle').value = p.style || '';
  $('pOpening').value = p.opening || '';
  $('pPatience').value = p.init_patience ?? 100;
  $('pThink').value = p.think_sec ?? 15;
  $('pMaxSec').value = p.max_sec ?? 120;
  $('pInterrupt').value = String(p.interrupt === true);
  $('pPatienceOn').value = String(p.patience_on !== false);
  $('personaFormTitle').textContent = i >= 0 ? '编辑' : '新增';
  $('personaSaveBtn').textContent = i >= 0 ? '保存' : '添加';
  $('personaCancelBtn').hidden = false;
  $('personaDelBtn').hidden = i < 0;
  $('personaFold').classList.add('open');
}
function resetPersonaForm(){
  personaEditing = -1;
  ['pName','pDesc','pStyle','pOpening'].forEach(id=>$(id).value = '');
  $('pPatience').value = 100; $('pThink').value = 15; $('pMaxSec').value = 120;
  $('pInterrupt').value = 'false'; $('pPatienceOn').value = 'true';
  $('personaFormTitle').textContent = '新增';
  $('personaSaveBtn').textContent = '添加';
  $('personaCancelBtn').hidden = true;
  $('personaDelBtn').hidden = true;
}
async function savePersona(){
  const name = $('pName').value.trim();
  const style = $('pStyle').value.trim();
  if(!name || !style){ toast('名称和风格都要填'); return; }
  const list = (S.personas || []).slice();
  const one = {
    id: personaEditing >= 0 ? list[personaEditing].id : '',
    name, desc: $('pDesc').value.trim(), style,
    opening: $('pOpening').value.trim(),
    init_patience: +$('pPatience').value || 100,
    think_sec: Math.max(0, +$('pThink').value || 0),
    max_sec: Math.max(30, +$('pMaxSec').value || 120),
    interrupt: $('pInterrupt').value === 'true',
    patience_on: $('pPatienceOn').value === 'true',
  };
  if(personaEditing >= 0) list[personaEditing] = one; else list.push(one);
  try{ S.personas = await api.put('/api/personas', {personas: list}); }
  catch(e){ toast('保存失败：' + e.message); return; }
  if(personaEditing >= 0) S.persona = S.personas.find(p=>p.id === one.id) || S.persona;
  resetPersonaForm();
  renderPersonas();
  renderIntvMeta();
  toast('已保存');
}
async function delPersona(){
  if(personaEditing < 0) return;
  if(!confirm('删除这位面试官？')) return;
  const list = (S.personas || []).filter((_, i)=>i !== personaEditing);
  try{ S.personas = await api.put('/api/personas', {personas: list}); }
  catch(e){ toast('删除失败：' + e.message); return; }
  if(S.persona && !S.personas.some(p=>p.id === S.persona.id)) S.persona = S.personas[0] || null;
  resetPersonaForm();
  renderPersonas();
  renderIntvMeta();
}
/* 按当前表单里的人设现场生成一句开场白，填进输入框，满意再保存 */
async function genOpening(){
  if(!aiReady()){ toast('先在设置里配好 AI'); return; }
  if(!$('pStyle').value.trim()){ toast('先写一句这位面试官的风格'); return; }
  const btn = $('pGenOpeningBtn');
  btn.disabled = true; btn.textContent = '生成中…';
  try{
    const r = await api.post('/api/interview/opening', {
      persona: {name: $('pName').value.trim() || '面试官', style: $('pStyle').value.trim()},
      target: ($('intvTarget').value || '').trim(), brief: '',
    });
    if(r.text) $('pOpening').value = r.text;
    else toast('没生成出来，再试一次');
  }catch(e){ toast('生成失败：' + e.message); }
  btn.disabled = false; btn.textContent = 'AI 生成';
}
function renderIntvMeta(){
  const el = $('intvMeta');
  if(!el) return;
  if(!S.resume){ el.innerHTML = '<span class="im-none">没选简历 · 面试官会问通用问题</span>'; return; }
  el.innerHTML = `<span class="im-name">${esc(S.resume.name)}</span><span class="im-len">${S.resume.text.length} 字</span>`;
}

/* ================= 开场 ================= */
async function startInterview(){
  if(!aiReady()){ toast('先在设置里配好 AI——没有 AI 就没有面试官'); return; }
  S.target = ($('intvTarget').value || '').trim();
  // 上一场的开场白/问题必须先清掉，否则新场子里还挂着上一场的最后一句话
  intvQ = ''; intvEnding = false; intvThinkTimer = null; intvSkipThink = null;
  clearTimeout(intvCloseTimer);
  S.rounds = []; S.asked = []; S.probing = false; S._intvBoot = true;
  S._badStreak = 0; S._intvClosing = false; S._intvClosed = false;
  S.initPatience = +(S.persona?.init_patience) || 100;
  S.patience = S.initPatience;
  paintPatience();
  S.intvThink = $('intvThink').value;

  await startSpeak();          // 麦克风授权 + 识别模型加载都在这一步
  if(!S.speaking) return;
  S._intvBoot = true;          // startSpeak 里会重置会话状态，这里再钉一次
  renderInterviewer();         // 面板立刻给出「正在看简历」的状态，别空着
  await pauseSpeak();          // 面试官先开口，考生先听着：这段时间不计时也不转写

  // 简历只读一次，压成摘要 + 疑点清单，后面每轮追问都用它，不再带全文
  if(S.resume && S.resume.text.trim()){
    try{
      const b = await api.post('/api/interview/brief', {resume: S.resume.text, target: S.target});
      S.brief = b.brief || ''; S.suspects = b.suspects || [];
    }catch(e){ toast('简历没读成：' + e.message); S.brief = ''; S.suspects = []; }
  } else { S.brief = ''; S.suspects = []; }

  // 开场白：人设里写了就用写死的；没写让 AI 现场说一句；AI 也不行就退回「下一句话」那套
  let opening = (S.persona?.opening || '').trim();
  if(!opening){
    try{
      const o = await api.post('/api/interview/opening', {
        persona_id: S.persona?.id || 'hr', target: S.target, brief: S.brief});
      opening = (o.text || '').trim();
    }catch(e){ /* 走兜底 */ }
  }
  S._intvBoot = false;
  if(!S.speaking) return;
  if(opening){
    intvQ = opening; S.asked.push(opening);
    renderInterviewer();
    await runThink();
  } else {
    await nextRound(1, '开场。按你的风格问第一个问题。');
  }
}

/* 面试官的下一句话。trigger 决定这句话是开场、追问、施压还是收尾 */
async function nextRound(n, trigger){
  if(S.probing || !S.speaking) return;
  S.probing = true;
  S._stuckReacted = false;
  renderInterviewer();
  try{
    const r = await api.post('/api/interview/next', {
      persona_id: S.persona?.id || 'hr',
      target: S.target, brief: S.brief, suspects: S.suspects, asked: S.asked,
      transcript: n > 1 ? ((S.rounds[n - 2] || {}).text || '') : '',
      trigger: trigger || '他答完了',
      round: n,
      patience: S.patience, init_patience: S.initPatience,
      streak: S._badStreak || 0,   // 连续答得不好，让面试官当场点出来
    });
    intvQ = (r.question || '').trim();
    // 他听完那段回答的反应：这是"面对面"感的主要来源，别只剩冷冰冰的下一问
    if(r.react) setReact(r.react, 'watch', 0);
    // 面试官主动收尾：把话说完就散场（耐心归零走的也是这里，toast 不同而已）
    if(r.end || S.rounds.length >= INTV_HARD_CAP){
      S.probing = false;
      toast('面试官结束了这场面试');
      // 收尾话由面试官自己说完，再留一段开麦时间给考生回一句
      deliverClosing(intvQ || '今天就到这里吧，你这边还有什么想了解的吗？',
                     '面试官说完了，你可以回一句');
      return;
    }
  }catch(e){
    intvQ = '';
    toast('面试官没接上话：' + e.message);
  }
  S.probing = false;
  if(intvQ) S.asked.push(intvQ);
  if(!S.speaking) return;
  await runThink();
}

/* 思考时间：由面试官给，考生可以主动加时，代价是掉耐心 */
function runThink(){
  return new Promise(resolve=>{
    const sec = thinkSec();
    intvThinkLeft = sec;
    renderInterviewer();
    if(sec <= 0){ resolve(); return; }
    clearInterval(intvThinkTimer);
    intvSkipThink = ()=>{ clearInterval(intvThinkTimer); intvThinkTimer = null; intvSkipThink = null; resolve(); };
    intvThinkTimer = setInterval(()=>{
      intvThinkLeft--;
      if(intvThinkLeft <= 0){ intvSkipThink && intvSkipThink(); return; }
      const n = $('ipThinkLeft'); if(n) n.textContent = intvThinkLeft;
    }, 1000);
  }).then(()=>{
    if(!S.speaking) return;
    resumeSpeak();          // 开麦，本轮计时开始
    beginRound();
    // 开麦得让人听见：不然这段时间到底在等什么，全靠猜
    if(!intvReact) setReact('该你回答了 · 麦克风已开', 'watch', 2500);
    renderInterviewer();
  });
}
/* 主动讨要思考时间：每多要 1 秒扣 extend 点耐心 */
function extendThink(){
  const add = +intvCfg().extend_sec || 10;
  const cost = add * (+pCfg().extend || 2);
  intvThinkLeft += add;
  dropPatience(cost, `又多想了 ${add} 秒`);
  const n = $('ipThinkLeft'); if(n) n.textContent = intvThinkLeft;
}

/* ================= 收尾本轮 ================= */
async function endRound(trigger){
  if(!S.speaking || S.probing || intvEnding) return;
  intvEnding = true;
  // 点「答完了」到面试官开口之间要花几秒（停转写 + AI 点评 + AI 出下一问），
  // 这段时间必须立刻有反馈，否则看起来像卡住了。
  // 注意：这里不能置 probing——nextRound 开头见到 probing 会直接 return，
  // 于是永远等不到下一问。用独立的「正在看这一轮」状态
  S._intvBoot = false;
  S._intvEval = true;
  renderInterviewer();
  updateSpeakUI();
  try{
    const text = roundText().trim();
    const dur = Math.round(roundSec());
    // 必须先结算：卡壳那一笔要等 closeStuck 才落账，而触发本轮结束的
    // 往往正是这一次卡壳——放在 pauseSpeak 之后取，它就永远不计数了
    closeStuck();
    const stuck = roundStuck();
    if(intvSkipThink) intvSkipThink();
    if(trigger === 'interrupt') setReact('面试官抬手打断了你', 'bad', 0);
    await pauseSpeak();          // 停识别，但麦克风留着，下一轮接着用
    closeStuck();
    const round = {q: intvQ, text, dur, stuck, trigger, fb: null};
    S.rounds.push(round);

    // 本地规则扣耐心：卡壳一次扣一份，超时每 10 秒扣一份
    dropPatience(stuck * (+pCfg().stuck || 8), stuck ? `卡壳 ${stuck} 次` : '');
    const sug = suggestSec();
    const over = Math.max(0, Math.round(dur - sug));
    if(dur > sug) dropPatience(Math.floor((dur - sug) / 10) * (+pCfg().overtime || 5), `比建议时长多讲了 ${over} 秒`);

    // 这一轮的点评：带 dims 回来，答非所问再扣一份
    let lowRel = false;
    if(text && aiReady()){
      // 打断/接话那句话还挂着就别盖：那是考生最该看见的一句
      if(!intvReact) setReact('面试官在看你的回答…', 'watch', 0);
      try{
        const fb = await api.post('/api/analyze/sentences', {
          topic: S.target, transcript: text, mode: 'interview', question: round.q,
        });
        round.fb = fb;
        setReact('', 'watch', 0);
        const rel = (fb?.dims || {}).relevance;
        lowRel = typeof rel === 'number' && rel < 60;
        if(lowRel) dropPatience(+pCfg().low_relevance || 15, '这段没答到点上');
      }catch(e){ /* 点评失败不影响流程 */ setReact('', 'watch', 0); }
    }
    // 连续答得不好要累计：真实面试里面试官不会等你第 5 次答不上来才有反应
    const bad = stuck > 0 || trigger === 'stuck' || trigger === 'interrupt'
              || trigger === 'overtime' || lowRel;
    S._badStreak = bad ? (S._badStreak || 0) + 1 : 0;
    if(S._badStreak >= 2)
      pushReact(`连续 ${S._badStreak} 轮没答好，面试官语气变了`, 'warn');
    S._intvEval = false;
    renderInterviewer();

    // 收场：耐心耗尽，或者连续答不上来——都得让面试官本人把话说完
    if(S.patience <= 0){ closeInterview('耐心耗尽'); return; }
    if(S._badStreak >= 3){ closeInterview(`连续 ${S._badStreak} 轮答得不好`); return; }
    const t = trigger === 'stuck' ? '他卡住了，答不上来。'
            : trigger === 'interrupt' ? '你打住了他，问他的问题还没答完。'
            : trigger === 'overtime' ? '他讲太久了，你收一下。'
            : '他答完了。';
    await nextRound(S.rounds.length + 1, t);
  } finally {
    intvEnding = false; S._intvEval = false;
  }
}
/* 点「提示」求助也要计入：真实面试里老跟面试官要方向，对方心里是要减分的 */
function intvCostHint(){
  dropPatience(+pCfg().hint || 6, '跟面试官要了一次方向');
}
function dropPatience(n, reason){
  if(!n) return;
  const label = `${reason ? reason + ' · ' : ''}耐心 −${n}`;
  if(!patienceOn()){                 // 这位面试官不扣耐心，只在面板上说一声
    if(reason) setReact(reason, 'watch');
    return;
  }
  S.patience = Math.max(0, S.patience - n);
  paintPatience();
  pushReact(label, n >= 10 ? 'bad' : 'warn');
  renderInterviewer();
}
/* 面板和底部两处耐心都要跟着走；开新场时也得刷一遍，不然压着人设的初始值不显示 */
function paintPatience(){
  const b = $('patienceVal'); if(b) b.textContent = S.patience;
  const row = $('patienceRow');
  if(row) row.classList.toggle('low', S.patience <= S.initPatience * 0.3);
}
/* 面板上那行字是累加的：刚打断了你、又扣了耐心，两件事都得让考生看见，
   后来的一条不能把前面那条顶掉 */
function pushReact(text, kind){
  const prev = intvReact;
  const k = (prev && prev.kind === 'bad') || kind === 'bad' ? 'bad' : 'warn';
  setReact(prev ? `${prev.text} · ${text}` : text, k);
}
/* 面试官提前收场：不能只弹个系统提示，得让他本人把话说完，
   真实面试里这句话常常带着「你有什么想了解的吗」 */
async function closeInterview(reason){
  if(S._intvClosing || !S.speaking) return;
  S._intvClosing = true;
  toast('面试官提前结束了这场面试');
  updateSpeakUI();
  renderInterviewer();
  let closing = '';
  if(aiReady()){
    try{
      const r = await api.post('/api/interview/close', {
        persona_id: S.persona?.id || 'hr', persona: S.persona, target: S.target,
        rounds: S.rounds.map(x=>({q: x.q, text: x.text})),
        patience: S.patience, init_patience: S.initPatience, reason: reason || '',
      });
      closing = (r.closing || '').trim();
    }catch(e){ /* 收尾话没生成也照收 */ }
  }
  if(!closing) closing = S.patience > S.initPatience * 0.3
    ? '今天就到这里吧，你这边还有什么想了解的吗？'
    : '行，今天就到这儿。后续有消息我们会通知你。';
  deliverClosing(closing, '面试官在收尾，你可以回一句');
}
/* 把收尾话摆到面板上，并留一段开麦时间给考生回一句（他也可以直接点结束） */
function deliverClosing(text, tip){
  intvQ = text || '今天就到这里吧。';
  S._intvClosing = false; S._intvClosed = true;
  S._intvEval = false; S.probing = false;   // 别让「正在看回答」的状态残留在收尾段
  S.asked.push(intvQ);
  renderInterviewer();
  if(S.speaking && S.paused) resumeSpeak();
  beginRound();
  pushReact(tip || '面试官在收尾，你可以回一句', 'warn');
  clearTimeout(intvCloseTimer);
  intvCloseTimer = setTimeout(()=>{ if(S.speaking) endSpeak(); }, 30000);
}
/* 面试官没开口（准备 / 看回答 / 想下一问 / 收尾）时，暂停按钮禁用 */
function intvBusy(){
  return S.speaking && (S.probing === true || S._intvBoot === true
                        || S._intvEval === true || S._intvClosing === true);
}
/* 上面那几种状态各自该提示什么，交给 speak.js 显示 */
function intvBusyLabel(){
  if(!S.speaking) return '';
  if(S._intvBoot) return '面试官正在看你的简历';
  if(S._intvClosing) return '面试官正在收尾';
  if(S._intvEval) return '面试官正在看这一轮回答';
  if(S.probing) return '面试官正在想下一问';
  return '';
}

/* ================= 开讲页：面试官面板 ================= */
function renderInterviewer(){
  const box = $('readSource');
  if(!box) return;
  const src = curMode().source;
  if(src) box.innerHTML = src();
}
/* 面试官的反应：真实面试里这些当场反馈最值钱，所以让它们即时可见 */
function intvSource(){
  const n = S.rounds.length + 1;
  const boot = !!S._intvBoot;                 // 开场准备：读简历 / 生成开场白，还没开口
  const thinking = S.probing;
  const judging = !!S._intvEval;              // 他说完了：面试官在看这一轮
  const thinking2 = !thinking && intvThinkTimer != null;
  const closing = !!S._intvClosing;           // 面试官正在收尾
  const closed  = !!S._intvClosed;            // 收尾话已经说出口，轮到考生回一句
  const past = S.rounds.map((r, i)=>`
    <div class="ip-past">
      <div class="ipp-q"><span class="ipp-n">${i + 1}</span>${esc(r.q || '（没问出来）')}</div>
      ${r.text ? `<div class="ipp-a">${esc(r.text.slice(0, 160))}${r.text.length > 160 ? '…' : ''}</div>`
               : '<div class="ipp-a none">（没答）</div>'}
      ${(r.fb || {}).summary ? `<div class="ipp-fb">${esc(r.fb.summary)}</div>` : ''}
    </div>`).join('');
  const body = boot
    ? '<div class="ip-q thinking"><span class="dots">面试官正在看你的简历</span></div>'
    : closing
    ? '<div class="ip-q thinking"><span class="dots">面试官正在收尾</span></div>'
    : judging
    ? '<div class="ip-q thinking"><span class="dots">面试官在看这一轮回答</span></div>'
    : thinking
    ? '<div class="ip-q thinking"><span class="dots">面试官正在想</span></div>'
    : `<div class="ip-q${closed ? ' closed' : ''}">${esc(intvQ || '（面试官没说话）')}</div>`;
  const think = thinking2 ? `
    <div class="ip-think">
      <span>面试官在等你想 · 还剩 <b id="ipThinkLeft">${intvThinkLeft}</b> 秒，到点自动开麦</span>
      <button class="tp" onclick="extendThink()">再想 ${+intvCfg().extend_sec || 10} 秒</button>
      <button class="tp go" onclick="intvSkipThink && intvSkipThink()">想好了，开始回答</button>
    </div>` : '';
  /* 只有收尾之后还开着麦的那一段，才给「结束这场面试」——平时是「下一题」 */
  const listening = !thinking && !thinking2 && !boot && !judging && !closing ? `
    <div class="ip-acts">
      ${closed
        ? '<button class="tp go" onclick="endSpeak()">结束这场面试</button>'
        : '<button class="tp go" onclick="endRound(\'answer\')">答完了，下一题 →</button>'}
    </div>` : '';
  /* 打断那一瞬间的红字优先；没有就显示这一轮的扣分/沉默提示 */
  const reactLine = intvReact
    ? `<div class="ip-react ${intvReact.kind}" id="ipReact">${esc(intvReact.text)}</div>`
    : '<div class="ip-react" id="ipReact" hidden></div>';
  return `
    <div class="intv-panel${S._intvCut ? ' cut' : ''}">
      <div class="ip-head">
        <span class="ip-who">面试官 · ${esc(S.persona?.name || '—')}</span>
        <span class="ip-round">第 ${n} 轮</span>
        <span class="ip-pat${S.patience <= S.initPatience * 0.3 ? ' low' : ''}">耐心 <b>${S.patience}</b> / ${S.initPatience}</span>
      </div>
      ${body}
      ${think}${listening}
      ${reactLine}
      <div class="ip-bar"><i id="ipBar" style="width:0%"></i></div>
      ${past ? `<div class="ip-hist">${past}</div>` : ''}
    </div>`;
}
/* ================= 面试官的反应 =================
   线上面对面最值钱的不是提问内容，是对方的当场反应：皱眉、看表、打断。
   这些都是本地规则触发的（不等 AI），所以一定能即时出现在面板上 */
function setReact(text, kind, ms){
  clearTimeout(intvReactTimer);
  intvReact = text ? {text, kind: kind || 'warn'} : null;
  renderInterviewer();
  if(text && ms !== 0)
    intvReactTimer = setTimeout(()=>{ intvReact = null; renderInterviewer(); }, ms || 5000);
}
/* tick 每 500ms 一次，这时候别整块重画（会把「正在想」的点动画重置），
   只改反应那一行 */
function paintReact(text, kind){
  const el = $('ipReact');
  if(!el) return;
  el.hidden = !text;
  el.textContent = text || '';
  el.className = 'ip-react' + (text ? ' ' + (kind || 'warn') : '');
}
/* 最直观的「被打断」：面板描边闪一下红 + 一行红字指向奖惩。
   纯本地规则触发，不等 AI，保证一定看得见 */
function cutIn(trigger){
  // 只置状态：面板会连同 .cut 一起被 renderInterviewer 重画，
  // 这里直接加 class 会被紧接着的重绘抹掉
  S._intvCut = true;
  clearTimeout(intvCutTimer);
  intvCutTimer = setTimeout(()=>{ S._intvCut = false; renderInterviewer(); }, 1400);
  endRound('interrupt');
}
/* 不打断的人设也要有反应：不插话，但会把话头接过去，而且得让考生看得见 */
function softProbe(trigger){
  setReact(trigger === 'stuck' ? '面试官接过了话头' : '面试官收住了这个话题', 'warn', 0);
  endRound(trigger);
}
/* 沉默多久：从上一个认出来的字算起，不等「卡壳判定线」——
   判定线是拿来扣分/接话的，考生这边要的是立刻知道「他在等你」 */
function intvSilentSec(){
  if(S.lastTextAt) return (Date.now() - S.lastTextAt) / 1000;
  return S.stuckOpen ? (Date.now() - S.stuckFrom) / 1000 : 0;
}
/* 沉默多久才在面板上写出来：开场的 2.5 秒是想事情，不算失礼 */
const INTV_SILENT_SHOW = 2.5;

function intvTick(){
  if(!S.speaking || S.paused || S.probing || intvEnding) return;
  if(S._intvClosing || S._intvClosed) return;   // 收尾话都出口了，别再追问
  if(intvThinkTimer != null) return;          // 思考时间不算卡壳
  const bar = $('ipBar');
  if(bar){
    const r = suggestSec() ? Math.min(100, roundSec() / suggestSec() * 100) : 0;
    bar.style.width = r + '%';
    bar.classList.toggle('over', roundSec() > suggestSec());
  }
  // 沉默要看得见：不吭声的时候面板上得有东西在动，否则像是死了
  const silent = intvSilentSec();
  if(silent > INTV_SILENT_SHOW) paintReact(`已经沉默 ${silent.toFixed(1)} 秒 · 面试官在等你`, 'warn');
  else if(!intvReact) paintReact('');

  // 打断：会不会在你说到一半插话，由这位面试官自己决定（人设里的「打断」）
  const cuts = (S.persona || {}).interrupt === true;
  const auto = intvCfg().auto_probe !== false;
  if(S._probed || (!cuts && !auto)) return;
  if(S.stuckOpen){
    // 不打断的人设多给一倍时间，但也不能让他对着空气讲下去
    const wait = cuts ? intvStuckSec() : intvStuckSec() * 2;
    if(silent > wait){ S._probed = true; cuts ? cutIn('stuck') : softProbe('stuck'); return; }
  }
  const cap = suggestSec() * (cuts ? 1 : 1.5);
  if(suggestSec() && roundSec() > cap){ S._probed = true; cuts ? cutIn('overtime') : softProbe('overtime'); }
}
/* 面试里想 5 秒是常事，用演讲那套 3 秒会一直误判成卡壳 */
function intvStuckSec(){ return +intvCfg().stuck_sec || 6; }

/* ================= 结算 ================= */
function dimsAvg(){
  const acc = {}; let cnt = 0;
  DIM_KEYS.forEach(k=>acc[k] = 0);
  S.rounds.forEach(r=>{
    const d = (r.fb || {}).dims;
    if(!d) return;
    let any = false;
    DIM_KEYS.forEach(k=>{ if(typeof d[k] === 'number'){ acc[k] += d[k]; any = true; } });
    if(any) cnt++;
  });
  if(!cnt) return null;
  const out = {};
  DIM_KEYS.forEach(k=>out[k] = Math.round(acc[k] / cnt));
  return out;
}
function totalScore(dims){
  if(!dims) return null;
  let s = 0;
  DIM_KEYS.forEach(k=>{ if(typeof dims[k] === 'number') s += dims[k] * DIM_W[k]; });
  s = Math.round(s);
  // 耐心归零 = 被面试官提前赶出去了，这场的分要打折
  if(S.patience <= 0) s = Math.round(s * 0.6);
  return Math.max(0, Math.min(100, s));
}
function mergeRoundAnalysis(){
  const sentences = [];
  let summary = '';
  S.rounds.forEach(r=>{
    const fb = r.fb || {};
    (fb.sentences || []).forEach(s=>sentences.push(s));
    if(fb.summary) summary = fb.summary;
  });
  return {sentences, summary, dims: dimsAvg() || {}};
}

async function intvEnd(dur){
  if(S.transcript.trim()){
    S.stats = await api.post('/api/analyze/words', {transcript: S.transcript, duration_sec: dur});
  }
  closeStuck();
  clearInterval(intvThinkTimer); intvThinkTimer = null; intvSkipThink = null;
  clearTimeout(intvCloseTimer);
  // 收尾之后他回的那一句也记进来（没有点评，不参与打分）
  if(S._intvClosed){
    const t = roundText().trim();
    if(t) S.rounds.push({q: intvQ, text: t, dur: Math.round(roundSec()), stuck: 0,
                         trigger: 'closing', fb: null});
  }
  const dims = dimsAvg() || {};
  const score = totalScore(dimsAvg());
  S.analysis = mergeRoundAnalysis();
  const chars = S.transcript.replace(/\s/g, '').length;
  const cells = DIM_KEYS.map(k=>({v: (dims[k] == null ? '—' : dims[k]), k: DIM_NAME[k]}));
  cells.push({v: S.patience, k: '耐心剩余', pen: S.patience <= S.initPatience * 0.3});
  return {
    score,
    rating: score == null ? '没答完' : (score >= 85 ? '很稳' : score >= 70 ? '基本合格' : score >= 55 ? '有点悬' : '危险'),
    rule: S.patience <= 0 ? '面试官提前结束了这场面试'
        : S._intvClosed ? '面试官觉得问够了，提前收了场' : '',
    topic: S.target || '面试模拟',
    cat: `${S.persona?.name || '面试'} · ${S.rounds.length} 轮 · ${fmt(dur)} · ${chars} 字`,
    cells,
    analysis: {dims, summary: S.analysis.summary || ''},
    entry: {
      rounds: S.rounds.map(r=>({q: r.q, text: r.text, dur: r.dur, stuck: r.stuck, fb: r.fb})),
      patience: S.patience, init_patience: S.initPatience,
    },
  };
}

/* ================= 注册 ================= */
registerMode({
  id: 'interview',
  name: '面试模拟',
  phases: ['intv-resume', 'intv-setup', 'speak', 'result'],
  requiresAI: true,
  // 面试现场没有小抄，也不该在你说话时弹提示；「提示」留着，指个方向用
  speak: {peek: false, hint: true, source: true, score: false, coach: false,
          patience: true, resume: true, ready: false, topic: false,
          recLabel: 'REC · 面试官在听', endLabel: '结束面试'},

  enter(){ setPhase('intv-resume'); renderResumes(); renderIntvMeta(); },
  homeLabel: '再面一场',
  again(){ this.enter(); },

  source: intvSource,
  tick: intvTick,
  stuckSec: intvStuckSec,

  async end(dur){ return intvEnd(dur); },
  reportExtra(){
    return {
      rounds: S.rounds.map(r=>({q: r.q, text: r.text, dur: r.dur, fb: r.fb})),
      patience: S.patience, init_patience: S.initPatience,
    };
  },

  metricsOf(h){
    const d = ((h?.analysis) || {}).dims || {};
    const mins = Math.max(1 / 60, +(h?.dur || 0) / 60);
    const st = h?.stats || {};
    return {
      relevance: d.relevance ?? 0, structure: d.structure ?? 0,
      evidence: d.evidence ?? 0, clarity: d.clarity ?? 0,
      stuck: +(h?.stuck ?? 0),
      wpm: Math.round(+(st.chars_per_minute ?? 0) || 0),
      rounds: (h?.rounds || []).length || 1,
      density: Math.round(((st.categories?.filler?.count || 0) / mins) * 10) / 10,
    };
  },
  curMetrics(){
    const d = dimsAvg() || {};
    const mins = Math.max(1 / 60, speakSec() / 60);
    return {
      relevance: d.relevance ?? 0, structure: d.structure ?? 0,
      evidence: d.evidence ?? 0, clarity: d.clarity ?? 0,
      stuck: S.stuck, wpm: dur2wpm(),
      rounds: S.rounds.length || 1,
      density: Math.round((((S.stats?.categories?.filler?.count) || 0) / mins) * 10) / 10,
    };
  },
  compareRows: [
    {k: '针对性', a: 'relevance', p: 'relevance', u: '分', better: 'high', eps: 5},
    {k: '结构', a: 'structure', p: 'structure', u: '分', better: 'high', eps: 5},
    {k: '证据', a: 'evidence', p: 'evidence', u: '分', better: 'high', eps: 5},
    {k: '清晰度', a: 'clarity', p: 'clarity', u: '分', better: 'high', eps: 5},
    {k: '卡壳', a: 'stuck', p: 'stuck', u: '次', better: 'low', eps: 0.5},
    {k: '口头禅', a: 'density', p: 'density', u: '次/分', better: 'low', eps: 0.3},
  ],
});
function dur2wpm(){
  const mins = speakSec() / 60;
  return mins > 0 ? Math.round(S.transcript.replace(/\s/g, '').length / mins) : 0;
}
