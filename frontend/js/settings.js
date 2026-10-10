/* 设置面板与两个抽屉的开关。只负责读写配置，不参与训练流程 */
function openDrawer(id){ $(id).classList.add('show'); $('scrim').classList.add('show'); }
function closeDrawer(id){ $(id).classList.remove('show'); $('scrim').classList.remove('show'); }
document.querySelectorAll('.drawer-close').forEach(b=>b.onclick = ()=>closeDrawer(b.dataset.close));
$('settingsBtn').onclick = ()=>{ fillSettings(); openDrawer('settingsDrawer'); };
/* 设置分类：点标签只显示该类的设置块，「全部」则都显示 */
function filterSetSec(cat){
  document.querySelectorAll('#settingsDrawer .set-sec').forEach(sec=>{
    const hit = (cat === '全部') || sec.dataset.cat === cat;
    sec.style.display = hit ? '' : 'none';
  });
  applyModeFilter();
  document.querySelectorAll('#setTabs .set-tab').forEach(t=>{
    t.classList.toggle('on', t.dataset.cat === cat);
  });
  $('settingsBody').scrollTop = 0;
}
/* ================= 训练分类里按模式切换 =================
   「训练」下的设置块不是对所有模式都有意义（备稿时长只有命题演讲用）。
   标了 data-mode 的块只在选中对应模式时显示；没标的任何模式都显示。
   切换条默认跟着当前训练模式走，也可以手动指到别的模式改它的参数 */
let _setMode = null;            // null = 跟随当前训练模式
function effModeId(){ return _setMode || curMode().id; }
function renderSetModeSwitch(){
  const box = $('setModeSwitch');
  if(!box) return;
  box.innerHTML = Object.values(MODES).map(m=>
    `<button class="set-mode-btn${m.id === effModeId() ? ' on' : ''}" data-id="${m.id}">${esc(m.name || m.id)}</button>`
  ).join('');
  box.querySelectorAll('.set-mode-btn').forEach(b=>{
    b.onclick = ()=>{ _setMode = b.dataset.id; renderSetModeSwitch(); applyModeFilter(); renderModeSettings(); };
  });
}
function applyModeFilter(){
  const mid = effModeId();
  document.querySelectorAll('#settingsDrawer .set-sec[data-mode]').forEach(sec=>{
    const modes = (sec.dataset.mode || '').split(',');
    if(!sec.dataset.cat || sec.dataset.cat === '训练')
      sec.style.display = modes.includes(mid) ? '' : 'none';
  });
}
document.querySelectorAll('#setTabs .set-tab').forEach(t=>{
  t.onclick = ()=> filterSetSec(t.dataset.cat);
});
// 「全部」视图下给每个小标题挂上所属类目，方便知道该项在哪个标签里
document.querySelectorAll('#settingsDrawer .set-sec').forEach(sec=>{
  const h = sec.querySelector('h3');
  if(h && sec.dataset.cat && !h.querySelector('.set-cat-tag')){
    const tag = document.createElement('span');
    tag.className = 'set-cat-tag';
    tag.textContent = '# ' + sec.dataset.cat;
    h.appendChild(tag);
  }
});
$('drawerBtn').onclick = ()=>{ renderDrawer(); openDrawer('drawer'); };
$('scrim').onclick = ()=>{ closeDrawer('settingsDrawer'); closeDrawer('drawer'); };

function fillSettings(){
  const c = S.cfg;
  $('themePreset').value = c.theme.preset;
  $('customColors').style.display = c.theme.preset==='custom'?'flex':'none';
  $('cBg').value = c.theme.custom.bg; $('cInk').value = c.theme.custom.ink; $('cAccent').value = c.theme.custom.accent;
  $('aiUrl').value = c.ai.base_url; $('aiKey').value = c.ai.api_key;
  $('aiModel').value = c.ai.model; $('aiTimeout').value = c.ai.timeout;
  $('aiAuto').value = String(c.ai?.auto_analyze === true);
  $('cOn').value = String(c.coach?.enabled !== false);
  $('cEvery').value = String(c.coach?.every ?? 3);
  $('cMin').value = c.coach?.min_chars ?? 8;
  $('cMax').value = c.coach?.max_chars ?? 40;
  $('cHold').value = c.coach?.hint_sec ?? 24;
  $('cPrompt').value = c.coach?.prompt ?? '';
  $('speechEngine').value = c.speech.engine;
  $('whisperModels').style.display = (c.speech.engine==='whisper'||c.speech.engine==='sherpa')?'':'none';
  // 断句等待 / 最长分句 / 边说边出字 三个选项已移除，后端用固定值
  loadModelList(); loadPunct();
  $('tBase').value = c.training.base_score;
  $('tPeek').value = c.training.peek_penalty;
  $('tHint').value = c.training.hint_penalty ?? 5; $('tDurs').value = (c.training.prep_durations||[]).join(',');
  $('tStuckPenOn').value = String(c.training.stuck_penalty_on !== false);
  $('tStuckPen').value = c.training.stuck_penalty ?? 3;
  $('tStuckPenSec').value = c.training.stuck_penalty_sec ?? 0;
  $('tFillerOn').value = String(c.training.filler_scoring); $('tFillerTh').value = c.training.filler_threshold;
  $('tReady').value = c.training.ready_countdown ?? 3;
  $('tAutoStart').value = c.training.auto_start_sec ?? 5;
  $('tPeekDur').value = c.training.peek_duration ?? 3;
  $('tAutoPause').value = String(c.training.auto_pause !== false);
  $('tStuckSec').value = c.training.stuck_sec ?? 3;
  $('tWpmFast').value = c.training.wpm_fast ?? 330;
  $('tWpmSlow').value = c.training.wpm_slow ?? 0;
  $('tBurst').value = c.training.filler_burst ?? 3;
  $('dSubtitle').value = c.display?.subtitle_size ?? 30;
  $('dCoach').value = c.display?.coach_size ?? 13.5;
  $('dNewline').value = String(c.display?.sentence_newline !== false);
  $('dPunct').value = String(c.display?.show_punct !== false);
  $('dSfx').value = String(c.ui?.sfx !== false);
  $('dKeep').value = c.ui?.history_keep ?? 200;
  $('spSilence').value = ((c.speech.silence_ms ?? 1200)/1000).toFixed(1);
  $('spMax').value = c.speech.max_utter_sec ?? 20;
  $('wFiller').value = (S.words.filler||[]).join('，');
  $('wHedging').value = (S.words.hedging||[]).join('，');
  $('wVague').value = (S.words.vague||[]).join('，');
  $('bankText').value = yamlBankString();
  _setMode = null;              // 打开设置面板时回到「跟随当前模式」
  renderSetModeSwitch();
  applyModeFilter();
  renderModeSettings();
}

/* ================= 模式专属设置 =================
   「训练」那一栏是命题演讲那套（看稿、备稿、填充词计分），套不到别的模式上。
   所以另开一栏，内容跟着当前模式换：模式自己声明要改哪些参数。 */
function modeSetRows(){
  const id = effModeId();
  const mc = ((S.cfg || {}).modes || {})[id] || {};
  if(id === 'interview'){
    const p = mc.patience || {};
    return [
      {k:'think_enabled', label:'给思考时间',       v:mc.think_enabled, bool:true},
      {k:'think_sec',   label:'思考秒数（0=跟人设）', v:mc.think_sec,   min:0, max:120},
      {k:'extend_sec',  label:'主动加时/次（秒）',   v:mc.extend_sec,   min:0, max:60},
      {k:'suggest_sec', label:'单轮建议时长（秒）',  v:mc.suggest_sec,  min:20, max:600},
      {k:'stuck_sec',   label:'卡壳判定（秒）',      v:mc.stuck_sec,    min:1, max:30},
      {k:'auto_probe',  label:'卡住时面试官接话',    v:mc.auto_probe,   bool:true},
      {k:'p.stuck',         label:'耐心 − 卡壳/次',    v:p.stuck,         min:0, max:100},
      {k:'p.extend',        label:'耐心 − 加时/秒',    v:p.extend,        min:0, max:20},
      {k:'p.overtime',      label:'耐心 − 超时/10秒',  v:p.overtime,      min:0, max:50},
      {k:'p.low_relevance', label:'耐心 − 答非所问',   v:p.low_relevance, min:0, max:100},
      {k:'p.hint',          label:'耐心 − 提示/次',    v:p.hint,          min:0, max:100},
    ];
  }
  if(id === 'read'){
    return [
      {k:'leak_penalty',   label:'漏读扣分/字',   v:mc.leak_penalty,   step:0.5},
      {k:'err_penalty',    label:'错读扣分/处',   v:mc.err_penalty,    step:0.5},
      {k:'repeat_penalty', label:'重复扣分/次',   v:mc.repeat_penalty, step:0.5},
      {k:'leak_cap',       label:'漏读扣分上限',  v:mc.leak_cap,       min:0, max:100},
      {k:'err_cap',        label:'错读扣分上限',  v:mc.err_cap,        min:0, max:100},
      {k:'repeat_cap',     label:'重复扣分上限',  v:mc.repeat_cap,     min:0, max:100},
    ];
  }
  return [];
}
function renderModeSettings(){
  const box = $('modeSecRows');
  if(!box) return;
  const m = MODES[effModeId()] || curMode();
  $('modeSecTitle').textContent = (m.name || m.id) + ' · 专属';
  const rows = modeSetRows();
  if(!rows.length){
    box.innerHTML = '<div class="set-empty">这个模式没有额外参数，用上面的通用项就行。</div>';
    $('modeSecActs').style.display = 'none';
    return;
  }
  $('modeSecActs').style.display = '';
  box.innerHTML = rows.map(r=>{
    const id = 'ms_' + r.k.replace('.', '_');
    const ctl = r.bool
      ? `<select id="${id}"><option value="true">开</option><option value="false">关</option></select>`
      : `<input type="number" id="${id}" value="${r.v ?? 0}"${r.min != null ? ` min="${r.min}"` : ''}${r.max != null ? ` max="${r.max}"` : ''}${r.step ? ` step="${r.step}"` : ''}>`;
    return `<div class="set-row"><label>${r.label}</label>${ctl}</div>`;
  }).join('');
  rows.forEach(r=>{
    const el = $('ms_' + r.k.replace('.', '_'));
    if(el) el.value = r.bool ? String(r.v !== false) : String(r.v ?? 0);
  });
}
$('modeSaveBtn').onclick = async ()=>{
  const id = effModeId();
  const rows = modeSetRows();
  if(!rows.length) return;
  const mc = ((S.cfg || {}).modes || {})[id] || {};
  mc.patience = mc.patience || {};
  rows.forEach(r=>{
    const el = $('ms_' + r.k.replace('.', '_'));
    if(!el) return;
    const val = r.bool ? (el.value === 'true') : (+el.value || 0);
    if(r.k.startsWith('p.')) mc.patience[r.k.slice(2)] = val;
    else mc[r.k] = val;
  });
  const cfg = Object.assign({}, S.cfg);
  cfg.modes = Object.assign({}, cfg.modes || {});
  cfg.modes[id] = mc;
  try{
    S.cfg = await api.put('/api/config', cfg);
    toast('已保存');
    renderModeSettings();
  }catch(e){ toast('保存失败：' + e.message); }
};
/* 生成格式必须能被下面的 parseBankYaml 原样读回——此前生成的是
   「分类:」包一层、真实分类缩进两格，而解析器要求分类顶格，
   结果是不管用户改没改，点保存就报「无法解析：观点思辨:」 */
function yamlBankString(){
  const lines = [];
  Object.entries(S.bank).forEach(([c,arr])=>{
    lines.push(`${c}:`);
    arr.forEach(t=>lines.push(`  - "${t.replace(/"/g,'\\"')}"`));
  });
  return lines.join('\n');
}

async function loadModelList(){
  const data = await api.get('/api/speech/models');
  const engine = $('speechEngine').value;
  const pool = engine === 'sherpa' ? (data.sherpa||[]) : data.whisper;
  const sel = $('whisperModelSel');
  sel.innerHTML = '';
  // 按类型分组：流式（边说边出字）/ 离线（整段转写）
  // groups 给下方"下载列表"用，包含没下载的模型（那里要点下载）
  const groups = [];
  pool.forEach(m=>{
    const g = m.group || (engine === 'sherpa' ? '离线' : 'Whisper');
    let og = groups.find(x=>x.name===g);
    if(!og){ og = {name:g, items:[]}; groups.push(og); }
    og.items.push(m);
  });

  // 选择框只列「已下载」的：没下载的模型选了也用不了（后端会报 模型未下载）
  const ready = pool.filter(m=>m.downloaded);
  const readyGroups = [];
  ready.forEach(m=>{
    const g = m.group || (engine === 'sherpa' ? '离线' : 'Whisper');
    let og = readyGroups.find(x=>x.name===g);
    if(!og){ og = {name:g, items:[]}; readyGroups.push(og); }
    og.items.push(m);
  });
  if(!ready.length){
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '（还没有已下载的模型，先在下方下载一个）';
    sel.appendChild(o);
  } else {
    readyGroups.forEach(g=>{
      const og = document.createElement('optgroup');
      og.label = g.name;
      g.items.forEach(m=>{
        const o = document.createElement('option');
        o.value = m.id;
        o.textContent = `${m.id} · ${m.desc}`;   // 只留短备注，详细说明走 title
        o.title = m.tip || '';
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
  }
  sel.value = (ready.some(m=>m.id===S.cfg.speech.model) && S.cfg.speech.model)
    ? S.cfg.speech.model : (ready[0]?.id || '');

  const list = $('modelDownloadList'); list.innerHTML = '';
  groups.forEach(g=>{
    const h = document.createElement('div');
    h.className = 'mi-group'; h.textContent = g.name;
    list.appendChild(h);
    g.items.forEach(m=>{
      const div = document.createElement('div');
      div.className = 'model-item';
      div.title = m.tip || '';
      div.innerHTML = `<div><span class="mi-name">${m.id}</span> `
        + `<span class="mi-desc">${m.desc} · ${m.size_mb}MB</span></div>`;
      if(!m.downloaded && m.size_mb){
        const warn = document.createElement('span');
        warn.className = 'mi-desc'; warn.style.color = 'var(--amber)';
        warn.textContent = `不完整（缺 ${m.missing.join('/')}）`;
        div.appendChild(warn);
      }
      const btn = document.createElement('button');
      if(m.downloaded){
        btn.className = 'mi-btn done';
        btn.textContent = m.size_mb ? `已下载 ${m.size_mb}MB` : '已下载';
        div.appendChild(btn);
        // 已下载的模型也能删：两步确认，避免误删后要重新下载几百 MB
        const del = document.createElement('button');
        del.className = 'mi-btn del'; del.style.marginLeft = '6px';
        del.textContent = '删除';
        del.onclick = async ()=>{
          if(del.dataset.armed !== '1'){
            del.dataset.armed = '1'; del.textContent = '确认删除？';
            setTimeout(()=>{ del.dataset.armed=''; del.textContent='删除'; }, 3000);
            return;
          }
          del.textContent = '删除中…';
          try{
            const r = await api.del('/api/speech/model?model_id='+m.id);
            if(r && r.ok === false){
              toast(r.error || '删除失败');
              del.textContent = '删除'; del.dataset.armed = '';
              return;
            }
            toast(`已删除 ${m.id}，需要时可重新下载`);
          }catch(e){
            toast('删除失败：'+e.message);
            del.textContent = '删除'; del.dataset.armed = '';
            return;
          }
          loadModelList();
        };
        div.appendChild(del);
      } else {
        btn.className = 'mi-btn';
        btn.textContent = m.size_mb ? '继续下载' : '下载';
        btn.onclick = async ()=>{
          btn.classList.add('busy'); btn.textContent='下载中…';
          try{
            await api.post('/api/speech/download?model_id='+m.id);
            toast(`模型 ${m.id} 下载完成`);
            loadModelList();
          }catch(e){
            btn.classList.remove('busy'); btn.textContent='重试';
            toast('下载失败：'+e.message);
          }
        };
        div.appendChild(btn);
        if(m.size_mb){
          const clr = document.createElement('button');
          clr.className = 'mi-btn'; clr.style.marginLeft = '6px';
          clr.textContent = '清空重来';
          clr.onclick = async ()=>{
            try{
              const r = await api.del('/api/speech/model?model_id='+m.id);
              if(r && r.ok === false){ toast(r.error || '清空失败'); return; }
              loadModelList(); toast(`已清空 ${m.id}，可重新下载`);
            }catch(e){ toast('清空失败：'+e.message); }
          };
          div.appendChild(clr);
        }
      }
      list.appendChild(div);
    });
  });
}

/* 标点恢复模型：独立下载，没下载时开关没意义，所以状态里直接说明 */
async function loadPunct(){
  try{
    const st = await api.get('/api/speech/punct');
    $('punctOn').value = String(!!st.enabled);
    $('punctState').textContent = st.downloaded
      ? `已下载 · ${st.size_mb}MB` : `未下载 · 约 ${st.expected_mb}MB`;
    const btn = $('punctDlBtn');
    btn.style.display = st.downloaded ? 'none' : '';
    btn.disabled = false; btn.textContent = '下载';
  }catch(e){
    $('punctState').textContent = '状态读取失败：' + e.message;
  }
}
$('punctDlBtn').onclick = async ()=>{
  const btn = $('punctDlBtn');
  btn.disabled = true; btn.textContent = '下载中…';
  $('punctState').textContent = '下载中…（约 281MB，别关页面）';
  try{
    await api.post('/api/speech/punct/download');
    toast('标点模型已下载，把开关打开即可生效');
    await loadPunct();
  }catch(e){
    toast('下载失败：' + e.message);
    btn.disabled = false; btn.textContent = '重试';
  }
};

/* 主题 */
$('themePreset').onchange = async e=>{
  S.cfg.theme.preset = e.target.value;
  $('customColors').style.display = e.target.value==='custom'?'flex':'none';
  S.cfg = await api.put('/api/config', S.cfg);
  applyTheme();
};
$('applyCustomBtn').onclick = async ()=>{
  S.cfg.theme.custom = {bg:$('cBg').value, ink:$('cInk').value, accent:$('cAccent').value};
  S.cfg = await api.put('/api/config', S.cfg);
  applyTheme(); toast('自定义配色已应用');
};
/* AI */
$('fetchModelsBtn').onclick = async ()=>{
  const url = $('aiUrl').value.trim(), key = $('aiKey').value.trim();
  if(!url){ toast('先填写 API 地址'); return; }
  const btn = $('fetchModelsBtn');
  btn.disabled = true; btn.textContent = '获取中…';
  try{
    const r = await api.post('/api/ai/models', {base_url:url, api_key:key});
    const dl = $('modelList'); dl.innerHTML = '';
    (r.models||[]).forEach(id=>{
      const o = document.createElement('option');
      o.value = id; dl.appendChild(o);
    });
    toast(`获取到 ${r.models.length} 个模型，点击输入框可选择`);
  }catch(e){
    toast('获取失败：' + e.message);
  }
  btn.disabled = false; btn.textContent = '获取';
};
$('aiSaveBtn').onclick = async ()=>{
  S.cfg.ai = {base_url:$('aiUrl').value.trim(), api_key:$('aiKey').value.trim(),
              model:$('aiModel').value.trim(), timeout:+$('aiTimeout').value||60,
              auto_analyze:$('aiAuto').value==='true'};
  S.cfg = await api.put('/api/config', S.cfg);
  toast('AI 配置已保存');
};
/* 语音 */
$('speechEngine').onchange = e=>{
  const eng = e.target.value;
  $('whisperModels').style.display = (eng==='whisper'||eng==='sherpa')?'':'none';
  if(eng==='whisper'||eng==='sherpa') loadModelList();
};
$('speechSaveBtn').onclick = async ()=>{
  const eng = $('speechEngine').value;
  const needModel = (eng==='whisper'||eng==='sherpa');
  const mid = needModel ? $('whisperModelSel').value : '';
  // 一个模型都没下载时，选择框是空占位，别把空模型存进去
  if(needModel && !mid){ toast('先在下方下载一个模型，再回来选择并保存'); return; }
  // 引擎/模型 + 断句等待；min_speech_ms 等其余仍是后端固定值
  S.cfg.speech = {engine:eng, model: mid, min_speech_ms:300,
    silence_ms: Math.round(Math.min(3, Math.max(0.6, +$('spSilence').value||1.2))*1000),
    max_utter_sec: Math.min(120, Math.max(5, +$('spMax').value||20)),
    punct_enabled: $('punctOn').value === 'true',
  };
  S.cfg = await api.put('/api/config', S.cfg);
  toast('语音配置已保存');
};
/* 训练参数：分成「计分 / 节奏 / 实时信号」三块，任一处的保存都是整组一起提交 */
async function saveTraining(){
  const durs = $('tDurs').value.split(/[,，\s]+/).map(Number).filter(n=>n>0);
  if(!durs.length){ toast('备稿时长格式错误'); return; }
  S.cfg.training = {
    base_score:+$('tBase').value||100,
    peek_penalty:+$('tPeek').value||10, prep_durations:durs,
    filler_scoring:$('tFillerOn').value==='true', filler_threshold:+$('tFillerTh').value||8,
    hint_penalty:Math.max(0, Math.min(50, +$('tHint').value||0)),
    stuck_penalty_on:$('tStuckPenOn').value==='true',
    stuck_penalty:Math.max(0, Math.min(50, +$('tStuckPen').value||0)),
    stuck_penalty_sec:Math.max(0, Math.min(60, +$('tStuckPenSec').value||0)),
    ready_countdown:Math.max(0, Math.min(30, +$('tReady').value||0)),
    auto_start_sec:Math.max(0, Math.min(60, +$('tAutoStart').value||0)),
    peek_duration:Math.max(1, Math.min(30, +$('tPeekDur').value||3)),
    auto_pause:$('tAutoPause').value==='true',
    stuck_sec:Math.max(1, Math.min(30, +$('tStuckSec').value||3)),
    wpm_fast:Math.max(120, Math.min(600, +$('tWpmFast').value||330)),
    wpm_slow:Math.max(0, Math.min(400, +$('tWpmSlow').value||0)),
    filler_burst:Math.max(2, Math.min(10, +$('tBurst').value||3)),
  };
  S.cfg = await api.put('/api/config', S.cfg);
  S.prepTotal = durs[0]*60; S.prepLeft = S.prepTotal;
  buildDurRow(); renderPrep();
  $('peekRule').textContent = `− ${S.cfg.training.peek_penalty} / 次`;
  $('hintRule').textContent = `− ${S.cfg.training.hint_penalty} / 次`;
  toast('训练参数已保存');
}
document.querySelectorAll('.train-save').forEach(b=> b.onclick = saveTraining);
/* 显示：开讲页文字大小（写成 CSS 变量，改完立即生效） */
function applyDisplay(){
  const d = S.cfg.display || {};
  const root = document.documentElement.style;
  root.setProperty('--subtitle-size', (d.subtitle_size || 30) + 'px');
  root.setProperty('--hint-size', (d.coach_size || 15) + 'px');   // 开讲提示条的字号
}
$('displaySaveBtn').onclick = async ()=>{
  S.cfg.display = {
    subtitle_size: Math.max(16, Math.min(64, +$('dSubtitle').value || 30)),
    coach_size: Math.max(10, Math.min(28, +$('dCoach').value || 13.5)),
    sentence_newline: $('dNewline').value === 'true',
    show_punct: $('dPunct').value === 'true',
  };
  S.cfg.ui = {...(S.cfg.ui||{}), sfx: $('dSfx').value === 'true',
    history_keep: Math.max(20, Math.min(2000, +$('dKeep').value||200))};
  S.cfg = await api.put('/api/config', S.cfg);
  applyDisplay();
  if(S.transcript || S.partial) renderSubtitle();   // 换行/标点选项立即作用于当前字稿
  if(S.stats) renderTranscript();                   // 结算页同理
  toast('显示设置已保存');
  if(S.cfg.ui.sfx){ sfxTick(0.8); setTimeout(sfxLand, 240); }   // 打开时试听一遍
};
/* 表达提示：提示词 + 触发频率 */
$('coachSaveBtn').onclick = async ()=>{
  S.cfg.coach = {...(S.cfg.coach||{}),
    enabled: $('cOn').value === 'true',
    prompt: $('cPrompt').value.trim(),
    every: Math.min(20, Math.max(1, +$('cEvery').value||3)),
    min_chars: Math.min(50, Math.max(2, +$('cMin').value||8)),
    max_chars: Math.min(120, Math.max(12, +$('cMax').value||40)),
    hint_sec: Math.min(120, Math.max(0, +$('cHold').value||0)),
  };
  S.cfg = await api.put('/api/config', S.cfg);
  toast('表达提示已保存');
};
$('coachResetBtn').onclick = async ()=>{
  $('cPrompt').value = '';
  S.cfg.coach = {...(S.cfg.coach||{}), prompt: ''};
  S.cfg = await api.put('/api/config', S.cfg);
  toast('已恢复内置提示词');
};
/* 词表 */
$('wordsSaveBtn').onclick = async ()=>{
  const split = v => v.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  S.words = await api.put('/api/words', {
    filler:split($('wFiller').value), hedging:split($('wHedging').value), vague:split($('wVague').value)});
  toast('词表已保存');
};
/* 题库 */
$('bankSaveBtn').onclick = async ()=>{
  try{
    const yamlText = $('bankText').value;
    // 复用后端校验：先导入到临时？直接 PUT JSON 更安全 —— 前端解析简单 YAML
    const bank = parseBankYaml(yamlText);
    S.bank = await api.put('/api/bank', bank);
    renderCustom(); buildCatChips();
    toast('题库已保存');
  }catch(e){ toast('保存失败：'+e.message); }
};
/* 容错解析。要能吃下三种来源：自己生成的、用户手写的、以及从「导出」拿回来的文件
   （后者带 version 行和 categories 包装层，分类还整体缩进一层） */
function parseBankYaml(text){
  const bank = {};
  let curCat = null;
  for(const raw of text.split('\n')){
    const line = raw.replace(/\r+$/, '');            // Windows 换行
    if(/^\s*#/.test(line) || !line.trim()) continue;
    if(/^\s*version\s*:/i.test(line)) continue;      // 导出文件的版本号，不是分类
    // 列表项先判：否则以半角冒号结尾的题目会被误认成分类
    if(/^\s*-\s+/.test(line)){
      if(!curCat) throw new Error('题目没有所属分类：' + line.trim());
      const v = line.replace(/^\s*-\s+/, '')
                    .replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim();
      if(v) bank[curCat].push(v);
      continue;
    }
    const m = line.match(/^\s*(.+?):\s*$/);
    if(m){
      if(m[1] === 'categories'){ curCat = null; continue; }   // 导出文件的包装层
      curCat = m[1];
      bank[curCat] = bank[curCat] || [];             // 同名分类合并，别把先出现的清掉
      continue;
    }
    throw new Error('无法解析：' + line.trim());
  }
  if(!Object.keys(bank).length) throw new Error('题库为空');
  return bank;
}
$('importBankBtn').onclick = ()=>$('importFile').click();
$('importFile').onchange = async e=>{
  const file = e.target.files[0];
  if(!file) return;
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/bank/import?mode='+$('importMode').value, {method:'POST', body:fd});
  if(!r.ok){ const j = await r.json().catch(()=>({detail:'导入失败'})); toast(j.detail); return; }
  S.bank = await r.json();
  $('bankText').value = yamlBankString();
  renderCustom(); buildCatChips();
  toast('题库已导入');
  e.target.value = '';
};
