/* 原文与朗读转写的比对：字符级 LCS，输出漏读 / 错读 / 多读 / 重复
   转写是语音识别结果，标点几乎必然缺失、同音字必然存在，
   所以比对前两边都先去掉空白与标点，只比实质字符 */
const ALIGN_STRIP = /[\s，。！？；：、,.!?;:"“”‘’（）()《》〈〉【】…—\-～~]/g;
// 单字符判断不能用带 g 标志的正则：test() 会推进 lastIndex，隔一次就漏判。
// 所以单字判断走字符集，整体替换才用上面的正则
const ALIGN_SKIP = ' \t\r\n，。！？；：、,.!?;:"“”‘’（）()《》〈〉【】…—-～~';
const isSkipChar = ch => ALIGN_SKIP.includes(ch);
function normForAlign(s){ return String(s ?? '').replace(ALIGN_STRIP, ''); }

/* 字符级最长公共子序列 → 操作序列 [{t:'ok'|'miss'|'add', c}] */
function alignOps(ref, got){
  const a = normForAlign(ref), b = normForAlign(got);
  const n = a.length, m = b.length;
  // 文章几百字、转写几百字，n*m 在十万级，Int32Array 足够且够快
  const W = m + 1;
  const dp = new Int32Array((n + 1) * W);
  for(let i = n - 1; i >= 0; i--){
    for(let j = m - 1; j >= 0; j--){
      dp[i * W + j] = a[i] === b[j]
        ? dp[(i + 1) * W + j + 1] + 1
        : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while(i < n && j < m){
    if(a[i] === b[j]){ ops.push({t:'ok', c:a[i]}); i++; j++; }
    else if(dp[(i + 1) * W + j] >= dp[i * W + j + 1]){ ops.push({t:'miss', c:a[i]}); i++; }
    else { ops.push({t:'add', c:b[j]}); j++; }
  }
  while(i < n){ ops.push({t:'miss', c:a[i]}); i++; }
  while(j < m){ ops.push({t:'add', c:b[j]}); j++; }
  return ops;
}

/* 把连续的 miss + add 合并成「错读」：读错了字往往表现成"删一个、加一个"，
   分开统计会把一次错读算成两个错误 */
function alignStats(ref, got){
  const ops = alignOps(ref, got);
  const runs = [];
  ops.forEach(o=>{
    const last = runs[runs.length - 1];
    if(last && last.t === o.t) last.c += o.c;
    else runs.push({t:o.t, c:o.c});
  });
  let miss = 0, add = 0, err = 0;
  for(let k = 0; k < runs.length; k++){
    const r = runs[k];
    if(r.t !== 'miss') continue;
    const nxt = runs[k + 1];
    if(nxt && nxt.t === 'add'){
      const paired = Math.min(r.c.length, nxt.c.length);
      err += paired;
      miss += r.c.length - paired;
      nxt.c = nxt.c.slice(paired);      // 配对掉的部分不再算多读
      if(!nxt.c) runs[k + 1] = {t:'add', c:''};
    } else {
      miss += r.c.length;
    }
  }
  add = runs.filter(r=>r.t === 'add').reduce((s,r)=>s + r.c.length, 0);
  const refLen = normForAlign(ref).length;
  return {
    ref_len: refLen,
    got_len: normForAlign(got).length,
    miss, err, add,
    // 完整度：原文读到了多少；准确率：读到的部分有多少是对的
    coverage: refLen ? Math.max(0, Math.round((refLen - miss) / refLen * 1000) / 10) : 0,
    accuracy: refLen ? Math.max(0, Math.round((refLen - err - add) / refLen * 1000) / 10) : 0,
    repeat: countRepeat(got),
  };
}

/* 重复次数：读错后回头重读，表现为紧挨着的两段相同文本。
   只认 2 字以上（单字的"啊啊"是口吃也算，但"的的"这类虚词紧挨出现不算重复读）；
   叠词（曲曲折折 / 田田）两字不同，不会被误判 */
function countRepeat(s){
  const t = normForAlign(s);
  let n = 0, i = 0;
  while(i < t.length){
    let hit = 0;
    const max = Math.min(8, Math.floor((t.length - i) / 2));
    for(let L = max; L >= 2; L--){
      if(t.slice(i, i + L) === t.slice(i + L, i + 2 * L)){ hit = L; break; }
    }
    if(hit){ n++; i += hit * 2; } else i++;
  }
  return n;
}

/* 把原文渲染出来，漏读的段落标出来——光看数字不知道漏在哪，得看得见 */
function alignHtml(ref, got){
  const ops = alignOps(ref, got);
  // ops 是在"去掉标点后"的文本上算的，要还原到带标点的原文上没法直接用偏移，
  // 所以这里反过来：按原文顺序重建，遇到的标点原样带上
  const raw = String(ref ?? '');
  let out = '', buf = '', src = 0;
  const flush = ()=>{ if(buf){ out += esc(buf); buf = ''; } };
  ops.forEach(o=>{
    if(o.t === 'add') return;            // 多读的字不在原文里，没地方标
    // 跳过原文里的标点与空白，把它们原样拼进当前缓冲
    while(src < raw.length && isSkipChar(raw[src])){ buf += raw[src]; src++; }
    if(src >= raw.length) return;
    if(o.t === 'miss'){ flush(); out += `<i class="al-miss">${esc(o.c)}</i>`; src++; }
    else { buf += o.c; src++; }
  });
  while(src < raw.length){ buf += raw[src]; src++; }
  flush();
  return out;
}

/* 朗读进行中的原文：已读到的字变暗、漏掉的标红、还没读到的保持原样，当前落点给个游标。
   跟结算用的 alignHtml 分开——实时状态需要"读到哪了"，而 LCS 会把没读到的部分也判成漏读 */
function alignSourceHtml(ref, got){
  const raw = String(ref ?? '');
  if(!normForAlign(got)) return esc(raw);       // 一个字还没读：整篇都算没读到
  const ops = alignOps(ref, got);
  const mark = new Array(raw.length).fill('');  // ''=未读 d=已读 m=漏读 c=当前落点
  let src = 0;
  ops.forEach(o=>{
    if(o.t === 'add') return;                   // 多读的字不在原文里
    while(src < raw.length && isSkipChar(raw[src])) src++;
    if(src >= raw.length) return;
    mark[src] = o.t === 'ok' ? 'd' : 'm';
    src++;
  });
  // 最后一个读到的字之后的部分，是"还没读到"而不是"漏读"
  let last = -1;
  for(let i = raw.length - 1; i >= 0; i--){ if(mark[i] === 'd'){ last = i; break; } }
  for(let i = last + 1; i < raw.length; i++) if(mark[i] === 'm') mark[i] = '';
  for(let i = 0; i < raw.length; i++){
    if(isSkipChar(raw[i])) mark[i] = i <= last ? 'd' : '';
  }
  for(let i = last + 1; i < raw.length; i++){ if(!isSkipChar(raw[i])){ mark[i] = 'c'; break; } }
  let out = '', run = '', cur = mark[0];
  const flush = ()=>{
    if(!run) return;
    out += cur === 'd' ? `<span class="al-done">${esc(run)}</span>`
         : cur === 'm' ? `<i class="al-miss">${esc(run)}</i>`
         : cur === 'c' ? `<span class="al-cur">${esc(run)}</span>`
         : esc(run);
    run = '';
  };
  for(let i = 0; i < raw.length; i++){
    if(mark[i] !== cur){ flush(); cur = mark[i]; }
    run += raw[i];
  }
  flush();
  return out;
}
