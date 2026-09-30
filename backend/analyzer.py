"""AI 逐句分析 + 报告生成（OpenAI 兼容 API）"""
import json
import random

import config

SENTENCE_PROMPT = """你是一位严格的中文演讲教练。用户正在做即席演讲脱稿训练，请分析他这段转写文本。

命题：{topic}
（命题仅供参考，判断是否跑题）

转写文本（语音识别结果，可能有错字，请容错理解）：
{transcript}

请只输出 JSON（不要 markdown 代码块），结构：
{{
 "sentences": [
   {{
     "quote": "原句原文（从文本中摘取，保持一字不改）",
     "issues": [{{"type": "repetition|hedging|vague|structure|offtopic|filler|other", "note": "具体说明，一句话"}}],
     "suggestion": "具体改法建议，一句话",
     "severity": "info|warn|error"
   }}
 ],
 "best_sentences": ["最好的1-2句原文"],
 "worst_sentences": ["最需改进的2-3句原文"],
 "summary": "整体两三句总评"
}}

分析重点：
1. 重复：同一意思反复讲（含换说法的语义重复，不只字面）
2. 削弱表达：犹豫词开头、立场不坚定
3. 结构：是否结论先行、有无连接词、收尾是否仓促
4. 跑题：与命题无关的内容
只列出有问题的句子，没问题的好句子放进 best_sentences。"""

INCREMENTAL_PROMPT = """你是严格的中文演讲教练。用户正在做即席演讲脱稿训练，请**只针对他刚说出的最新一句**做即时点评。

命题：{topic}
已经说过的内容（上下文，用于判断重复与跑题，不要点评这些内容）：
{context}

最新一句："{sentence}"

只输出 JSON（不要代码块）：
{{
 "issues": [{{"type": "repetition|hedging|vague|structure|offtopic|filler|other", "note": "一句话说明问题"}}],
 "suggestion": "具体改法，一句话；没问题则留空",
 "severity": "info|warn|error"
}}

判断重点：
1. 是否和上下文重复（含换说法的语义重复）
2. 是否结论先行、是否有犹豫词/笼统词
3. 是否跑题
没问题就返回空 issues 和空 suggestion。"""

# 开讲时的「表达提示」：段落级自动提醒，短，瞄一眼就够
HINT_PROMPT = """你是中文即席演讲教练。用户正在**边说边练**，只能瞄一眼屏幕，没空读长文。

命题：{topic}
他最近讲的内容：
{recent}
你已经提示过的话（不要重复）：{hints}

从下面四类里挑**最要紧的一条**，给出一句提示。都不成立就返回空 hint。

1. off_topic：偏题了、在绕圈子 → 拉回命题，指明该回到什么
2. no_example：连着讲抽象道理，没有具体人/事/数据 → 提醒补一个例子
3. structure：句式重复、结构松散、没有结论 → 指出来
4. direction：内容没问题 → 给「接下来往哪讲」的建议（基于他已说的内容延伸，不要凭空开新话题）

只输出 JSON（不要代码块）：
{{
 "kind": "跑题|缺例子|结构|方向",
 "hint": "一条提示，不超过 15 个字，给方向不给改写，不要复述他说过的话"
}}

硬性要求：
- hint 必须 ≤15 个汉字，口语化，像场边教练递的一句话
- 不要打分、不要夸奖、不要写"你可以尝试"这类套话开头
- 已经提示过的方向不要重复"""

# 点「提示」按钮要的具体建议：这时他卡住了，需要知道"有什么可说的"
DETAIL_PROMPT = """你是中文即席演讲教练。用户做即席演讲训练时**卡住了，主动点了「提示」**。
他要的不是点评，是"接下来我有什么可说的"——要具体到能直接开口讲。

命题：{topic}
他备稿时记的要点（这是他自己想好的思路，优先沿着它给建议）：
{notes}
他最近讲的内容：
{recent}
已经提示过的话（不要重复，不要换说法再说一遍）：{hints}

只输出 JSON（不要代码块）：
{{
 "kind": "方向|内容|例子|收尾",
 "hint": "具体到能直接开口讲的一条建议，{max_chars} 字以内"
}}

给建议的思路（按顺序挑最合适的）：
1. 他备稿要点里**还没讲到的条目** → 直接告诉他"你还有 XX 没讲"，把那条要点摊开说
2. 他讲到的那一点**可以往哪再深一层**：追问、反面、后果
3. 缺具体人/事/数据 → 给一个他能马上补的例子方向（结合命题，不要瞎编细节）
4. 讲够久了 → 提示收尾，给一句怎么收

硬性要求：
- 必须结合命题和他的要点，不要给放之四海皆准的套话（禁止"你可以从个人经历出发"这类）
- 直接说内容，不要夸奖、不要打分、不要用"你可以考虑/尝试"开头
- {max_chars} 字以内，宁短勿长"""

HINT_FALLBACK = [
    "接着刚才的例子再往深说一层",
    "给一个具体的人或场景",
    "回到命题上，别铺太开",
    "先给结论，再补理由",
]

REPORT_PROMPT = """你是演讲教练，基于以下训练数据为用户写一份脱稿训练报告。直接输出 Markdown 正文（不要代码块包裹），语气直接、具体、不空夸。

命题：{topic}
成绩：{score} 分（基础100，看稿每次-{pp}）
看稿 {peek} 次，时长 {dur} 秒
词汇统计：{stats_json}
口头禅：{habits_json}
逐句分析摘要：{analysis_json}

报告结构（用二级标题分节）：
## 总览
一句话定调本次表现。
## 词汇画像
结合统计谈填充词/犹豫词/笼统词情况和口头禅。
## 结构分析
开头是否结论先行、论证展开、收尾质量。
## 做得好的
2-3 条，引用原句说明。
## 需要改进的
3 条以内，每条：问题 + 具体改法。
## 下次训练建议
基于弱点从题库方向给 1-2 道练习命题（自拟即可）。

全文 400-600 字。"""


def _client():
    ai = config.load()["ai"]
    if not ai.get("base_url") or not ai.get("model"):
        return None, "未配置 AI（base_url / model 为空）"
    from openai import OpenAI
    client = OpenAI(
        base_url=ai["base_url"],
        api_key=ai.get("api_key") or "EMPTY",
        timeout=ai.get("timeout", 60),
    )
    return client, None


def _extract_json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("AI 未返回 JSON")
    return json.loads(text[start:end + 1])


def analyze_sentences(topic: str, transcript: str) -> dict:
    client, err = _client()
    if err:
        raise RuntimeError(err)
    model = config.load()["ai"]["model"]
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": SENTENCE_PROMPT.format(topic=topic, transcript=transcript)}],
        temperature=0.3,
    )
    return _extract_json(resp.choices[0].message.content)


def analyze_incremental(topic: str, sentence: str, context: str) -> dict:
    """讲的过程中逐句点评：只针对最新一句，结合上下文

    提示词可在设置里自定义（config.coach.prompt）；留空则用内置的 INCREMENTAL_PROMPT。
    """
    client, err = _client()
    if err:
        raise RuntimeError(err)
    model = config.load()["ai"]["model"]
    tpl = (config.load().get("coach", {}).get("prompt") or "").strip() or INCREMENTAL_PROMPT
    ctx = context[-800:] if context else "（暂无）"
    try:
        # 自定义提示词可能不含全部占位符，缺了就退化成"模板 + 追加原题和句子"
        content = tpl.format(topic=topic, context=ctx, sentence=sentence)
    except (KeyError, IndexError):
        content = f"{tpl}\n\n命题：{topic}\n最新一句：\"{sentence}\""
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        temperature=0.2,
    )
    return _extract_json(resp.choices[0].message.content)


def analyze_hint(topic: str, recent: str, hints: list = None, manual: bool = False,
                 notes: str = "") -> dict:
    """开讲过程中的「表达提示」

    自动触发（段落级）：一句 ≤15 字的当场可用提醒，瞄一眼就够。
    manual=True（点了「提示」按钮）：他卡住了，要的是"接下来有什么可说的"——
    结合备稿要点和命题给具体内容，可以长一些（coach.max_chars，默认 40 字）。
    """
    client, err = _client()
    if err:
        raise RuntimeError(err)
    cfg = config.load()
    model = cfg["ai"]["model"]
    coach = cfg.get("coach", {})
    max_chars = int(coach.get("max_chars") or 40) if manual else 15
    custom = (coach.get("prompt") or "").strip()
    tpl = custom or (DETAIL_PROMPT if manual else HINT_PROMPT)
    given = (hints or [])[-4:]
    fmt = dict(
        topic=topic or "（自由命题）",
        recent=(recent or "（还没说话）")[-600:],
        hints="；".join(given) if given else "（暂无）",
        notes=(notes or "").strip()[:600] or "（备稿时没记要点）",
        max_chars=max_chars,
    )
    try:
        content = tpl.format(**fmt)
    except (KeyError, IndexError):
        content = f"{tpl}\n\n命题：{topic}\n最近内容：{recent}\n备稿要点：{notes}"
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        temperature=0.6,
        timeout=20,
    )
    try:
        r = _extract_json(resp.choices[0].message.content)
    except Exception:
        raw = (resp.choices[0].message.content or "").strip().splitlines()[0][:max_chars]
        return {"kind": "方向", "hint": raw or random.choice(HINT_FALLBACK), "manual": manual}
    hint = str(r.get("hint") or "").strip().splitlines()[0][:max_chars]
    if not hint:
        # 自动触发时四类都不成立就干脆不打扰；手动求助必须给点东西
        hint = random.choice(HINT_FALLBACK) if manual else ""
    return {"kind": str(r.get("kind") or "提示"), "hint": hint, "manual": manual}


def generate_report(topic: str, score: int, peek: int, dur: int,
                    stats: dict, habits: list, analysis: dict,
                    peek_penalty: int = 10) -> str:
    client, err = _client()
    if err:
        raise RuntimeError(err)
    model = config.load()["ai"]["model"]
    resp = client.chat.completions.create(
        model=model,
        messages=[{
            "role": "user",
            "content": REPORT_PROMPT.format(
                topic=topic, score=score, peek=peek, dur=dur, pp=peek_penalty,
                stats_json=json.dumps(stats.get("categories", {}), ensure_ascii=False),
                habits_json=json.dumps(habits, ensure_ascii=False),
                analysis_json=json.dumps({
                    "best": analysis.get("best_sentences", []),
                    "worst": analysis.get("worst_sentences", []),
                    "summary": analysis.get("summary", ""),
                }, ensure_ascii=False),
            ),
        }],
        temperature=0.5,
    )
    content = resp.choices[0].message.content.strip()
    if content.startswith("```"):
        content = content.split("```")[1].lstrip("markdown").lstrip()
    return content
