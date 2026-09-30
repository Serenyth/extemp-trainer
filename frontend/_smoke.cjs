/* 冒烟测试：用 jsdom 跑一遍 index.html，验证新增的开讲页统计 / 设置项没把页面搞崩 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const CFG = {
  theme: { preset: 'carbon', custom: { bg: '#0F1013', ink: '#EDEDEF', accent: '#E24B4A' } },
  ai: { base_url: '', api_key: '', model: '', timeout: 60, auto_analyze: false },
  speech: { engine: 'none', model: '', silence_ms: 1200, max_utter_sec: 20,
            punct_enabled: false, min_speech_ms: 300, chunk_ms: 1500, partial_ms: 0 },
  ui: { sfx: true, history_keep: 200 },
  coach: { prompt: '', every: 3, min_chars: 8, max_chars: 40, hint_sec: 24 },
  training: { base_score: 100, peek_penalty: 10, prep_durations: [5, 10, 20, 30],
              filler_scoring: false, filler_threshold: 8, hint_penalty: 5,
              auto_pause: true, ready_countdown: 3, auto_start_sec: 5, peek_duration: 3,
              stuck_sec: 3, wpm_fast: 330, wpm_slow: 0, filler_burst: 3 },
  display: { subtitle_size: 30, coach_size: 13.5, sentence_newline: true, show_punct: true },
};

const ROUTES = {
  '/api/config': CFG,
  '/api/bank': { '全部混合': ['题目一', '题目二'] },
  '/api/words': { filler: ['那个', '就是'], hedging: ['可能'], vague: ['东西'] },
  '/api/history': [],
  '/api/theme/resolve': { bg: '#0F1013', ink: '#EDEDEF', accent: '#E24B4A',
                          amber: '#D9A13B', green: '#6FBF9A', surface: '#141519', dark: true },
  '/api/speech/models': { whisper: [], sherpa: [] },
  '/api/speech/punct': { downloaded: false, enabled: false, name: '' },
  '/api/analyze/hint': { kind: '内容', hint: '你备稿里的第二条要点还没讲：把它拆成原因和对策', manual: true },
};

const errors = [];
const dom = new JSDOM(HTML, {
  runScripts: 'dangerously',
  url: 'http://localhost:8642/',
  pretendToBeVisual: true,
  beforeParse(win) {
    win.fetch = (url, opt) => {
      const key = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      const body = ROUTES[key];
      return Promise.resolve({
        ok: body !== undefined,
        status: body !== undefined ? 200 : 404,
        statusText: body !== undefined ? 'OK' : 'Not Found',
        json: async () => (body !== undefined ? body : { detail: 'no mock: ' + key }),
      });
    };
    win.AudioContext = function () {
      throw new Error('no audio in jsdom');
    };
    win.onerror = (msg) => errors.push('onerror: ' + msg);
    win.addEventListener('error', e => errors.push('error: ' + (e.message || e)));
  },
});
const win = dom.window;

const fail = [];
const ok = [];
const check = (cond, label) => (cond ? ok : fail).push(label);

(async () => {
  await new Promise(r => setTimeout(r, 400));
  const $ = id => win.document.getElementById(id);

  // 1) 页面没被替换成「后端未启动」（不能查 body.textContent：它包含 <script> 源码）
  check(win.eval('!!S.cfg && !!S.bank'), '启动拿到后端配置，没落到「后端未启动」分支');
  check(errors.length === 0, '无脚本运行时错误' + (errors.length ? ' → ' + errors.join(' | ') : ''));

  // 2) 新增元素齐全
  const ids = ['lsScore', 'lsScoreRow', 'lsWpm', 'lsStuck', 'lsStuckAvg', 'lsStuckTot',
               'statWpm', 'hintClose', 'cMax', 'cHold', 'aiAuto', 'dKeep',
               'tAutoPause', 'tStuckSec', 'tWpmFast', 'tWpmSlow', 'tBurst'];
  const missing = ids.filter(i => !$(i));
  check(missing.length === 0, '新增元素齐全' + (missing.length ? ' 缺: ' + missing.join(',') : ''));

  // 3) 无重复 id
  const all = [...win.document.querySelectorAll('[id]')].map(e => e.id);
  const dup = all.filter((v, i) => all.indexOf(v) !== i);
  check(dup.length === 0, '无重复 id' + (dup.length ? ' → ' + [...new Set(dup)].join(',') : ''));

  // 4) 训练参数拆成三块 + 三个保存按钮
  const secs = [...win.document.querySelectorAll('#settingsDrawer .set-sec[data-cat="训练"]')];
  check(secs.length === 5, `训练分类下 5 块（计分/节奏/实时信号/词表/题库），实际 ${secs.length}`);
  const saves = [...win.document.querySelectorAll('.train-save')];
  check(saves.length === 1, `整组只留一个保存按钮，实际 ${saves.length}`);
  const subDiv = [...win.document.querySelectorAll('#settingsDrawer .set-sec.sub')];
  check(subDiv.length === 2, `前两块不画分割线（.sub），实际 ${subDiv.length}`);

  // 5) 开讲页实时统计：分数 / 语速 / 卡壳
  win.eval("S.speaking=true; S.speakStart=Date.now(); S.speakElapsed=0; S.transcript='今天我想讲的是那个那个问题，就是那个。'; S.peek=1; S.hint=1;");
  win.eval('updateLiveStats()');
  check($('lsScore').textContent === '85', `当前分 = 100−10−5 = 85，实际 ${$('lsScore').textContent}`);
  check($('lsChars').textContent === '19', `字数 19，实际 ${$('lsChars').textContent}`);
  check($('lsWpm').textContent === '—', `不足 10 秒时语速显示占位，实际 ${$('lsWpm').textContent}`);
  check($('lsStuck').textContent === '0', `卡壳次数初始 0，实际 ${$('lsStuck').textContent}`);

  // 语速：造一个 60 秒、120 字的样本
  win.eval("S.speakElapsed=60000; S.speakStart=null; S.transcript='字'.repeat(120);");
  win.eval('updateLiveStats()');
  check($('lsWpm').textContent === '120', `语速 120 字/分，实际 ${$('lsWpm').textContent}`);

  // 卡壳：3 秒没出字 → 计一次，平均/总时长跟着走
  win.eval("S.lastTextAt=Date.now()-5000; S.speakStart=Date.now()-60000; tickStuck();");
  win.eval('updateLiveStats()');
  check($('lsStuck').textContent === '1', `沉默 5 秒计 1 次卡壳，实际 ${$('lsStuck').textContent}`);
  check($('lsStuckTot').textContent === '00:05', `卡壳总时长 00:05，实际 ${$('lsStuckTot').textContent}`);
  win.eval('noteSpeech()');
  win.eval('updateLiveStats()');
  check($('lsStuckTot').textContent === '00:05' && $('lsStuck').textContent === '1',
        `出字后闭合且累计保留，实际 ${$('lsStuck').textContent}/${$('lsStuckTot').textContent}`);

  // 开场 5 秒宽限：还没出过字不算卡壳
  win.eval("S.stuck=0;S.stuckMs=0;S.stuckOpen=false;S.lastTextAt=0;S.speakStart=Date.now()-4000;");
  win.eval('tickStuck(); updateLiveStats()');
  check($('lsStuck').textContent === '0', '开场 4 秒未出字不算卡壳');

  // 6) 提示条：三种色调 + 点击关闭
  win.eval("showHint('测试', '语速', 'loc')");
  check($('speakHint').classList.contains('loc'), 'loc 提示加 .loc');
  win.eval("showHint('测试', '方向', 'dir')");
  check($('speakHint').classList.contains('dir') && !$('speakHint').classList.contains('loc'),
        'dir 提示加 .dir 且清掉 .loc');
  check(!$('speakHint').hidden, '提示条可见');
  win.eval('clearHint()');
  check($('speakHint').hidden, 'clearHint 后隐藏');

  // 7) 设置回填：新字段能被 fillSettings 读出来
  win.eval("S.cfg.training.stuck_sec=6; S.cfg.training.wpm_slow=180; S.cfg.coach.max_chars=60; S.cfg.ui.history_keep=500; S.cfg.ai.auto_analyze=true;");
  win.eval('fillSettings()');
  check($('tStuckSec').value === '6', `卡壳判定回填 6，实际 ${$('tStuckSec').value}`);
  check($('tWpmSlow').value === '180', `语速过慢回填 180，实际 ${$('tWpmSlow').value}`);
  check($('cMax').value === '60', `提示字数回填 60，实际 ${$('cMax').value}`);
  check($('dKeep').value === '500', `历史保留回填 500，实际 ${$('dKeep').value}`);
  check($('aiAuto').value === 'true', `自动分析回填 true，实际 ${$('aiAuto').value}`);
  check($('tAutoPause').value === 'true', `自动暂停回填 true，实际 ${$('tAutoPause').value}`);

  // 8) 看稿 / 提示的自动暂停开关
  win.eval("S.speaking=true; S.paused=false; S.readying=false; S.speakStart=Date.now(); S.peek=0; S.hint=0; S.cfg.training.auto_pause=true;");
  win.eval('tapPeek()');
  check(win.eval('S.paused') === true, 'auto_pause=开：看稿时自动暂停');
  check($('peekOverlay').classList.contains('show'), '看稿纸条弹出');
  win.eval('clearInterval(S.peekTimer); $("peekOverlay").classList.remove("show"); S.paused=false;');
  win.eval("S.cfg.training.auto_pause=false; S.speakStart=Date.now();");
  win.eval('tapPeek()');
  check(win.eval('S.paused') === false, 'auto_pause=关：看稿不暂停');
  win.eval('clearInterval(S.peekTimer); $("peekOverlay").classList.remove("show");');
  win.eval("S.cfg.training.auto_pause=true; S.speaking=true; S.paused=false; S.readying=false; S.speakStart=Date.now(); S.lastTextAt=0;");

  // 提示：生成期间暂停、拿到后继续，并且用 dir 色（先配上 AI，否则会走"没配 AI"分支）
  win.eval("S.cfg.ai.base_url='http://x/v1'; S.cfg.ai.model='m';");
  await win.eval('tapHint()');
  await new Promise(r => setTimeout(r, 60));
  check(win.eval('S.hint') === 1, '点提示计数 +1');
  check(win.eval('S.paused') === false, '拿到提示后自动继续计时');
  check($('speakHint').classList.contains('dir'), '方向提示用 dir 色');
  check(/没讲/.test($('hintText').textContent), `提示内容来自 AI，实际「${$('hintText').textContent}」`);
  win.eval('clearInterval(S.speakTimer); S.speakTimer=null; S.speaking=false;');


  // 8.5) 开讲页：时长从实时统计里去掉，当前分挪到计时器那一行
  check(!$('lsDur'), '实时统计不再重复显示时长');
  const ctrl = win.document.querySelector('.ctrl-top');
  check(ctrl && ctrl.children[0].id === 'lsScoreRow' && ctrl.children[1].classList.contains('rec-row'),
        '当前分排在 rec-row 之前');
  const cs = win.getComputedStyle(win.document.querySelector('.ls-sub'));
  check(cs.fontSize === '14px', `ls-sub 保持 14px（用户指定），实际 ${cs.fontSize}`);
  // 全站字号底线：不能再出现 12px 及以下（.set-cat-tag 9px 是唯一豁免）
  const small = [...win.document.querySelectorAll('.stage, .drawer')]
    .flatMap(e => [...e.querySelectorAll('*')])
    .filter(e => { const f = win.getComputedStyle(e).fontSize; return f && parseFloat(f) < 13; })
    .filter(e => !e.classList.contains('set-cat-tag'));
  check(small.length === 0, `页面无 12px 以下文字（除角标），实际 ${small.length} 个`);
  const h3 = win.getComputedStyle(win.document.querySelector('.side-card h3'));
  check(h3.fontSize === '14px', `区块标题 14px，实际 ${h3.fontSize}`);
  check(h3.color !== win.getComputedStyle(win.document.body).getPropertyValue('--faint').trim(),
        '区块标题不再用最淡的灰');
  const sum = win.getComputedStyle($('aiSummary'));
  check(sum.fontSize === '15px', `AI 结论 15px，实际 ${sum.fontSize}`);
  check(String(cs.fontWeight) === '600' || String(cs.fontWeight) === 'bold',
        `ls-sub 加粗，实际 ${cs.fontWeight}`);

  // 8.55) 按钮体系：次要描边、主操作实底，不能是纯文字
  // jsdom 算不出 var()（border/background 用了 CSS 变量），所以描边与实底直接查规则源码
  const ruleText = sel => {
    for (const sheet of win.document.styleSheets)
      for (const r of sheet.cssRules)
        if (r.selectorText && r.selectorText.split(',').map(x => x.trim()).includes(sel))
          return r.style.cssText;
    return '';
  };
  check(ruleText('.text-btn').includes('1px solid'),
        `次要按钮有 1px 描边，实际「${ruleText('.text-btn').slice(0, 90)}」`);
  const tb = win.getComputedStyle(win.document.querySelector('.text-btn'));
  check(tb.borderRadius === '999px' || parseFloat(tb.borderRadius) > 8,
        `按钮圆角胶囊，实际 ${tb.borderRadius}`);
  check(tb.cursor === 'pointer', `按钮有手型光标，实际 ${tb.cursor}`);
  check(ruleText('.text-btn.accent').includes('var(--ink)'),
        `主操作是实底，实际「${ruleText('.text-btn.accent').slice(0, 90)}」`);
  const sv = win.getComputedStyle(win.document.querySelector('.save-btn'));
  check(sv.cursor === 'pointer' && sv.borderRadius === '999px', '保存按钮是胶囊');

  // 8.6) 实时 AI 提示开关
  win.eval("clearHint(); coachQueue=['测试一句']; coachBusy=false; coachOn=true;");
  win.eval("S.cfg.ai.base_url='http://x/v1'; S.cfg.ai.model='m'; S.cfg.coach.enabled=false;");
  await win.eval('pumpCoach()');
  check(win.eval('coachQueue.length') === 1, '开关关闭时 AI 提示不跑（队列没被消费）');
  check($('speakHint').hidden, '开关关闭时没有提示弹出');
  win.eval("S.cfg.coach.enabled=true;");
  await win.eval('pumpCoach()');
  await new Promise(r => setTimeout(r, 60));
  check(win.eval('coachQueue.length') === 0, '开关打开后 AI 提示正常跑');
  check($('cOn').value === 'true', '设置回填：开关值跟随配置');
  win.eval('clearHint()');

  // 8.65) api.req 错误格式化：FastAPI 422 的 detail 是数组
  const errMsg = await win.eval(`(async () => {
    const old = window.fetch;
    window.fetch = () => Promise.resolve({ ok: false, status: 422, statusText: 'Unprocessable',
      json: async () => ({ detail: [{ loc: ['body', 'forget'], msg: 'Field required', type: 'missing' }] }) });
    try { await api.get('/api/x'); return 'NO_THROW'; }
    catch (e) { return e.message; }
    finally { window.fetch = old; }
  })()`);
  check(!/object Object/.test(errMsg), `422 错误不再是 [object Object]，实际「${errMsg}」`);
  check(/forget/.test(errMsg) && /Field required/.test(errMsg), `错误信息含字段与原因：「${errMsg}」`);

  // 8.7) 结算页：内联点评
  win.eval("S.transcript='我今天想讲一个观点。这个观点其实很重要。'; S.stats=null;");
  win.eval("S.analysis={sentences:[{quote:'这个观点其实很重要', issues:[{note:'结论来得太晚'}], suggestion:'把结论提到第一句', severity:'warn'}], summary:'整体不错'};");
  win.eval('renderTranscript()');
  const sents = [...win.document.querySelectorAll('#transcriptText .sent')];
  check(sents.length === 2, `字稿切成两句，实际 ${sents.length}`);
  check(sents[1].classList.contains('noted') && !sents[0].classList.contains('noted'),
        '只有被点评的那一句带 .noted');
  check(sents[1].classList.contains('sev-warn'), '严重程度继承到句子上');
  check(/结论来得太晚/.test(sents[1].textContent) && /把结论提到第一句/.test(sents[1].textContent),
        '点评内容内联进了字稿');
  win.eval("$('transcriptText').classList.add('show-notes'); syncNoteToggle()");
  check($('noteToggle').textContent === '隐藏点评', '展开时按钮是「隐藏点评」');
  win.eval("$('transcriptText').classList.remove('show-notes'); syncNoteToggle()");
  check($('noteToggle').textContent === '显示点评', '收起时按钮是「显示点评」');
  win.eval('S.analysis=null; syncNoteToggle()');
  check($('noteToggle').disabled, '没有复盘结果时点评开关禁用');

  // 8.8) 结算页：对比上一场
  win.eval("S.prevEntry={score:80, dur:60, stuck:2, stats:{categories:{filler:{count:6},hedging:{count:2},vague:{count:1}}, habits:[{word:'那个',count:4}], chars_per_minute:200}};");
  win.eval("S.stats={categories:{filler:{count:3},hedging:{count:1},vague:{count:0}}, habits:[{word:'就是',count:2}], chars_per_minute:240};");
  win.eval("S.stuck=1; S.speakElapsed=60000; S.speakStart=null; $('scoreNum').textContent='88';");
  win.eval('renderCompare()');
  const rows = [...win.document.querySelectorAll('#cmpBox .cmp-row')];
  check(rows.length === 5, `对比 5 项，实际 ${rows.length}`);
  check(rows[0].innerHTML.includes('cd good'), '分数 80→88 记为变好');
  check(rows[1].innerHTML.includes('cd flat'), '语速是中性项，不着色');
  check(rows[2].innerHTML.includes('cd good'), '卡壳 2→1 次记为变好');
  check(rows[4].innerHTML.includes('cd good'), '词汇密度 9→4 记为变好');
  win.eval('S.prevEntry=null; renderCompare()');
  check(/第一场/.test($('cmpBox').textContent), '没有上一场时给占位文案');

  // 8.9) 结算页：历史趋势
  win.eval("HIST=[{score:70,date:'2026-09-20T10:00:00'},{score:80,date:'2026-09-21T10:00:00'},{score:90,date:'2026-09-22T10:00:00'}];");
  win.eval('renderResultTrend()');
  const bars = [...win.document.querySelectorAll('#resultTrend i')];
  check(bars.length === 3, `趋势画 3 根柱，实际 ${bars.length}`);
  check(win.document.querySelectorAll('#resultTrend i.cur').length === 1, '最新一场高亮');
  check(/均分/.test($('resultTrendNote').textContent), `趋势有文字总结，实际「${$('resultTrendNote').textContent}」`);

  // 9) 忘词已彻底移除
  check(!$('forgetBtn') && !$('tForget') && !$('statForget'), '忘词相关元素已移除');
  check(win.eval('typeof tapForget') === 'undefined', 'tapForget 已移除');

  console.log('通过 ' + ok.length + ' 项');
  ok.forEach(s => console.log('  ✓ ' + s));
  if (fail.length) {
    console.log('\n失败 ' + fail.length + ' 项');
    fail.forEach(s => console.log('  ✗ ' + s));
    win.close(); process.exit(1);
  }
  if (errors.length) { console.log('\n运行时错误:\n' + errors.join('\n')); process.exit(1); }
  console.log('\n全部通过');
  win.close();
  process.exit(0);
})().catch(e => { console.error('冒烟测试异常:', e); process.exit(1); });
