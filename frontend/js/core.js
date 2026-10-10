/* 核心层：全局工具、后端 API、应用状态、主题、阶段切换。最先加载，其余文件都依赖它 */
const $ = id => document.getElementById(id);
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmt = s => String(Math.floor(s/60)).padStart(2,'0') + ':' + String(Math.floor(s%60)).padStart(2,'0');
const api = {
  async req(method, url, body){
    const opt = {method, headers:{}};
    if(body !== undefined){ opt.headers['Content-Type']='application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(url, opt);
    if(!r.ok){
      let msg;
      try{
        const d = (await r.json()).detail;
        // FastAPI 422 的 detail 是数组（每个元素 {loc,msg,...}），对象也要展开，别让用户看到 [object Object]
        msg = typeof d === 'string' ? d
          : Array.isArray(d) ? d.map(x => `${(x.loc||[]).slice(1).join('.')}: ${x.msg}`).join('; ')
          : (d && typeof d === 'object') ? JSON.stringify(d) : '';
      }catch(e){ msg = r.statusText; }
      throw new Error(msg || ('请求失败 ' + r.status));
    }
    return r.json();
  },
  get: u => api.req('GET', u), put: (u,b) => api.req('PUT', u, b),
  post: (u,b) => api.req('POST', u, b), del: u => api.req('DELETE', u),
};

const S = {
  cfg: null, bank: {}, words: {},
  mode: 'extemp',          // 当前模式 id；切换模式时改写它
  articles: [],            // 朗读材料库（朗读模式用）
  article: null,           // 本场选中的那篇材料
  // 面试模式的资源与会话状态。一场面试 = 多轮问答，所以 rounds 是数组
  resumes: [], persona: null, resume: null, target: '',
  brief: '', suspects: [], asked: [], rounds: [],
  patience: 100, initPatience: 100,
  roundFrom: 0,            // 本轮回答在整场字稿里的起始偏移
  probing: false,          // 正在等 AI 生成下一问（此时不该再触发一次）
  // 模式自身的输入（命题演讲：分类 / 命题 / 备稿提纲）
  cat: '全部混合', topic: '', topicCat: '',
  prepTotal: 600, prepLeft: 600, prepTimer: null,
  outline: [], otTpl: 'three', warmed: false, loading: false,
  hint: 0, hintsGiven: [], hintTimer: null, _rate: [],
  peek: 0, speakStart: 0, speakTimer: null, speaking: false,
  stuck: 0, stuckMs: 0, stuckOpen: false, stuckFrom: 0, lastTextAt: 0,
  // 暂停/准备倒计时：speakElapsed 累计「已说话时长」，speakStart 为当前段的起点（暂停时置 null）
  speakElapsed: 0, paused: false, readying: false, readyTimer: null, _skipReady: null, _stream: null,
  autoTimer: null,
  recorder: null, audioURL: null, entryId: null, prevEntry: null,
  transcript: '', stats: null, analysis: null, report: null,
  _scanned: 0,
  peekTimer: null, ws: null, recog: null, editing: false,
};
const TRAIN = () => S.cfg.training;
/* 当前模式自己的配置段（config.modes.<mode>）：各模式的扣分规则不互相干扰 */
const MODECFG = () => ((S.cfg || {}).modes || {})[S.mode] || {};
/* AI 有没有配好。面试模式没有 AI 就没有面试官，进模式前要拿它挡一道 */
const aiReady = () => !!(S.cfg && S.cfg.ai && S.cfg.ai.base_url && S.cfg.ai.model);

/* ================= 模式 ================= */
/* 模式注册表。每个模式声明自己的阶段序列、开讲页差异与结算方式，
   框架只认这个接口，不认识任何具体模式。新增模式 = registerMode 一次 + 一个 js 文件。
   契约：
     phases      阶段 id 列表，对应 #stage-<id>；通用阶段是 speak / result
     speak       {peek:是否有看稿扣分, hint:是否有提示按钮, source:是否显示原文面板,
                  score:false 收起「当前分」, coach:false 关掉实时 AI 提示,
                  patience:显示耐心条, recLabel:录音中字样, endLabel:结束按钮文案}
     enter()     切进该模式时调用，负责渲染自己的首个阶段
     end(dur)    结算算分 → {score,rating,rule,cells,entry,topic,cat,compareHtml}
     tick()      开讲中每 500ms 调一次，模式自定义的实时刷新（可省）
     stuckSec()  多久没出字算卡壳（可省，默认取 training.stuck_sec）
     metricsOf(h) / curMetrics() / compareRows   对比上一场的取值与行定义
     reference() 给 AI 的参考原文（可省）
     requiresAI  没有 AI 就玩不了这个模式（可省） */
const MODES = {};
function registerMode(def){ MODES[def.id] = def; }
function curMode(){ return MODES[S.mode] || MODES.extemp; }
function phases(){ return (curMode() || {}).phases || ['draw','prep','speak','result']; }
function tickMode(){ const m = curMode(); if(m && m.tick) m.tick(); }
const LEGEND = [
  {cat:'filler', cls:'f', name:'填充词', colorVar:'--filler'},
  {cat:'hedging', cls:'h', name:'犹豫词', colorVar:'--hedging'},
  {cat:'vague',  cls:'v', name:'笼统词', colorVar:'--vague'},
];
let legendOn = {filler:true, hedging:true, vague:true};

function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(()=>t.classList.remove('show'), 2600);
}

/* ================= 主题 ================= */
async function applyTheme(){
  const t = await api.get('/api/theme/resolve');
  const root = document.documentElement.style;
  root.setProperty('--bg', t.bg); root.setProperty('--ink', t.ink);
  root.setProperty('--accent', t.accent); root.setProperty('--red', t.accent);
  root.setProperty('--amber', t.amber || '#D9A13B'); root.setProperty('--green', t.green || '#6FBF9A');
  root.setProperty('--surface', t.surface || t.bg);
  // 灰阶必须跟着主题走：此前漏了这两行，纸白/墨林主题一直套用碳黑的灰，浅色底下浅灰字几乎看不见
  root.setProperty('--muted', t.muted || '#A6ABB5');
  root.setProperty('--faint', t.faint || '#7A7F8A');
  if(t.dark === false){ root.setProperty('--line','rgba(35,36,31,.12)'); root.setProperty('--line-strong','rgba(35,36,31,.3)'); }
  else { root.setProperty('--line','rgba(237,237,239,.10)'); root.setProperty('--line-strong','rgba(237,237,239,.24)'); }
  // 原生控件（下拉展开的选项列表、数字输入的步进箭头）跟着主题走：
  // 不设这个，黑主题里点开 select 是一块刺眼的白，数字框的箭头也看不见
  document.documentElement.style.colorScheme = t.dark === false ? 'light' : 'dark';
}

/* ================= 阶段 ================= */
/* 阶段序列由当前模式决定：命题演讲 抽题→备稿→开讲→结算，朗读 选材料→开讲→结算 */
function renderPhaseDots(){
  const box = $('phaseDots');
  if(!box) return;
  const idx = phases().indexOf(activePhase);
  box.innerHTML = phases().map((_,i)=>`<i class="${i===idx?'on':(i<idx?'done':'')}"></i>`).join('');
}
let activePhase = 'draw';
function setPhase(p){
  const cur = document.querySelector('.stage.active');
  const next = $('stage-' + p);
  if(cur && cur !== next){ cur.classList.add('leaving'); cur.classList.remove('active'); setTimeout(()=>cur.classList.remove('leaving'),600); }
  next.classList.add('active');
  activePhase = p;
  document.body.classList.toggle('immersive', p === 'speak');
  renderPhaseDots();
}

/* ================= 折叠 ================= */
const bindFold = (f,h) => $(h).addEventListener('click', ()=>$(f).classList.toggle('open'));
bindFold('catFold','catFoldHead'); bindFold('customFold','customFoldHead'); bindFold('notesFold','notesFoldHead');
bindFold('artFold','artFoldHead');
bindFold('resumeFold','resumeFoldHead');
bindFold('personaFold','personaFoldHead');
