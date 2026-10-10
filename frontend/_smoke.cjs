/* 冒烟测试：用 jsdom 跑一遍 index.html，验证新增的开讲页统计 / 设置项没把页面搞崩 */
const fs = require('fs');
const path = require('path');
const { JSDOM, requestInterceptor } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

/* 拆成多文件后，外部 JS/CSS 得能被 jsdom 加载到。
   用 requestInterceptor 把 http://localhost:8642/xx 映射到本地文件：
   origin 仍是 http（localStorage 可写、location.host 正常，后者用来拼 WebSocket），
   且不依赖后端真的在跑。注意 jsdom 30 已移除旧的 ResourceLoader 导出 */
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
const localResources = requestInterceptor(req => {
  const m = String(req.url).match(/^http:\/\/localhost:8642\/([^?]+)$/);
  if (!m) return undefined;                       // 不是本地资源就放行
  const p = path.join(__dirname, decodeURIComponent(m[1]));
  if (!fs.existsSync(p)) return undefined;
  return new Response(Buffer.from(fs.readFileSync(p)), {
    headers: { 'Content-Type': MIME[path.extname(p)] || 'text/plain' },
  });
});

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
              stuck_penalty_on: true, stuck_penalty: 3, stuck_penalty_sec: 0,
              stuck_sec: 3, wpm_fast: 330, wpm_slow: 0, filler_burst: 3 },
  display: { subtitle_size: 30, coach_size: 13.5, sentence_newline: true, show_punct: true },
  modes: {
    current: 'extemp',
    names: { extemp: '命题演讲', read: '朗读练习', free: '自由练习', interview: '面试模拟' },
    read: { leak_penalty: 1, err_penalty: 0.5, repeat_penalty: 2,
            leak_cap: 40, err_cap: 30, repeat_cap: 20 },
    interview: {
      persona: 'hr', rounds: 3, think_enabled: true, think_sec: 0, extend_sec: 10,
      suggest_sec: 90, stuck_sec: 6, auto_probe: true,
      patience: { stuck: 8, extend: 2, overtime: 5, low_relevance: 15, hint: 6 },
    },
  },
};

const RESUMES = [
  { name: '示例简历（看完就删）', target: '后端工程师 · 三年经验', text: '张示例，三年后端开发经验。做过订单服务重构。' },
];

const PERSONAS = [
  { id: 'hr', name: 'HR · 行为规范面', desc: '看重动机、协作与稳定性', style: '你是 HR',
    init_patience: 100, interrupt: false, think_sec: 15, max_sec: 120 },
  { id: 'tech', name: '技术主管 · 深挖型', desc: '只认细节和数据', style: '你是技术主管',
    init_patience: 90, interrupt: false, think_sec: 20, max_sec: 150 },
  { id: 'stress', name: '压力面 · 挑刺型', desc: '会质疑、会打断', style: '你在做压力面试',
    init_patience: 70, interrupt: true, think_sec: 8, max_sec: 90 },
  { id: 'mentor', name: '温和引导 · 新手友好', desc: '会给台阶', style: '你是温和的面试官',
    init_patience: 120, interrupt: false, think_sec: 25, max_sec: 150 },
  { id: 'general', name: '人事 · 综合面（不懂技术）', desc: '不追问技术细节', style: '你是公司的人事',
    init_patience: 110, interrupt: false, think_sec: 18, max_sec: 150 },
  { id: 'biz', name: '业务负责人 · 结果导向', desc: '只认结果和影响', style: '你是业务负责人',
    init_patience: 95, interrupt: true, think_sec: 15, max_sec: 120 },
];

const ARTICLES = [
  { title: '练习的意义', cat: '说理', text: '没有人第一次开口就能讲好。那些看起来从容的人，不过是把慌张藏在了你看不见的地方。' },
  { title: '荷塘月色（节选）', cat: '散文', text: '曲曲折折的荷塘上面，弥望的是田田的叶子。叶子出水很高。' },
];

const ROUTES = {
  '/api/config': CFG,
  '/api/bank': { '全部混合': ['题目一', '题目二'] },
  '/api/words': { filler: ['那个', '就是'], hedging: ['可能'], vague: ['东西'] },
  '/api/articles': ARTICLES,
  '/api/resumes': RESUMES,
  '/api/personas': PERSONAS,
  '/api/interview/brief': { brief: '三年后端，做过订单重构', suspects: ['QPS 提升没说怎么做的', '中间有半年空档'] },
  '/api/interview/next': { question: '说说你简历里写的订单重构，你具体做了哪几件事？', intent: '考察具体贡献', end: false },
  '/api/interview/opening': { text: '你好，我是今天的面试官。先做个自我介绍吧。' },
  '/api/interview/close': { closing: '今天就到这里吧，你这边还有什么想了解的吗？', ask_back: true },
  // 只有 id 为 b 的那一场当时生成过报告，用来验「没报告的那场也能打开结算页」
  '/api/report/b': { id: 'b', markdown: '# 复盘\n- 开场晚了半拍\n- 结尾没收住' },
  '/api/history': [],
  '/api/theme/resolve': { bg: '#0F1013', ink: '#EDEDEF', accent: '#E24B4A',
                          amber: '#D9A13B', green: '#6FBF9A', surface: '#141519', dark: true },
  '/api/speech/models': { whisper: [], sherpa: [] },
  '/api/speech/punct': { downloaded: false, enabled: false, name: '' },
  '/api/analyze/hint': { kind: '内容', hint: '你备稿里的第二条要点还没讲：把它拆成原因和对策', manual: true },
  '/api/analyze/words': { char_count: 38, chars_per_minute: 228, avg_sentence_len: 13,
                          categories: { filler: { count: 0 }, hedging: { count: 0 }, vague: { count: 0 } },
                          habits: [], marks: [] },
};

const errors = [];
const dom = new JSDOM(HTML, {
  runScripts: 'dangerously',
  url: 'http://localhost:8642/',
  pretendToBeVisual: true,
  resources: { interceptors: [localResources] },
  beforeParse(win) {
    win.confirm = () => true;
    win.prompt = () => '新分类';
    win.__hist = [];                 // 历史可写，renderDrawer 才能测到真实数据
    win.fetch = (url, opt) => {
      const key = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      if (key === '/api/history')
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => win.__hist });
      // 材料库要能真写回去（增删改），所以 PUT 按后端的校验规则回显
      if (opt && opt.method === 'PUT' && key === '/api/articles') {
        const arts = (JSON.parse(opt.body).articles || []).filter(a => a && a.title && a.text);
        ARTICLES.length = 0; ARTICLES.push(...arts);
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => arts });
      }
      if (opt && opt.method === 'PUT' && key === '/api/resumes') {
        const rs = (JSON.parse(opt.body).resumes || []).filter(r => r && r.name && r.text);
        RESUMES.length = 0; RESUMES.push(...rs);
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => rs });
      }
      // 人设同样可写：按后端规矩，名称或风格缺失的丢掉，但至少要剩一位
      if (opt && opt.method === 'PUT' && key === '/api/personas') {
        let ps = (JSON.parse(opt.body).personas || []).filter(p => p && p.name && p.style);
        if (!ps.length) ps = PERSONAS.slice();
        PERSONAS.length = 0; PERSONAS.push(...ps);
        ROUTES['/api/personas'] = PERSONAS;
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => ps });
      }
      // 题库同样要能真写回去（自定义命题改分类）
      if (opt && opt.method === 'PUT' && key === '/api/bank') {
        const bank = JSON.parse(opt.body);
        ROUTES['/api/bank'] = bank;
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => bank });
      }
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
  // 外部脚本是异步加载的，等所有模块就位再断言（core 最早、extemp 最晚）
  for (let i = 0; i < 60; i++) {
    if (typeof win.applyTheme === 'function' && typeof win.draw === 'function'
        && typeof win.endSpeak === 'function' && typeof win.saveTraining === 'function') break;
    await new Promise(r => setTimeout(r, 50));
  }
  check(typeof win.draw === 'function' && typeof win.endSpeak === 'function',
        '拆出去的外部脚本都执行了（draw / endSpeak 可调用）');
  await new Promise(r => setTimeout(r, 400));
  const $ = id => win.document.getElementById(id);

  // 1) 页面没被替换成「后端未启动」（不能查 body.textContent：它包含 <script> 源码）
  const boot = win.eval('typeof S !== "undefined" && !!S.cfg && !!S.bank');
  check(boot, '启动拿到后端配置，没落到「后端未启动」分支'
    + (boot ? '' : ' → 脚本错误: ' + (errors.join(' | ') || '（无）')));
  check(errors.length === 0, '无脚本运行时错误' + (errors.length ? ' → ' + errors.join(' | ') : ''));

  // 2) 新增元素齐全
  // statWpm 已随"结算页指标卡改为模式填充"去掉，取而代之的是容器 #statRow
  const ids = ['lsScore', 'lsScoreRow', 'lsWpm', 'lsStuck', 'lsStuckAvg', 'lsStuckTot',
               'statRow', 'hintClose', 'cMax', 'cHold', 'aiAuto', 'dKeep',
               'tAutoPause', 'tStuckSec', 'tWpmFast', 'tWpmSlow', 'tBurst'];
  const missing = ids.filter(i => !$(i));
  check(missing.length === 0, '新增元素齐全' + (missing.length ? ' 缺: ' + missing.join(',') : ''));

  // 3) 无重复 id
  const all = [...win.document.querySelectorAll('[id]')].map(e => e.id);
  const dup = all.filter((v, i) => all.indexOf(v) !== i);
  check(dup.length === 0, '无重复 id' + (dup.length ? ' → ' + [...new Set(dup)].join(',') : ''));

  // 4) 训练参数拆成块 + 一个保存按钮；「针对哪个模式」切换条算一块
  const secs = [...win.document.querySelectorAll('#settingsDrawer .set-sec[data-cat="训练"]')];
  check(secs.length === 7, `训练分类下 7 块（模式切换/计分/节奏/实时信号/词表/题库/模式专属），实际 ${secs.length}`);
  const saves = [...win.document.querySelectorAll('.train-save')];
  check(saves.length === 1, `整组只留一个保存按钮，实际 ${saves.length}`);
  const subDiv = [...win.document.querySelectorAll('#settingsDrawer .set-sec.sub')];
  check(subDiv.length === 3, `前三块不画分割线（.sub），实际 ${subDiv.length}`);

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

  // 5.5) 卡壳扣分：命题演讲里沉默到判定线就当场扣分，可关、可按模式隔离
  win.eval("S.mode='extemp'; S.stuckPenalty=0; S._stuckPenN=0; S.peek=0; S.hint=0;"
         + "S.speaking=true; S.paused=false; S.readying=false; S.speakStart=Date.now()-20000;"
         + "S.lastTextAt=Date.now()-7000;");
  win.eval('tickStuckPenalty(); updateLiveStats()');
  check(win.eval('S.stuckPenalty') === 6,
        `沉默 7 秒（判定 3 秒）扣两次 = 6，实际 ${win.eval('S.stuckPenalty')}`);
  check($('lsScore').textContent === '94', `当前分 100−6=94，实际 ${$('lsScore').textContent}`);
  check(!$('stuckPenBtn').hidden && /3 \/ 3 秒/.test($('stuckPenRule').textContent),
        `开讲页有卡壳扣分块且写明规则，实际「${$('stuckPenRule').textContent}」`);
  check(!$('lsStuckPenRow').hidden && $('lsStuckPen').textContent === '−6',
        `实时统计里出现卡壳扣分，实际「${$('lsStuckPen').textContent}」`);
  // 开口之后从头计，不会把同一段沉默重复扣
  win.eval("S.lastTextAt=Date.now(); S._stuckPenN=0;");
  win.eval('tickStuckPenalty()');
  check(win.eval('S.stuckPenalty') === 6, '重新开口后不重复扣同一段沉默');
  // 关掉开关就不扣
  win.eval("S.cfg.training.stuck_penalty_on=false; S.lastTextAt=Date.now()-9000; S._stuckPenN=0;");
  win.eval('tickStuckPenalty(); updateLiveStats()');
  check(win.eval('S.stuckPenalty') === 6, '关掉卡壳扣分后不扣分');
  check($('stuckPenBtn').hidden, '关掉后开讲页那块也收起来');
  win.eval("S.cfg.training.stuck_penalty_on=true;");
  // 只有命题演讲按扣分算：朗读、自由说不加这一项
  win.eval("S.mode='read';");
  check(win.eval('stuckPenaltyOn()') === false, '朗读不参与卡壳扣分');
  win.eval("S.mode='free';");
  check(win.eval('stuckPenaltyOn()') === false, '自由说不参与卡壳扣分');
  win.eval("S.mode='extemp'; S.stuckPenalty=0; S._stuckPenN=0;");
  // 设置项：三个新控件读写都通
  win.eval('fillSettings()');
  check(String($('tStuckPenOn').value) === 'true' && +$('tStuckPen').value === 3
        && +$('tStuckPenSec').value === 0,
        `设置里带着卡壳扣分的三项，实际 ${$('tStuckPenOn').value}/${$('tStuckPen').value}/${$('tStuckPenSec').value}`);
  {
    const old = win.fetch; let saved = null;
    win.fetch = (u, o) => { if (String(u).includes('/api/config') && o && o.method === 'PUT') {
      saved = JSON.parse(o.body); } return old(u, o); };
    await win.eval("(async()=>{ $('tStuckPen').value='5'; $('tStuckPenSec').value='4';"
                 + "$('tStuckPenOn').value='false'; await saveTraining(); })()");
    win.fetch = old;
    const t = saved && saved.training;
    check(t && t.stuck_penalty === 5 && t.stuck_penalty_sec === 4 && t.stuck_penalty_on === false,
          '卡壳扣分三项能存进配置');
    win.eval("S.cfg.training.stuck_penalty=3; S.cfg.training.stuck_penalty_sec=0;"
           + "S.cfg.training.stuck_penalty_on=true; fillSettings();");
  }

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
  const kidOrder = [...ctrl.children].map(e => e.id || e.className);
  check(kidOrder.indexOf('lsScoreRow') >= 0 &&
        kidOrder.indexOf('lsScoreRow') < kidOrder.findIndex(c => /rec-row/.test(c)),
        '当前分排在 rec-row 之前');
  const cs = win.getComputedStyle(win.document.querySelector('.ls-sub'));
  check(cs.fontSize === '14px', `ls-sub 保持 14px（用户指定），实际 ${cs.fontSize}`);
  // 全站字号底线：不能再出现 12px 及以下（.set-cat-tag 9px 是唯一豁免）
  const small = [...win.document.querySelectorAll('.stage, .drawer')]
    .flatMap(e => [...e.querySelectorAll('*')])
    .filter(e => { const f = win.getComputedStyle(e).fontSize; return f && parseFloat(f) < 13; })
    .filter(e => !e.classList.contains('set-cat-tag'));
  check(small.length === 0, `页面无 12px 以下文字（除角标），实际 ${small.length} 个：${
    small.slice(0, 3).map(e => (e.className || e.tagName) + '@' + win.getComputedStyle(e).fontSize).join(', ')}`);
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
  check(!/undefined/.test($('cmpBox').textContent),
        `对比值真的取到了，实际「${$('cmpBox').textContent}」`);
  check(rows[0].textContent.includes('88'), `本场分数渲染进去了，实际「${rows[0].textContent}」`);
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

  // 8.95) 模式注册表与切换
  check(win.eval("Object.keys(MODES).sort().join(',')") === 'extemp,free,interview,read',
        `注册了四个模式，实际 ${win.eval('Object.keys(MODES).join(",")')}`);
  const mbtns = [...win.document.querySelectorAll('#modeSwitch .mode-btn')];
  check(mbtns.length === 4, `页头渲染 4 个模式按钮，实际 ${mbtns.length}`);
  check(mbtns[0].classList.contains('on'), '默认停在命题演讲');
  check($('stage-draw').classList.contains('active'), '初始阶段是抽题页');

  // 8.96) 切到朗读：阶段序列换成 选材料→开讲→结算
  await win.eval("switchMode('read')");
  await new Promise(r => setTimeout(r, 60));
  check($('stage-read-pick').classList.contains('active'), '切到朗读后进入选材料页');
  check(win.document.querySelectorAll('#phaseDots i').length === 3,
        `朗读是 3 个阶段点，实际 ${win.document.querySelectorAll('#phaseDots i').length}`);
  const mbtns2 = [...win.document.querySelectorAll('#modeSwitch .mode-btn')];
  check(mbtns2[1].classList.contains('on') && !mbtns2[0].classList.contains('on'),
        '切换按钮高亮跟着走');
  check($('homeBtn').textContent === '换一篇', `结算页回程按钮文案随模式变，实际「${$('homeBtn').textContent}」`);
  const arts = [...win.document.querySelectorAll('#artList .art-item')];
  check(arts.length === 2, `材料列表渲染 2 篇，实际 ${arts.length}`);
  win.eval("artIdx=0; renderPick()");
  check(/没有人第一次开口/.test($('artPreview').textContent), '选中材料后预览出正文');
  check($('toReadSpeakBtn').classList.contains('ready'), '选中材料后开讲按钮变主操作');

  // 8.965) 材料可增删改，类型可填已有也可写新的
  await win.eval(`(async()=>{
    $('artTitle').value='我自己加的一篇'; $('artCatInput').value='自拟'; $('artText').value='这是我自己写的正文。';
    await saveArt();
  })()`);
  check(win.eval('S.articles.length') === 3, `新增后 3 篇，实际 ${win.eval('S.articles.length')}`);
  check(win.eval("S.articles[2].cat") === '自拟', `新类型写进去，实际 ${win.eval('S.articles[2].cat')}`);
  const chips = [...win.document.querySelectorAll('#artCatChips .cat-chip')].map(e => e.textContent);
  check(chips.includes('自拟'), `分类标签自动多出新类型，实际 ${chips.join('/')}`);
  check(win.eval('artIdx') === 2, '新增后自动选中这一篇');

  // 编辑：改标题 + 改类型（把「散文」那篇挪到「自拟」）
  win.eval("startEditArt(1)");
  check($('artFold').classList.contains('open'), '点编辑会展开管理区');
  check($('artSaveBtn').textContent === '保存修改' && !$('artDelBtn').hidden, '进入编辑态：按钮变保存/出现删除');
  check($('artTitle').value === '荷塘月色（节选）', `编辑时回填标题，实际「${$('artTitle').value}」`);
  await win.eval(`(async()=>{ $('artCatInput').value='自拟'; await saveArt(); })()`);
  check(win.eval("S.articles[1].cat") === '自拟', `改类型生效，实际 ${win.eval('S.articles[1].cat')}`);
  check(win.eval('artEditIdx') === -1, '保存后退出编辑态');

  // 删除
  win.eval('startEditArt(1)');
  await win.eval('delArt()');
  check(win.eval('S.articles.length') === 2, `删除后 2 篇，实际 ${win.eval('S.articles.length')}`);
  check(win.eval('artCat') === '全部', '删完把筛选退回「全部」，避免看着空列表');
  // 还原现场，后面的用例还用得上
  win.eval(`S.articles=[
    {title:'练习的意义', cat:'说理', text:'没有人第一次开口就能讲好。那些看起来从容的人，不过是把慌张藏在了你看不见的地方。'},
    {title:'荷塘月色（节选）', cat:'散文', text:'曲曲折折的荷塘上面，弥望的是田田的叶子。叶子出水很高。'}];
    artIdx=0; artCat='全部'; artEditIdx=-1; artFormShown=null; renderPick();`);
  check(win.eval('S.articles.length') === 2 && win.eval('S.articles[0].title') === '练习的意义',
        '现场已还原');

  // 8.97) 比对算法：漏读 / 错读 / 多读 / 重复
  const al = win.eval(`JSON.stringify(alignStats('今天天气很好我们出去玩吧', '今天天气好我们出去玩玩吧'))`);
  const a = JSON.parse(al);
  check(a.miss === 1 && a.err === 0 && a.add === 1, `漏 1 多 1：${al}`);
  const al2 = JSON.parse(win.eval(`JSON.stringify(alignStats('今天天气很好', '今天天汽很好'))`));
  check(al2.err === 1 && al2.miss === 0 && al2.add === 0, `同音错读算 1 次错读：${JSON.stringify(al2)}`);
  const al3 = JSON.parse(win.eval(`JSON.stringify(alignStats('我们出去玩', '我们我们出去玩'))`));
  check(al3.repeat === 1, `回头重读计入重复：${JSON.stringify(al3)}`);
  const al4 = JSON.parse(win.eval(`JSON.stringify(alignStats('一二三四五', '一二三四五'))`));
  check(al4.coverage === 100 && al4.accuracy === 100 && al4.miss === 0, `全对：${JSON.stringify(al4)}`);
  check(win.eval(`alignHtml('今天天气很好','今天天汽很好')`).includes('al-miss'), '结算比对把漏读的位置标出来');
  check(win.eval(`alignSourceHtml('今天天气很好','今天')`).includes('al-cur'), '实时原文给出当前落点游标');
  check(!win.eval(`alignSourceHtml('今天天气很好','')`).includes('al-miss'),
        '一个字没读时不把整篇判成漏读');

  // 8.98) 朗读结算：算分 / 指标卡 / 比对视图
  win.eval("S.article=S.articles[0]; S.topic=S.article.title; S.mode='read';");
  win.eval("S.transcript='没有人第一次开口就能讲好。那些看起来从容的人，不过是把慌张藏在了你看不见的地方。';");
  // end() 是 async，eval 里不能顶层 await，用 IIFE 把结果挂到 window 上再取
  const runEnd = async ()=>{
    win.eval('window.__rr = null; (async()=>{ window.__rr = await MODES.read.end(30); })()');
    for(let i=0;i<40 && !win.eval('window.__rr');i++) await new Promise(r=>setTimeout(r,25));
    return JSON.parse(win.eval('JSON.stringify(window.__rr)'));
  };
  const rr = await runEnd();
  check(rr.score === 100, `照原文一字不差 = 100 分，实际 ${rr.score}`);
  check(rr.cells.length === 7 && rr.cells.some(c => c.k === '漏读'), `朗读指标卡 7 项含漏读，实际 ${rr.cells.length}`);
  check(/rc-sum/.test(rr.compareHtml) && /rc-body/.test(rr.compareHtml), '结算页给出原文比对');

  // 开讲页的模式差异：朗读挂原文、藏扣分按钮；命题演讲相反
  win.eval("applySpeakMode()");
  check(!$('readSource').hidden && /荷塘|练习的意义|没有/.test($('readSource').textContent),
        '朗读开讲页显示原文');
  check($('penaltyCol').hidden, '朗读开讲页不显示看稿/提示扣分');
  // 光有 hidden 属性不够：.penalty-col 有 display:flex，会盖掉 hidden 的默认样式
  check(win.getComputedStyle($('penaltyCol')).display === 'none',
        `扣分块真的不占位，实际 display=${win.getComputedStyle($('penaltyCol')).display}`);
  // 朗读下「当前分」换成实时完整度（按看稿扣分算出来的恒为 100，等于没信息）
  check($('lsScoreRow').querySelector('span').textContent === '完整度',
        `开讲页标签随模式变，实际「${$('lsScoreRow').querySelector('span').textContent}」`);
  win.eval("S.transcript='没有人第一次开口就能讲好。'; MODES.read.tick();");
  check(/%$/.test($('lsScore').textContent), `开讲中显示完整度百分比，实际「${$('lsScore').textContent}」`);
  win.eval("S.mode='extemp'; applySpeakMode();");
  check($('readSource').hidden && !$('penaltyCol').hidden, '命题演讲开讲页不显示原文、显示扣分按钮');
  check(win.getComputedStyle($('penaltyCol')).display === 'flex',
        `命题演讲下扣分块恢复显示，实际 display=${win.getComputedStyle($('penaltyCol')).display}`);
  win.eval("S.mode='read';");

  // 8.981) 朗读的「对比上一场」：取的是 align 里的指标，不是命题演讲那套
  win.eval("S.prevEntry={score:80, stats:{align:{accuracy:90,coverage:88,miss:5,err:2,repeat:1}}};");
  win.eval("S.stats={align:{accuracy:96,coverage:94,miss:3,err:1,repeat:0}}; $('scoreNum').textContent='92';");
  win.eval('renderCompare()');
  const rrows = [...win.document.querySelectorAll('#cmpBox .cmp-row')];
  check(rrows.length === 5, `朗读对比 5 项，实际 ${rrows.length}`);
  check(!/undefined/.test($('cmpBox').textContent),
        `朗读对比值不是 undefined，实际「${$('cmpBox').textContent}」`);
  check(rrows[0].textContent.includes('96'), `准确率 96% 渲染进去了，实际「${rrows[0].textContent}」`);
  check(rrows[0].innerHTML.includes('cd good'), '准确率 90→96 记为变好');
  check(rrows[2].innerHTML.includes('cd good'), '漏读 5→3 记为变好');
  win.eval('S.prevEntry=null;');
  win.eval("S.transcript='没有人第一次开口就能讲好。';");
  const rr2 = await runEnd();
  check(rr2.score < 100 && rr2.score >= 60, `漏掉后半段扣分但不砸到 0，实际 ${rr2.score}`);
  check(win.eval('!!S.stats.align'), '比对结果写进 stats.align（历史与报告都要读它）');

  // 训练中切模式要拦一下，不能默默丢掉本场
  win.eval("S.speaking=true; window.confirm=()=>false;");
  await win.eval("switchMode('extemp')");
  check(win.eval("S.mode") === 'read', '训练进行中取消切换 → 模式保持不变');
  win.eval("window.confirm=()=>true;");
  await win.eval("switchMode('extemp')");
  check(win.eval("S.mode") === 'extemp' && win.eval('S.speaking') === false,
        '确认后切回命题演讲并停掉本场');
  check($('stage-draw').classList.contains('active'), '切回命题演讲落到抽题页');
  check(win.eval('MODES.read.speak.peek === false && MODES.extemp.speak.peek === true'),
        '看稿扣分只属于命题演讲（朗读本就照着读）');
  check(win.eval('MODES.read.speak.source === true && MODES.extemp.speak.source === false'),
        '原文面板只属于朗读');

  // 8.985) 自由练习：不抽题、不备稿、不评分
  await win.eval("switchMode('free')");
  await new Promise(r => setTimeout(r, 60));
  check($('stage-free').classList.contains('active'), '切到自由练习落在起始页');
  check(win.document.querySelectorAll('#phaseDots i').length === 3,
        `自由练习是 3 个阶段点，实际 ${win.document.querySelectorAll('#phaseDots i').length}`);
  check($('freeStartBtn') && /开始说话/.test($('freeStartBtn').textContent), '有开始按钮');
  win.eval("applySpeakMode()");
  check($('penaltyCol').hidden && $('readSource').hidden, '自由练习开讲页没有扣分按钮也没有原文');
  check($('lsScoreRow').hidden && win.getComputedStyle($('lsScoreRow')).display === 'none',
        `不评分 → 收起「当前分」，实际 display=${win.getComputedStyle($('lsScoreRow')).display}`);
  check(win.getComputedStyle(win.document.querySelector('.rec-row')).marginLeft === 'auto',
        '计时靠右（左侧没东西时不跑偏）');

  // 结算：score 为 null，指标卡是时长/语速/字数/卡壳
  win.eval("S.topic='聊了聊最近的工作'; S.transcript='我今天想随便说点什么。最近工作挺忙的。'; S.stuck=1; S.stuckMs=4000;");
  const fr = await (async () => {
    win.eval('window.__fr = null; (async()=>{ window.__fr = await MODES.free.end(45); })()');
    for (let i = 0; i < 40 && !win.eval('window.__fr'); i++) await new Promise(r => setTimeout(r, 25));
    return JSON.parse(win.eval('JSON.stringify(window.__fr)'));
  })();
  check(fr.score === null, `自由练习不评分（score 为 null），实际 ${JSON.stringify(fr.score)}`);
  check(fr.cells.length === 5 && fr.cells.some(c => c.k === '字数'), `指标卡 5 项含字数，实际 ${fr.cells.length}`);
  check(fr.topic === '聊了聊最近的工作', `主题带过去，实际「${fr.topic}」`);
  check(!fr.cells.some(c => c.k === '看稿' || c.k === '提示'), '不出现看稿/提示指标');

  // 结算页：分数位显示占位而不是数字，也不染色
  win.eval("S.mode='free'; S.score=null; $('scoreNum').textContent='—'; $('scoreNum').className='score-num';");
  check($('scoreNum').textContent === '—', '不评分时分数位显示占位');
  check(!/good|mid|bad/.test($('scoreNum').className), '占位不染色');
  // 报告请求不能把 NaN 发出去（此前是 +$('scoreNum').textContent）
  const repBody = await win.eval(`(async()=>{
    const old = window.fetch; let sent = null;
    window.fetch = (u,o)=>{ sent = o && o.body; return Promise.resolve({ok:true,status:200,statusText:'OK',json:async()=>({markdown:'x'})}); };
    try{ await $('reportBtn').click(); }catch(e){}
    window.fetch = old; return sent;
  })()`);
  check(!/NaN/.test(String(repBody)), `报告请求里没有 NaN，实际 ${String(repBody).slice(0, 90)}`);
  check(/"score":null/.test(String(repBody)), '不评分时报告请求带 score:null');

  // 历史：不评分的场次显示「—」，且不计入均分
  // renderDrawer 会去拉 /api/history，所以要把数据放进 mock 的 __hist 而不是直接改 HIST
  win.eval("window.__hist=[{id:'a',mode:'free',score:null,dur:60,topic:'自由一场'},{id:'a2',mode:'free',score:null,dur:90,topic:'自由二场'},{id:'b',mode:'extemp',score:90,dur:60,topic:'命题一场'},{id:'c',mode:'extemp',score:70,dur:60,topic:'命题二场'}];");
  await win.eval('renderDrawer()');
  check($('statSessions').textContent === '4', `场次统计含不评分的，实际 ${$('statSessions').textContent}`);
  check($('statAvg').textContent === '80', `均分只算有分的（90+70)/2=80，实际 ${$('statAvg').textContent}`);
  check($('statBest').textContent === '90', `最佳只算有分的，实际 ${$('statBest').textContent}`);
  const hlScores = [...win.document.querySelectorAll('#historyList .hl-score')].map(e => e.textContent);
  check(hlScores.includes('—'), `列表里不评分显示占位，实际 ${hlScores.join('/')}`);
  win.eval("S.mode='free'; S.entryId='a'; renderResultTrend()");
  check(/不评分/.test($('resultTrendNote').textContent),
        `自由练习的趋势文案，实际「${$('resultTrendNote').textContent}」`);
  check(win.document.querySelectorAll('#resultTrend i.none').length === 2, `不评分的柱子标出来，实际 ${win.document.querySelectorAll('#resultTrend i.none').length}`);

  // 8.995) 历史回看：任何一场都能点开那一屏，不是只有生成过报告的才看得着
  win.eval("window.__hist=["
         + "{id:'a',mode:'extemp',score:70,dur:60,topic:'没报告那场',peek:2,stuck:3,hint:1,"
         + "rating:'依赖明显',rule:'基础 100 · 看稿 −10/次',"
         + "cells:[{v:'01:00',k:'时长'},{v:2,k:'看稿',pen:true}],"
         + "transcript:'我当时讲的是这个。',stats:{char_count:8,chars_per_minute:120,avg_sentence_len:8,"
         + "categories:{filler:{count:1},hedging:{count:0},vague:{count:0}},habits:[],marks:[]},analysis:{}},"
         + "{id:'b',mode:'extemp',score:90,dur:60,topic:'有报告那场',rating:'脱稿如流',rule:'基础 100',"
         + "cells:[{v:'01:00',k:'时长'}],transcript:'好的。',"
         + "stats:{char_count:2,chars_per_minute:60,avg_sentence_len:2,"
         + "categories:{filler:{count:0},hedging:{count:0},vague:{count:0}},habits:[],marks:[]},analysis:{}}];");
  await win.eval('renderDrawer()');
  win.eval("document.querySelector('#historyList li').click()");
  await new Promise(r => setTimeout(r, 400));
  check($('stage-result').classList.contains('active'), '点历史整条就打开那一场的结算页');
  check($('resultTopic').textContent === '没报告那场',
        `标题是那一场，实际「${$('resultTopic').textContent}」`);
  check($('scoreNum').textContent === '70' && $('scoreRating').textContent === '依赖明显',
        `分数与评级带出来，实际 ${$('scoreNum').textContent}/${$('scoreRating').textContent}`);
  check(/看稿/.test($('statRow').textContent), `指标卡也在，实际「${$('statRow').textContent}」`);
  check(/我当时讲/.test($('transcriptText').textContent), '那一场的字稿也在');
  check(win.eval('S.entryId') === 'a', '回看时锁住这一场的 id，报告才能生成到它头上');
  check($('reportBtn').textContent === '生成报告' && $('reportMd').style.display === 'none',
        '没生成过报告的场次：留着生成按钮，不报错');
  await win.eval("viewHistory(window.__hist[1])");
  await new Promise(r => setTimeout(r, 400));
  check(/开场晚了半拍/.test($('reportMd').textContent), '有报告的那场直接把报告带出来');
  check($('resultTopic').textContent === '有报告那场', '切到另一场也照常复现');

  await win.eval("switchMode('extemp')");
  check(win.eval("S.mode") === 'extemp', '切回命题演讲');

  // 8.99) 题库 YAML 往返：设置里生成的必须能被自己解析
  // 此前 yamlBankString 把分类缩进在「分类:」之下，而解析器要求分类顶格 → 点保存必失败
  win.eval("S.bank={'观点思辨':['题一','题二'],'职场汇报':['题三']};");
  win.eval('window.__gen = yamlBankString()');
  win.eval('window.__rt = parseBankYaml(window.__gen)');
  const rt = JSON.parse(win.eval('JSON.stringify(window.__rt)'));
  check(rt['观点思辨'] && rt['观点思辨'].length === 2 && rt['职场汇报'][0] === '题三',
        `设置里生成的 YAML 能原样解析回来，实际 ${JSON.stringify(rt)}`);
  check(win.eval('window.__gen').split('\n')[0] === '观点思辨:',
        `分类顶格写，实际首行「${win.eval('window.__gen').split('\n')[0]}」`);
  // 导出文件的格式（version 行 + categories 包装层 + 整体缩进一层）也要能吃
  win.eval('window.__exp = ' + JSON.stringify(
    'version: 1\ncategories:\n  观点思辨:\n  - "题一"\n  - 题二\n  职场汇报:\n  - 题三\n'));
  win.eval('window.__rt2 = parseBankYaml(window.__exp)');
  const rt2 = JSON.parse(win.eval('JSON.stringify(window.__rt2)'));
  check(rt2['观点思辨']?.length === 2 && rt2['职场汇报']?.length === 1 && !rt2['categories'],
        `导出的 YAML 能解析，实际 ${JSON.stringify(rt2)}`);
  // Windows 换行 + 半角冒号结尾的题目不能被误认成分类
  win.eval('window.__rt3 = parseBankYaml(' + JSON.stringify('观点思辨:\r\n  - 什么是AI:\r\n') + ')');
  check(win.eval('window.__rt3["观点思辨"][0]') === '什么是AI:',
        `冒号结尾的题目仍是题目，实际 ${JSON.stringify(win.eval('JSON.stringify(window.__rt3)'))}`);

  // 8.991) 自定义命题可改分类
  win.eval("S.bank={'观点思辨':['题一'],'自定义':['我的题']}; renderCustom();");
  const ccSels = [...win.document.querySelectorAll('#customList .cc')];
  check(ccSels.length === 1, `每条自定义命题带分类下拉，实际 ${ccSels.length}`);
  check([...ccSels[0].options].some(o => o.value === '观点思辨'), '下拉里能选到已有分类');
  check([...ccSels[0].options].some(o => o.value === '__new__'), '下拉里能新建分类');
  await win.eval("(async()=>{ await moveCustom(0,'观点思辨'); })()");
  check(win.eval("JSON.stringify(S.bank['观点思辨'])") === '["题一","我的题"]',
        `挪过去后并入目标分类，实际 ${win.eval("JSON.stringify(S.bank['观点思辨'])")}`);
  check(win.eval("!S.bank['自定义']"), '挪空后「自定义」分类被摘掉，不留空分类');
  // 新建分类
  win.eval("$('customInput').value='新题'; $('customCat').value='__new__';");
  await win.eval('addCustom()');
  check(win.eval("!!S.bank['新分类']"), `选「新建分类」时按输入建类，实际 ${win.eval('JSON.stringify(Object.keys(S.bank))')}`);
  win.eval("S.bank={'观点思辨':['题一'],'职场汇报':['题二'],'自定义':['题三']}; renderCustom(); buildCatChips();");

  // 8.992) 模型加载提示要够显眼：转圈 + 描边底 + loading 态
  check(!!win.document.querySelector('#micNote .mn-spin'), '加载提示带转圈');
  win.eval("$('micNote').classList.add('show','loading'); $('micNoteText').textContent='识别模型加载中…';");
  const mn = win.getComputedStyle($('micNote'));
  check(mn.display === 'flex', `显示时是 flex（居中排布），实际 ${mn.display}`);
  const mnRule = ruleText('.mic-note');
  check(mnRule.includes('1px solid') && mnRule.includes('999px'),
        `有描边和胶囊底，实际「${mnRule.slice(0, 80)}」`);
  check(ruleText('.mic-note.loading .mn-spin').includes('display: block'),
        '只有加载态才显示转圈（麦克风未授权时不转）');
  win.eval("$('micNote').classList.remove('show','loading');");

  // 8.993) 面试模拟：挑简历 → 选人设 → 一场多轮
  await win.eval("switchMode('interview')");
  check(win.eval("S.mode") === 'interview', '切到面试模拟');
  check($('stage-intv-resume').classList.contains('active'), '落在挑简历页');
  check(win.getComputedStyle($('stage-intv-resume')).visibility === 'visible',
        `活跃阶段可见，实际 ${win.getComputedStyle($('stage-intv-resume')).visibility}`);
  check(win.getComputedStyle($('stage-draw')).visibility === 'hidden',
        `非活跃阶段彻底失效，实际 ${win.getComputedStyle($('stage-draw')).visibility}`);
  check(win.document.querySelectorAll('#resumeList .resume-item').length === 1, '简历列表渲染出来');
  // 没有 AI 就没有面试官，这一步必须挡住（但按钮仍要看得见，只是灰着）
  win.eval("S.cfg.ai.base_url=''; S.cfg.ai.model=''; renderResumes();");
  check(!$('intvNoAI').hidden && $('intvToSetupBtn').disabled, '没配 AI 时挡一道');
  win.eval("S.cfg.ai.base_url='http://x'; S.cfg.ai.model='m'; renderResumes();");
  check($('intvNoAI').hidden && !$('intvToSetupBtn').disabled, '配好 AI 就能往下走');
  // 简历库增删改
  await win.eval("(async()=>{ editResume(-1); $('resumeName').value='我的简历'; $('resumeText').value='某某，五年经验。'; await saveResume(); })()");
  check(win.eval('S.resumes.length') === 2, `新增一份简历，实际 ${win.eval('S.resumes.length')}`);
  await win.eval("(async()=>{ editResume(1); $('resumeName').value='改过的名字'; await saveResume(); })()");
  check(win.eval("S.resumes[1].name") === '改过的名字', '改名字生效');
  await win.eval("(async()=>{ editResume(1); await delResume(); })()");
  check(win.eval('S.resumes.length') === 1, '删除生效');

  win.eval("pickResume(0); $('intvToSetupBtn').click();");
  check($('stage-intv-setup').classList.contains('active'), '进入设置页');
  check(win.document.querySelectorAll('#personaList .persona').length === 6,
        `6 个人设可选，实际 ${win.document.querySelectorAll('#personaList .persona').length}`);
  check([...win.document.querySelectorAll('#personaList .persona')].some(e => /人事/.test(e.textContent)),
        '人设里有不追问技术的人事面试官');
  // 「下一步」「开始面试」必须真的看得见——.next-btn 默认是隐形的，靠 CSS 显式显形
  check(ruleText('#intvToSetupBtn').includes('opacity: 1') && ruleText('#intvStartBtn').includes('opacity: 1'),
        `面试的两个推进按钮显形，实际「${ruleText('#intvToSetupBtn')} | ${ruleText('#intvStartBtn')}」`);
  check(!$('intvRounds'), '问答轮数已经移除');
  win.eval("S.persona = S.personas.find(p=>p.id==='tech'); renderPersonas();");
  check(/技术主管/.test(win.document.querySelector('#personaList .persona.on').textContent),
        '选中的人设有标记');
  // 人设增删改
  await win.eval("(async()=>{ editPersona(-1); $('pName').value='产品总监'; $('pDesc').value='看商业 sense'; $('pStyle').value='你是产品总监，只关心业务价值'; await savePersona(); })()");
  check(win.eval('S.personas.length') === 7, `新增一位面试官，实际 ${win.eval('S.personas.length')}`);
  check(!!win.eval("S.personas.find(p=>p.name==='产品总监')"), '新人设有 id 且进了列表');
  await win.eval("(async()=>{ editPersona(S.personas.length-1); $('pOpening').value='聊聊你做过的最值钱的决定'; await savePersona(); })()");
  check(win.eval("S.personas.find(p=>p.name==='产品总监').opening") === '聊聊你做过的最值钱的决定',
        '开场白能存进人设');
  await win.eval("(async()=>{ editPersona(S.personas.length-1); await delPersona(); })()");
  check(win.eval('S.personas.length') === 6, '删除人设生效');
  // AI 生成开场白：把表单内容原样发出去，不要求先保存
  let openingReq = null;
  {
    const old = win.fetch;
    win.fetch = (u, o) => { if (String(u).includes('/api/interview/opening')) {
      openingReq = JSON.parse(o.body); return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => ({ text: '你好，我是面试官。' }) });
    } return old(u, o); };
    await win.eval("(async()=>{ editPersona(0); $('intvTarget').value='后端工程师'; await genOpening(); })()");
    win.fetch = old;
  }
  check(openingReq && openingReq.persona && openingReq.persona.style === '你是 HR',
        '生成开场白带着表单里的人设');
  check($('pOpening').value === '你好，我是面试官。', '生成结果填回输入框');

  // 开讲页：没有看稿、留着提示、有耐心条、结束按钮换文案、实时教练关掉
  // 顺带：S.topic 里还压着上一场命题演讲的题目，面试开讲页不能把它显示出来
  win.eval("S.topic='上一场的命题题���'; S.mode='interview'; applySpeakMode();");
  check($('speakTopic').hidden && $('speakTopic').textContent === '',
        `面试开讲页不显示上一场的题目，实际「${$('speakTopic').textContent}」`);
  win.eval("S.mode='extemp'; applySpeakMode();");
  check(!$('speakTopic').hidden && /上一场/.test($('speakTopic').textContent),
        '命题演讲照常显示题目');
  win.eval("S.mode='interview'; applySpeakMode();");
  check($('peekBtn').hidden && !$('hintBtn').hidden, '面试没有看稿，只留提示');
  check(!$('penaltyCol').hidden, '扣分块还在（装着提示按钮）');
  check(win.getComputedStyle($('peekBtn')).display === 'none', '看稿按钮真的不占位');
  check(!$('patienceRow').hidden && !$('resumeBtn').hidden, '耐心条与看简历按钮出现');
  check($('endSpeakBtn').textContent === '结束面试', `结束按钮换文案，实际「${$('endSpeakBtn').textContent}」`);
  check(!$('readSource').hidden, '面试官面板挂上了');
  check(win.eval("(curMode().speak||{}).coach") === false, '关掉实时 AI 提示');
  check(win.eval('stuckSec()') === 6, `面试的卡壳判定是 6 秒，实际 ${win.eval('stuckSec()')}`);

  // 多轮：整场字稿跨轮累计，本轮字稿靠 roundFrom 切出来
  win.eval("S.transcript=''; S.rounds=[]; S.target='后端工程师'; S.initPatience=100; S.patience=100; beginRound();");
  win.eval("S.transcript += '第一轮回答。';");
  check(win.eval('roundText()') === '第一轮回答。', '本轮只取本轮的字');
  win.eval("S.rounds.push({q:'第一问', text: roundText(), dur:30, stuck:1, fb:null}); beginRound();");
  win.eval("S.transcript += '第二轮回答。';");
  check(win.eval('roundText()') === '第二轮回答。', '换轮后本轮字稿重新起算');
  check(win.eval('S.transcript') === '第一轮回答。第二轮回答。', '整场字稿跨轮保留');
  win.eval("S.rounds.push({q:'第二问', text: roundText(), dur:40, stuck:0, fb:null});");

  // 耐心：本地规则扣，UI 跟着走
  win.eval('dropPatience(30)');
  check(win.eval('S.patience') === 70, `扣耐心，实际 ${win.eval('S.patience')}`);
  check($('patienceVal').textContent === '70', '耐心条跟着走');
  // 扣耐心要当场说清楚是为什么扣的，光掉数字没人看得懂
  win.eval('dropPatience(5, "卡壳 1 次")');
  check(/卡壳 1 次/.test($('ipReact').textContent) && !$('ipReact').hidden,
        `反应行说明扣耐心原因，实际「${$('ipReact').textContent}」`);
  check(win.eval('S.patience') === 65, `继续扣，实际 ${win.eval('S.patience')}`);
  // 面试官可以在人设里关掉扣耐心：关掉后只提示，数字不动
  win.eval('S.persona = Object.assign({}, S.persona, {patience_on:false})');
  win.eval('dropPatience(20, "又多想了 10 秒")');
  check(win.eval('S.patience') === 65, `关掉后不再扣，实际 ${win.eval('S.patience')}`);
  check(/又多想了 10 秒/.test($('ipReact').textContent), '关掉后仍提示发生了什么');
  win.eval('S.persona = Object.assign({}, S.persona, {patience_on:true})');
  win.eval('S.patience = 70');

  // 维度分取各轮均值，总分按权重算（针对性 .3 证据 .25 结构 .2 清晰度 .15 时长 .1）
  win.eval("S.rounds[0].fb={dims:{relevance:60,structure:50,evidence:40,length:80,clarity:65}};");
  win.eval("S.rounds[1].fb={dims:{relevance:80,structure:70,evidence:60,length:90,clarity:75}};");
  const dm = JSON.parse(win.eval('JSON.stringify(dimsAvg())'));
  check(dm.relevance === 70 && dm.evidence === 50, `维度取各轮均值，实际 ${JSON.stringify(dm)}`);
  check(win.eval('totalScore(dimsAvg())') === 65, `总分按权重算，实际 ${win.eval('totalScore(dimsAvg())')}`);
  win.eval('S.patience = 0');
  check(win.eval('totalScore(dimsAvg())') === 39, `耐心归零总分打折，实际 ${win.eval('totalScore(dimsAvg())')}`);
  win.eval('S.patience = 70');

  // 结算：交出分数、五维 + 耐心、轮次明细
  win.eval("window.__ir = null; (async()=>{ window.__ir = await MODES.interview.end(120); })()");
  for (let i = 0; i < 40 && !win.eval('window.__ir'); i++) await new Promise(r => setTimeout(r, 25));
  const ir = JSON.parse(win.eval('JSON.stringify(window.__ir)'));
  check(ir.score === 65, `结算总分，实际 ${ir.score}`);
  check(ir.cells.length === 6 && ir.cells.some(c => c.k === '针对性') && ir.cells.some(c => c.k === '耐心剩余'),
        `指标卡是五维 + 耐心，实际 ${ir.cells.map(c => c.k).join('/')}`);
  check(ir.entry.rounds.length === 2 && ir.entry.rounds[0].q === '第一问', '历史里存的是每一轮');
  check(ir.entry.patience === 70 && ir.entry.init_patience === 100, '耐心带进历史');
  const ixp = JSON.parse(win.eval('JSON.stringify(curMode().reportExtra())'));
  check(ixp.rounds.length === 2 && ixp.patience === 70, '报告额外带上轮次与耐心');
  check(/面试|技术主管|HR/.test(ir.cat), `结算副标题带人设与轮数，实际「${ir.cat}」`);
  // 8.9935) 反应：点「答完了」必须立刻有反馈，不能先静默几秒
  win.eval("S.mode='interview'; S.speaking=true; S.paused=false; S.probing=false;"
         + "S._intvBoot=false; S._intvEval=false; intvEnding=false;"
         + "S.rounds=[]; S.patience=100; S.initPatience=100; S.transcript='我讲完了'; beginRound();");
  const pend = win.eval("(async()=>{ await endRound('answer'); })()");
  check(win.eval('S._intvEval') === true, '点「答完了」立刻切到「面试官在看这一轮」');
  check(/面试官在看这一轮回答|正在想/.test($('readSource').textContent),
        `面板当场给出状态，实际「${$('readSource').textContent.slice(0, 40)}」`);
  check($('pauseSpeakBtn').disabled, '面试官没开口时暂停按钮禁用');
  check(/面试官/.test($('recLabel').textContent), `标签提示是谁在说话，实际「${$('recLabel').textContent}」`);
  await pend;
  // 会打断的人设：卡太久面试官自己接话，面板闪一下红
  win.eval("S.mode='interview'; S.speaking=true; S.paused=false; S.probing=false;"
         + "S._intvEval=false; intvEnding=false; S.rounds=[]; S._probed=false;"
         + "S.stuckOpen=true; S.stuckFrom=Date.now()-20000;"
         + "S.persona=Object.assign({}, S.persona, {interrupt:true});");
  win.eval('intvTick()');
  check(win.document.querySelector('.intv-panel').classList.contains('cut'),
        '被打断时面板描边闪一下');
  check(/打断了你/.test($('ipReact').textContent),
        `打断要在面板上写明，实际「${$('ipReact').textContent}」`);
  // 不打断的人设也要有反应：不插话，但会把话头接过去，而且必须看得见
  win.eval("S.mode='interview'; S.speaking=true; S.paused=false; S.probing=false;"
         + "S._intvEval=false; intvEnding=false; S.rounds=[]; S._probed=false; S._intvCut=false;"
         + "S.stuckOpen=true; S.stuckFrom=Date.now()-30000;"
         + "S.persona=Object.assign({}, S.persona, {interrupt:false});");
  win.eval('renderInterviewer(); intvTick()');
  check(!win.document.querySelector('.intv-panel').classList.contains('cut'),
        '不打断的人设不闪红');
  check(/接过了话头/.test($('ipReact').textContent),
        `不插话也要写明他在接话，实际「${$('ipReact').textContent}」`);

  // 8.9937) 答完一题后走的是 resumeSpeak 那条计时器；以前那条路上没挂 tickMode，
  // 于是从第一轮起 intvTick 再也不跑——沉默、接话、扣耐心全停摆。这里用真实计时器验一遍
  win.eval('clearInterval(S.speakTimer); S.speaking=false;');
  await new Promise(r => setTimeout(r, 1200));   // 等上一个 endRound 落定，别串到这条断言里
  win.eval("clearInterval(S.speakTimer); S.mode='interview';"
         + "S.speaking=true; S.paused=true; S.probing=false; S.readying=false;"
         + "S._intvEval=false; intvEnding=false; S.rounds=[]; S._probed=false; S._intvCut=false;"
         + "S.stuckOpen=true; S.stuckFrom=Date.now()-40000; S.lastTextAt=Date.now()-40000;"
         + "S.roundFrom=Date.now()-40000; S._roundBase=0; S.transcript='我讲了一段';"
         + "S._badStreak=0; S._intvClosing=false; S._intvClosed=false;"
         + "S.persona=Object.assign({}, S.persona, {interrupt:false, patience_on:true});");
  await win.eval('resumeSpeak()');
  await new Promise(r => setTimeout(r, 2500));
  check(win.eval('S.rounds.length') === 1,
        `恢复讲话后计时器仍在跑模式的实时反应，实际结算了 ${win.eval('S.rounds.length')} 轮`);
  check(win.eval('S.patience') < win.eval('S.initPatience'),
        `卡壳要真扣耐心，实际 ${win.eval('S.patience')}/${win.eval('S.initPatience')}`);
  win.eval('clearInterval(S.speakTimer); S.speaking=false; S.paused=true;');
  // 卡壳结算过一轮就算「答得不好」：连续累计后面试官要升级反应
  check(win.eval('S._badStreak') === 1,
        `答得不好要累计，实际 ${win.eval('S._badStreak')}`);

  // 8.9938) 收场：面试官本人开口说完，常常带一句「你有什么想了解的吗」
  let closeReq = null;
  {
    const old = win.fetch;
    win.fetch = (u, o) => {
      if (String(u).includes('/api/interview/close')) {
        closeReq = JSON.parse(o.body);
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK',
          json: async () => ({ closing: '今天就到这里吧，你这边还有什么想了解的吗？', ask_back: true }) });
      }
      return old(u, o);
    };
    win.eval("S.speaking=true; S.paused=true; S._intvClosing=false; S._intvClosed=false;"
           + "S.rounds=[{q:'上一问', text:'上一答'}]; S.patience=0; S.initPatience=100;");
    await win.eval("(async()=>{ await closeInterview('耐心耗尽'); })()");
    win.fetch = old;
  }
  check(closeReq && closeReq.reason === '耐心耗尽' && closeReq.rounds.length === 1,
        '收场请求带上原因和已经问过的轮次');
  check(win.eval('S._intvClosed') === true, '收场后进入收尾态');
  check(/想了解|今天就到/.test(win.eval('intvQ')),
        `收尾话由面试官说出口，实际「${win.eval('intvQ')}」`);
  check(/结束这场面试/.test($('readSource').textContent),
        '收尾后按钮换成「结束这场面试」');
  check(win.eval('S.paused') === false, '收尾话之后还留一段开麦时间让人回一句');
  win.eval('clearTimeout(intvCloseTimer); S.speaking=false; S._intvClosed=false;');

  // 8.9939) 思考等待必须写明在等什么
  win.eval("S.mode='interview'; S.probing=false; intvThinkLeft=12;"
         + "intvThinkTimer=setInterval(()=>{},1000); renderInterviewer();");
  check(/还剩|到点自动开麦/.test($('readSource').textContent),
        `思考等待要说清到点自动开麦，实际「${$('readSource').textContent.match(/面试官在等你想[^<]*/)}」`);
  win.eval('clearInterval(intvThinkTimer); intvThinkTimer=null;');

  // 8.994) 设置面板：「训练」分类里按模式切换，不再单独设一个「模式」标签
  check(![...win.document.querySelectorAll('#setTabs .set-tab')].some(t => t.dataset.cat === '模式'),
        '「模式」标签已并入训练分类');
  win.eval('fillSettings()');   // 打开设置才会渲染模式切换条
  check(win.document.querySelectorAll('#setModeSwitch .set-mode-btn').length === 4,
        '训练分类里有模式切换条');
  check([...win.document.querySelectorAll('#setModeSwitch .set-mode-btn')].some(b => b.classList.contains('on') && b.dataset.id === 'interview'),
        '切换条默认落在当前训练模式上');
  win.eval("S.mode='interview'; renderModeSettings();");
  const mrows = [...win.document.querySelectorAll('#modeSecRows .set-row')];
  check(mrows.length >= 11, `面试模式有专属设置，实际 ${mrows.length} 行`);
  check(!/轮数/.test($('modeSecRows').textContent) && /耐心/.test($('modeSecRows').textContent),
        '轮数没了，耐心扣减还在');
  check(!$('ms_rounds') && !!$('ms_p_stuck') && $('ms_p_stuck').value === '8', '耐心扣减项在');
  check(!$('modePickSec').querySelector('h3'), '模式切换条不再挂「针对哪个模式」标题');
  // 切换条切到朗读：专属设置换成朗读的计分参数
  win.eval("document.querySelector('#setModeSwitch .set-mode-btn[data-id=read]').onclick();");
  check(/漏读扣分/.test($('modeSecRows').textContent), '切换条能切到朗读的专属设置');
  // 命题演讲的「计分」「节奏」「题库」三块只在该模式下显示
  check($('tBase').closest('.set-sec').style.display === 'none', '朗读模式下收起命题演讲的计分块');
  check($('bankText').closest('.set-sec').style.display === 'none', '朗读模式下收起题库块');
  win.eval("document.querySelector('#setModeSwitch .set-mode-btn[data-id=extemp]').onclick();");
  check($('tBase').closest('.set-sec').style.display === '', '切回命题演讲计分块回来了');
  check($('bankText').closest('.set-sec').style.display === '', '切回命题演讲题库块回来了');
  check(!$('ms_rounds'), '设置里已无轮数输入框');
  await win.eval("switchMode('extemp')");

  // 9) 忘词已彻底移除
  check(!$('forgetBtn') && !$('tForget') && !$('statForget'), '忘词相关元素已移除');
  check(win.eval('typeof tapForget') === 'undefined', 'tapForget 已移除');

  // 10) 脚本级体检：classic script 里同名顶层声明会静默覆盖（不报错），必须杜绝
  {
    const seen = new Set(); const dup = new Set();
    for (const sc of win.document.querySelectorAll('script[src]')) {
      const src = sc.getAttribute('src');
      if (!src.startsWith('js/')) continue;
      const code = require('fs').readFileSync(src, 'utf8');
      for (const m of code.matchAll(/^(?:function|let|const)\s+([A-Za-z_$][\w$]*)/gm)) {
        if (seen.has(m[1])) dup.add(m[1]); else seen.add(m[1]);
      }
    }
    check(dup.size === 0, `顶层声明无重名（会静默覆盖），实际${dup.size ? '：' + [...dup].join('、') : '无'}`);
  }

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
})().catch(e => {
  console.error('冒烟测试异常:', e);
  // 页面里的脚本错误（window.onerror）要先于断言失败暴露出来，
  // 否则「S is not defined」这类启动期报错会把真正的原因盖住
  if (errors.length) console.error('页面脚本错误:\n' + errors.join('\n---\n'));
  process.exit(1);
});
