/* 自由练习模式：不抽题、不备稿、不评分，想说什么说什么
   价值全在讲完之后——AI 挑出这段表达的结构、语言、逻辑问题并给改法 */
function startFree(){
  const t = ($('freeTopic').value || '').trim();
  S.topic = t;
  S.topicCat = t ? '自由练习 · ' + t : '自由练习';
  startSpeak();
}

registerMode({
  id: 'free',
  name: '自由练习',
  phases: ['free', 'speak', 'result'],
  // 没有可扣的东西：不看稿、没有原文、也不用显示分数
  speak: {peek: false, hint: false, source: false, score: false, recLabel: 'REC · 想说什么就说什么'},

  enter(){ setPhase('free'); },
  homeLabel: '再练一场',
  again(){ this.enter(); },

  /* 不计分：分数得有可观测的依据（看稿几次、漏读几字），自由练习没有这样的锚点，
     硬凑一个数字只会误导。分数位显示「—」，历史里存 null */
  async end(dur){
    if(S.transcript.trim()){
      S.stats = await api.post('/api/analyze/words', {transcript: S.transcript, duration_sec: dur});
    }
    closeStuck();
    const st = S.stats || {};
    const chars = S.transcript.replace(/\s/g, '').length;
    return {
      score: null,
      rating: '不评分',
      rule: '',
      topic: S.topic || '自由练习',
      cells: [
        {v: Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0'), k: '时长'},
        {v: dur >= 10 ? Math.round(chars / (dur / 60)) : '—', k: '语速'},
        {v: chars, k: '字数'},
        {v: S.stuck, k: '卡壳', pen: true},
        {v: S.stuck ? fmt(Math.round(S.stuckMs / 1000 / S.stuck)) : '0:00', k: '平均卡壳', pen: true},
      ],
      entry: {},
    };
  },

  /* 对比上一场：没有分数可比，就比说得多快、卡不卡、词干不干净 */
  metricsOf(h){
    const st = h?.stats || {}, cat = st.categories || {};
    const mins = Math.max(1 / 60, +(h?.dur || 0) / 60);
    const wc = (cat.filler?.count || 0) + (cat.hedging?.count || 0) + (cat.vague?.count || 0);
    return {
      wpm: Math.round(+(st.chars_per_minute ?? 0) || 0),
      stuck: +(h?.stuck ?? 0),
      habit: (st.habits || []).length ? Math.max(...st.habits.map(x => +(x.count || 0))) : 0,
      density: Math.round(wc / mins * 10) / 10,
      dur: Math.round(+(h?.dur || 0)),
    };
  },
  curMetrics(){
    const st = S.stats || {};
    return this.metricsOf({
      dur: Math.round(speakSec()), stuck: S.stuck,
      stats: {categories: st.categories || {}, habits: st.habits || {},
              chars_per_minute: st.chars_per_minute || 0},
    });
  },
  compareRows: [
    {k: '语速', a: 'wpm', p: 'wpm', u: '字/分', better: 'none', eps: 5},
    {k: '时长', a: 'dur', p: 'dur', u: '秒', better: 'none', eps: 10},
    {k: '卡壳', a: 'stuck', p: 'stuck', u: '次', better: 'low', eps: 0.5},
    {k: '口头禅', a: 'habit', p: 'habit', u: '次', better: 'low', eps: 0.5},
    {k: '词汇密度', a: 'density', p: 'density', u: '次/分', better: 'low', eps: 0.3},
  ],
});
