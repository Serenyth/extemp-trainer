"""AI 逐句分析 + 报告生成（OpenAI 兼容 API）"""
import json

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

REPORT_PROMPT = """你是演讲教练，基于以下训练数据为用户写一份脱稿训练报告。直接输出 Markdown 正文（不要代码块包裹），语气直接、具体、不空夸。

命题：{topic}
成绩：{score} 分（基础100，忘词每次-{fp}，看稿每次-{pp}）
忘词 {forget} 次，看稿 {peek} 次，时长 {dur} 秒
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


def generate_report(topic: str, score: int, forget: int, peek: int, dur: int,
                    stats: dict, habits: list, analysis: dict,
                    forget_penalty: int = 5, peek_penalty: int = 10) -> str:
    client, err = _client()
    if err:
        raise RuntimeError(err)
    model = config.load()["ai"]["model"]
    resp = client.chat.completions.create(
        model=model,
        messages=[{
            "role": "user",
            "content": REPORT_PROMPT.format(
                topic=topic, score=score, forget=forget, peek=peek, dur=dur,
                fp=forget_penalty, pp=peek_penalty,
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
