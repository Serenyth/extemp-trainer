/* 音频层：音效（Web Audio 现场合成，不依赖音频文件）+ 录音与转写引擎 */
let _sfxCtx = null;
function sfxCtx(){
  try{
    if(!_sfxCtx){
      const C = window.AudioContext || window.webkitAudioContext;
      if(!C) return null;
      _sfxCtx = new C();
    }
    if(_sfxCtx.state === 'suspended') _sfxCtx.resume();
    return _sfxCtx;
  }catch(e){ return null; }
}
const sfxOn = () => !S.cfg || !S.cfg.ui || S.cfg.ui.sfx !== false;
/* 滚动的「嗒」：一小段带通白噪声，50ms 衰减。机械感来自噪声而不是乐音，
   每次中心频率随机抖一点，避免连响时像电子音 */
function sfxTick(v){
  if(!sfxOn()) return;
  const c = sfxCtx(); if(!c) return;
  const len = 0.05, t = c.currentTime;
  const buf = c.createBuffer(1, Math.max(1, Math.ceil(c.sampleRate*len)), c.sampleRate);
  const d = buf.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i] = (Math.random()*2-1) * (1 - i/d.length);
  const src = c.createBufferSource(); src.buffer = buf;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.value = 1700 + Math.random()*600; bp.Q.value = 1.3;
  const g = c.createGain();
  // 0.2 是实测出来的：带通只留下窄带能量，画面-like 的 0.05 实际峰值只有 -32dBFS，喇叭上几乎听不见
  g.gain.setValueAtTime(0.2 * (v||1), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(bp); bp.connect(g); g.connect(c.destination);
  src.start(t); src.stop(t + len + 0.02);
}
/* 落定的「叮」：两个正弦叠五度，半秒衰减 */
function sfxLand(){
  if(!sfxOn()) return;
  const c = sfxCtx(); if(!c) return;
  const t = c.currentTime;
  [[1568, 0, 0.11, 0.6], [2349, 0.055, 0.055, 0.45]].forEach(([f, delay, peak, dur])=>{
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = c.createGain(); const s = t + delay;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(peak, s + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    o.connect(g); g.connect(c.destination);
    o.start(s); o.stop(s + dur + 0.05);
  });
}

/* ---------------- 录音与实时转写 ---------------- */
async function setupAudio(engine){
  if(!navigator.mediaDevices?.getUserMedia){
    $('micNote').classList.add('show'); return null;
  }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    // 回放录音
    S.recorder = new MediaRecorder(stream);
    const chunks = [];
    S.recorder.ondataavailable = e=>{ if(e.data.size) chunks.push(e.data); };
    S.recorder.onstop = ()=>{ if(chunks.length) S.audioURL = URL.createObjectURL(new Blob(chunks,{type:chunks[0].type||'audio/webm'})); stream.getTracks().forEach(t=>t.stop()); };
    S.recorder.start();
    S._stream = stream;          // 暂停/继续要复用这条麦克风流，否则消失后没法恢复识别
    if(engine === 'none') return null;
    return stream;
  }catch(e){
    $('micNote').classList.add('show');
    return null;
  }
}

function startEngine(stream, engine){
  if(engine === 'whisper' || engine === 'sherpa'){
    // AudioContext → PCM16 → WebSocket（whisper / sherpa 共用同一条流式管线）
    const ctx = new AudioContext({sampleRate: 16000});
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    let ws = null;
    try{
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws/speech`);
    }catch(e){ toast('WebSocket 连接失败'); return Promise.resolve(); }
    let settle = null, settled = false;
    const readyP = new Promise(r=>{ settle = r; });
    const done = ()=>{ if(settled) return; settled = true; settle(); };
    ws.onopen = ()=> ws.send(JSON.stringify({type:'start', engine: engine, model: S.cfg.speech.model}));
    ws.onmessage = ev=>{
      try{
        const m = JSON.parse(ev.data);
        // final=已说完的一句（入库）；partial=正在说的预览（只显示，会被 final 覆盖）
        if(m.type==='final' && m.text){ S._finalVer = m.v || 0; pushFinal(m.text); }
        else if(m.type==='partial' && m.text){ pushPartial(m.text, m.v); }
        if(m.type==='error'){ toast('转写：'+m.message); }
        if(m.type==='ready' || m.type==='error') done();   // 模型就绪（或加载失败）才放行倒计时
      }catch(e){}
    };
    ws.onerror = done; ws.onclose = done;
    setTimeout(done, 30000);          // 兜底：加载卡住也别把开讲流程锁死
    proc.onaudioprocess = e=>{
      if(!ws || ws.readyState !== 1) return;
      if(S.readying || S.loading) return;  // 准备倒计时 / 模型加载期间不送：反正后端还没准备好
      const f = e.inputBuffer.getChannelData(0);
      const buf = new Int16Array(f.length);
      for(let i=0;i<f.length;i++){ const s = Math.max(-1, Math.min(1, f[i])); buf[i] = s<0 ? s*0x8000 : s*0x7FFF; }
      ws.send(buf.buffer);
    };
    src.connect(proc); proc.connect(ctx.destination);
    S.ws = ws; S._audioCtx = ctx; S._proc = proc;
    return readyP;
  }
  else if(engine === 'web-speech'){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){ toast('此浏览器不支持 Web Speech，请用 Chrome 或改用 Whisper'); return; }
    const r = new SR();
    r.lang = 'zh-CN'; r.continuous = true; r.interimResults = true;
    r.onresult = ev=>{
      let interim = '';
      for(let i = ev.resultIndex; i < ev.results.length; i++){
        const res = ev.results[i];
        if(res.isFinal) pushFinal(res[0].transcript);
        else interim += res[0].transcript;
      }
      if(interim) pushPartial(interim);      // 未定稿部分当预览显示
      else { S.partial=''; S._lastPartial=''; renderSubtitle(); }
    };
    r.onerror = ev=>{ if(ev.error!=='no-speech') toast('语音识别：'+ev.error); };
    r.onend = ()=>{ if(document.body.classList.contains('immersive')){ try{ r.start(); }catch(e){} } };
    try{ r.start(); }catch(e){}
    S.recog = r;
  }
}

async function stopEngines(flush){
  try{ if(S.recog){ S.recog.onend = null; S.recog.stop(); } S.recog = null; }catch(e){}
  try{ if(S._proc){ S._proc.disconnect(); S._audioCtx.close(); } S._proc=null; S._audioCtx=null; }catch(e){}
  try{
    if(S.ws){
      const w = S.ws; S.ws = null;
      // flush=true：先让后端把"最后半句"转完再断开，否则收尾那句会丢
      if(flush){
        try{ w.send(JSON.stringify({type:'flush'})); }catch(e){}
        await new Promise(r=>setTimeout(r, 900));
      }
      try{ w.send(JSON.stringify({type:'stop'})); w.close(); }catch(e){}
    }
  }catch(e){}
}
