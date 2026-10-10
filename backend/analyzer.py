"""AI 逐句分析 + 报告生成（OpenAI 兼容 API）"""
import json
import random

import config
import personas

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

# ---------------- 朗读练习的提示词 ----------------
# 朗读的目标和命题演讲相反：不看「有没有东西可讲」，看「有没有把原文读准、读顺」。
# 所以提示词里必须有原文，让 AI 直接比对，而不是让它凭空评价朗读。

READ_SENTENCE_PROMPT = """你是一位严格的中文朗读教练。用户在做朗读练习，请把他的朗读转写与原文逐句对照。

原文标题：{topic}
原文：
{reference}

朗读转写（语音识别结果，**必然有同音错字，不要把这些当成朗读错误**）：
{transcript}

请只输出 JSON（不要 markdown 代码块），结构：
{{
 "sentences": [
   {{
     "quote": "从转写文本中摘取的一句，保持一字不改",
     "issues": [{{"type": "omission|insertion|pacing|repetition|articulation|other", "note": "具体说明，一句话"}}],
     "suggestion": "具体改法建议，一句话",
     "severity": "info|warn|error"
   }}
 ],
 "best_sentences": ["读得最好的1-2句原文"],
 "worst_sentences": ["最需改进的2-3句原文"],
 "summary": "整体两三句总评"
}}

分析重点：
1. omission：整段漏读、跳行、吞掉的字
2. pacing：标点处没停顿、一口气读太长、语速忽快忽慢
3. repetition：读错后回头重读、同一个词重复
4. articulation：断句位置不对，把意思读断了
硬性要求：
- 转写里的同音字（如「在」与「再」、「的」与「地」）不算错误，不要列为 articulation
- 只列真有问题的句子，quote 必须来自转写文本本身"""

READ_HINT_PROMPT = """你是中文朗读教练。用户正在**照着原文朗读**，只能瞄一眼屏幕。

原文：{reference}
他最近读到的内容（转写，有同音错字，容错理解）：
{recent}
你已经提示过的话（不要重复）：{hints}

从下面三类里挑**最要紧的一条**，给出一句提示。都不成立就返回空 hint。

1. pacing：读得太快，标点处几乎不停 → 提醒在标点停一拍
2. omission：跳过了原文的一段 → 提醒回到漏掉的位置
3. rhythm：整段一样的腔调、没有轻重 → 提醒哪类词该重读

只输出 JSON（不要代码块）：
{{
 "kind": "节奏|漏读|轻重",
 "hint": "一条提示，不超过 15 个字，直接可照做"
}}

硬性要求：
- hint 必须 ≤15 个汉字
- 不要打分、不要夸奖、不要复述原文"""

READ_DETAIL_PROMPT = """你是中文朗读教练。用户朗读时**卡住了，主动点了「提示」**。
他要的不是点评，是"接下来该怎么读"——要具体到能直接开口。

原文：{reference}
他最近读到的内容（转写）：
{recent}
已经提示过的话（不要重复）：{hints}

只输出 JSON（不要代码块）：
{{
 "kind": "接读|节奏|断句",
 "hint": "具体到能直接照做的一条建议，{max_chars} 字以内"
}}

给建议的思路（按顺序挑最合适的）：
1. 他停在原文的哪一句 → 直接告诉他下一句怎么读（气口在哪、哪个词重读）
2. 整段读得太赶 → 指出该在哪个标点停一拍
3. 一句话太长 → 告诉他从哪里断开换气

硬性要求：
- 必须落在原文的具体位置上，不要给"放慢速度"这类通用套话
- {max_chars} 字以内，宁短勿长"""

READ_REPORT_PROMPT = """你是朗读教练，基于以下数据为用户写一份朗读练习报告。直接输出 Markdown 正文（不要代码块包裹），语气直接、具体、不空夸。

材料：{topic}
成绩：{score} 分
比对结果：{align_json}
时长 {dur} 秒
逐句分析摘要：{analysis_json}

报告结构（用二级标题分节）：
## 总览
一句话定调本次朗读。
## 完整度
漏读集中在哪类位置（长句、转折处、并列成分），为什么会漏。
## 准确度
错读与添字的规律（同音字不算错，重点看整词替换和结构性添字）。
## 节奏
语速是否稳定、标点停顿是否到位、有没有读断句。
## 需要改进的
3 条以内，每条：问题 + 具体练法。
## 下次练习建议
给 1-2 条可立刻照做的练习动作（如长句断气、重读练习）。

全文 400-600 字。"""

# ---------------- 自由练习 ----------------
# 没有命题、没有原文、没有标准答案，所以不打分，全部落在"这段话该怎么说得更好"上

FREE_SENTENCE_PROMPT = """你是一位严格的中文表达教练。用户在做自由表达练习——没有命题、没有标准答案，想到什么说什么。你要挑出这段表达里值得改的地方。

本场想讲的主题（可能为空；为空就只评表达本身，不要追问主题）：{topic}

转写文本（语音识别结果，可能有错字，请容错理解）：
{transcript}

请只输出 JSON（不要 markdown 代码块），结构：
{{
 "sentences": [
   {{
     "quote": "原句原文（从文本中摘取，保持一字不改）",
     "issues": [{{"type": "structure|clarity|wordiness|logic|tone|other", "note": "具体说明，一句话"}}],
     "suggestion": "具体改法建议，一句话",
     "severity": "info|warn|error"
   }}
 ],
 "best_sentences": ["说得最好的1-2句原文"],
 "worst_sentences": ["最需改进的2-3句原文"],
 "summary": "整体两三句总评"
}}

分析重点（按重要性排）：
1. structure：有没有开头、主体、收尾；整段话能不能用一句话概括出来
2. clarity：指代不清、主语乱换、一句话里塞了太多意思
3. wordiness：同一意思翻来覆去地说、套话、删掉也不损失信息的字
4. logic：前后接不接得上，有没有跳步，结论和理由对不对得上
5. tone：是不是太犹疑（满口「可能」「也许」），或者反过来太绝对

硬性要求：
- 不要统计「那个」「就是」这类填充词——系统已经在别处统计了，重复列出来是噪音
- 不要纠正语音识别造成的错字
- 只列真有问题的句子，quote 必须来自转写文本本身
- 说得好的句子放进 best_sentences，别只挑毛病"""

FREE_HINT_PROMPT = """你是中文表达教练。用户正在**自由表达练习**（没有命题，想到什么说什么），只能瞄一眼屏幕，没空读长文。

本场想讲的主题：{topic}
他最近说的内容（转写，有错字，容错理解）：
{recent}
你已经提示过的话（不要重复）：{hints}

从下面三类里挑**最要紧的一条**，给出一句提示。都不成立就返回空 hint。

1. 讲了半天还没说出核心意思 → 提醒先把结论说出口
2. 一直在铺陈细节、没有明确判断 → 提醒给出自己的观点
3. 同一层意思在打转 → 提醒往前推一步（讲原因 / 给例子 / 准备收尾）

只输出 JSON（不要代码块）：
{{
 "kind": "结构|观点|推进",
 "hint": "一条提示，不超过 15 个字，直接可照做"
}}

硬性要求：
- hint 必须 ≤15 个汉字
- 不要打分、不要夸奖、不要复述他说过的话"""

FREE_DETAIL_PROMPT = """你是中文表达教练。用户做自由表达练习时**说不下去了，主动点了「提示」**。
他要的不是点评，是"接着能说什么"——要具体到能直接开口。

本场想讲的主题：{topic}
他最近说的内容（转写）：
{recent}
已经提示过的话（不要重复）：{hints}

只输出 JSON（不要代码块）：
{{
 "kind": "接讲|收口|展开",
 "hint": "具体到能直接照做的一条建议，{max_chars} 字以内"
}}

给建议的思路（按顺序挑最合适的）：
1. 他停在一个点上没展开 → 给一个可以接着讲的具体方向（讲个例子 / 补一句原因）
2. 内容已经够了 → 提醒他收口，并给出一句可以直接用的收尾
3. 他讲的是结论但没给依据 → 提示补一条支撑

硬性要求：
- 必须落在他已经说过的内容上，不要给"放慢语速"这类通用套话
- {max_chars} 字以内，宁短勿长"""

FREE_REPORT_PROMPT = """你是中文表达教练，基于以下数据为用户写一份自由练习报告。直接输出 Markdown 正文（不要代码块包裹），语气直接、具体、不空夸。

本场主题：{topic}
时长 {dur} 秒
词汇统计：{stats_json}
逐句分析摘要：{analysis_json}

报告结构（用二级标题分节）：
## 总览
一句话定调这段表达的整体水平。
## 结构
开头是否立住、中间有没有层次、收尾是否完整；有没有一句能概括整段话。
## 语言
啰嗦、指代不清、主语乱换、一句塞太多意思这类具体问题，引用原句说明。
## 逻辑
前后是否接得上，有没有跳步或结论与理由对不上。
## 需要改进的
3 条以内，每条：问题 + 具体改法。
## 下次练习建议
给 1-2 条可立刻照做的练习动作。

注意：自由练习不打分，全文不要出现分数。
全文 400-600 字。"""

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

INTV_BRIEF_PROMPT = """你要面试一个人。先把他的简历压成一份面试用的备忘，让你一眼就知道该问什么。

应聘方向：{target}

简历原文：
{resume}

请只输出 JSON（不要 markdown 代码块）：
{{
 "brief": "结构化摘要，300 字以内。按「经历 / 项目 / 技能」归拢，务必保留所有可核对的数字与时间点（如 QPS 下降 30%、P99 220ms），这些是后面追问的抓手",
 "suspects": ["容易被追问的点，3-6 条，每条一句话，写成一个可以直接开口问的方向"]
}}

「疑点」怎么找——真实面试官就是这么看简历的：
- 只说"提升了性能"却没说提升多少：数字含糊或根本没有数字
- 时间空档、跳槽过密、职责与年限对不上
- 堆了一堆技术名词，看不出他在其中具体做了什么
- 项目描述只有"参与/负责"，看不到决策与取舍
- 经历和应聘方向对不上

要求：只陈述简历里能看出来的东西，不要脑补经历、不要夸奖。"""

INTV_NEXT_PROMPT = """你在面试一个人，现在轮到你开口说下一句话。

【你的人设】
{persona}

【当前状态】
- 应聘方向：{target}
- 这是你的第 {round} 个问题。这场没有固定的轮数：问到你觉得把这个人看清楚了为止
- 你的耐心：{patience} / {init_patience}
{streak}
{tone}

【简历摘要】
{brief}

【你手上的追问点，挑还没问过的用】
{suspects}

【已经问过的问题，绝对不许换种说法再问一遍】
{asked}

【刚才的情况】
{trigger}
他刚才的回答：
{transcript}

请只输出 JSON（不要 markdown 代码块）：
{{
 "question": "面试官开口说的下一句话。口语、自然，像真人说话，1-3 句，不超过 80 字",
 "intent": "这句话想考察什么，写给你自己看的，不超过 20 字",
 "react": "听到他刚才那段回答之后的即时反应：一个动作、一个表情或一句很短的评价，8 字以内。要具体、像现场观察，比如「皱了下眉」「点了下头」「在纸上记了一笔」「没接话，看着他」。不要复述回答内容，不要写打分",
 "end": "这场面试要不要到此为止。问够了、耐心耗尽、或对方明显不适合 → true，此时 question 写一句自然的收尾话（比如「好，今天就聊到这里」），不要再抛新问题；还想继续问 → false"
}}

硬性要求：
- **不许重复已问过的问题**，包括换个说法的重复（问过"优点"就别再问"长处"）
- 优先打还没问过的追问点；都问过了就顺着他上一轮回答里最含糊的一句往下挖
- 像人说话，不要一上来就是"请你谈谈……"这种书面腔
- 不要给答案、不要给提示、不要替他把话说完
- 不要超出你的人设：即便压力面也不得人身攻击，不得涉及婚育、宗教、地域等隐私与歧视话题
- 耐心越低，话越短越硬；耐心高的时候可以多给一点背景
- **只问你人设范围内的事**：人事 / 非技术的面试官不追问技术细节（架构、源码、指标口径都不问），
  只问动机、协作、沟通方式、自我认知、稳定性和表达本身；技术主管才往下挖细节
- 对方连续答不好时，你可以当场点出来（「这两个问题你都没答上来」），但不得嘲讽、不得人身攻击
- 一般要到第 3 个问题之后才考虑收尾；除非耐心已经见底，否则不要草草结束"""

INTV_CLOSE_PROMPT = """你在面试一个人，现在你要把这场面试收掉。

【你的人设】
{persona}

【收尾原因】
{reason}

【这场的情况】
- 应聘方向：{target}
- 你的耐心：{patience} / {init_patience}
- 已经问了 {rounds} 轮
{log}

请只输出 JSON（不要 markdown 代码块）：
{{
 "closing": "你开口说的收尾的话，1-3 句，不超过 90 字",
 "ask_back": "要不要再抛一句「你有什么想了解的吗」这类反问。true/false"
}}

硬性要求：
- 语气由人设和耐心决定：耐心见底 → 冷、短、不解释；耐心还在 → 客气，给一句体面的台阶
- 收尾话里可以说「今天就到这里」，但**不要评价他的能力高低**、不要当众宣判结果
- 决定抛反问时，closing 里就把反问带上（比如「你这边有什么想了解的吗？」），不要再单独开一段
- 人事 / 非技术面试官的收尾可以提一句后续流程；技术主管一般直接收
"""

INTV_OPENING_PROMPT = """你在面试一个人，马上要开口说第一句话。

【你的人设】
{persona}

应聘方向：{target}

【简历摘要】
{brief}

请只输出 JSON（不要 markdown 代码块）：
{{"text": "面试官的开场白"}}

要求：
- 先一句话打招呼、自报身份，再自然带出第一个问题（或请对方先自我介绍）
- 口语，像真人说话，2-3 句，不超过 90 字
- 语气符合你的人设；不要罗列问题清单，不要书面腔"""

INTV_HINT_PROMPT = """你是面试教练。候选人卡住了，点了一下求助。给他一个方向，不要替他回答。

应聘方向：{target}
面试官的问题：{question}
他刚才说的（语音识别转写，有错字，容错理解）：
{recent}
已经提示过：{hints}

请只输出 JSON（不要 markdown 代码块）：
{{"kind": "方向", "hint": "不超过 {max_chars} 字的一句话方向提示"}}

要求：
- 只指方向，不给内容。说"补一个具体的数字""先把结果说出来"，不要说"你可以说……"
- 不要重复已经提示过的
- 不要夸他，也不要复述他说过的话"""

INTV_SENTENCE_PROMPT = """你是严格的面试教练。下面是一段面试回答，你只评价「这段回答讲得好不好」。

应聘方向：{target}
面试官的问题：{question}
候选人的回答（语音识别结果，可能有错字，请容错理解）：
{transcript}

请只输出 JSON（不要 markdown 代码块）：
{{
 "sentences": [
   {{
     "quote": "原句原文（从文本中摘取，保持一字不改）",
     "issues": [{{"type": "relevance|structure|evidence|length|clarity|other", "note": "具体说明，一句话"}}],
     "suggestion": "具体改法，一句话",
     "severity": "info|warn|error"
   }}
 ],
 "dims": {{"relevance": 0-100, "structure": 0-100, "evidence": 0-100, "length": 0-100, "clarity": 0-100}},
 "best_sentences": ["答得最好的1-2句原文"],
 "worst_sentences": ["最需改进的2-3句原文"],
 "summary": "两三句总评"
}}

五个维度怎么判：
1. relevance 针对性：答的是不是问的那个问题，有没有绕开、偷换、答非所问
2. structure 结构：有没有情境-任务-行动-结果（STAR）的骨架，还是想到哪说到哪
3. evidence 证据：有没有具体事例、数字、可核对的细节，还是全是"我觉得我比较擅长"
4. length 时长控制：是不是说太长收不住（超过 2 分钟），还是短到只有一句话
5. clarity 清晰度：指代清楚、句子完整、没有绕来绕去的从句

硬性要求：
- **不要评判内容的真伪**。你并不知道他的经历是不是真的，只评价"这段回答讲得像不像一个好答案"
- 不要统计「那个」「就是」这类填充词——系统已经在别处统计了，重复列出来是噪音
- 不要纠正语音识别造成的错字
- 只列真有问题的句子，quote 必须来自转写文本本身
- 答得好的句子放进 best_sentences，别只挑毛病"""

INTV_REPORT_PROMPT = """你是面试教练，基于下面这场模拟面试写一份复盘报告。直接输出 Markdown 正文（不要代码块包裹），语气直接、具体、不空夸。

应聘方向：{target}
总分：{score} 分
五维得分：{dims}
面试官耐心：{patience} / {init_patience}（归零=被面试官提前赶出去了）
总时长 {dur} 秒
各轮问答与点评：{rounds_json}
词汇统计：{stats_json}

报告结构（用二级标题分节）：
## 总览
一句话定调整场表现，点出最致命的那一个问题。
## 按轮复盘
每一轮一小节：面试官问了什么 / 你答得怎么样 / 这一轮最该改的一点。引用原句。
## 五个维度
针对性 / 结构 / 证据 / 时长 / 清晰度，逐个说清分数背后的原因，不重复总览里的话。
## 需要改进的
3 条以内，每条：问题 + 具体改法 + 改完会有什么不同。
## 下次练习建议
1-2 条能立刻照做的动作。

注意：不要评价他说的内容是真还是假，只评价表达。全文 500-700 字。"""

# 按模式取提示词。新增模式时在这里补一套，别在各函数里写 if。
# 必须放在所有提示词常量之后——这张表引用了它们
PROMPTS = {
    "extemp": {"sentence": SENTENCE_PROMPT, "hint": HINT_PROMPT,
               "detail": DETAIL_PROMPT, "report": REPORT_PROMPT},
    "read":   {"sentence": READ_SENTENCE_PROMPT, "hint": READ_HINT_PROMPT,
               "detail": READ_DETAIL_PROMPT, "report": READ_REPORT_PROMPT},
    "free":   {"sentence": FREE_SENTENCE_PROMPT, "hint": FREE_HINT_PROMPT,
               "detail": FREE_DETAIL_PROMPT, "report": FREE_REPORT_PROMPT},
    # 面试模式的「提示」只有一个用途：卡住时指个方向，不给答案，所以 hint / detail 共用
    "interview": {"sentence": INTV_SENTENCE_PROMPT, "hint": INTV_HINT_PROMPT,
                  "detail": INTV_HINT_PROMPT, "report": INTV_REPORT_PROMPT},
}


def prompts_for(mode: str) -> dict:
    return PROMPTS.get(mode) or PROMPTS["extemp"]


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


def analyze_sentences(topic: str, transcript: str, mode: str = "extemp",
                      reference: str = "", question: str = "") -> dict:
    client, err = _client()
    if err:
        raise RuntimeError(err)
    model = config.load()["ai"]["model"]
    if mode == "interview":
        content = prompts_for("interview")["sentence"].format(
            target=topic or "（未填应聘方向）",
            question=question or "（开场自我介绍）",
            transcript=transcript)
    else:
        content = prompts_for(mode)["sentence"].format(
            topic=topic, transcript=transcript, reference=reference or "（未提供原文）")
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
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
                 notes: str = "", mode: str = "extemp", reference: str = "",
                 question: str = "") -> dict:
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
    # 自定义提示词只在命题演讲下生效：它是照着命题演讲写的（有 {topic}/{notes}），
    # 套到朗读上会缺占位符
    if custom and mode == "extemp":
        tpl = custom
    else:
        p = prompts_for(mode)
        tpl = p["detail"] if manual else p["hint"]
    given = (hints or [])[-4:]
    fmt = dict(
        topic=topic or "（自由命题）",
        recent=(recent or "（还没说话）")[-600:],
        hints="；".join(given) if given else "（暂无）",
        notes=(notes or "").strip()[:600] or "（备稿时没记要点）",
        max_chars=max_chars,
        reference=(reference or "").strip()[:1200] or "（未提供原文）",
    )
    if mode == "interview":
        # 面试的提示词要的是「应聘方向 + 这一轮的问题」，跟命题演讲的占位符对不上
        fmt["target"] = topic or "（未填应聘方向）"
        fmt["question"] = question or "（开场自我介绍）"
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


def interview_brief(resume: str, target: str = "") -> dict:
    """进场前读一遍简历：压成结构化摘要 + 一份「疑点清单」

    只调用一次，之后每轮追问都只用摘要，不再带简历全文——
    一份简历一千多字，每轮都带上既贵又容易把后半段漏掉。
    """
    client, err = _client()
    if err:
        raise RuntimeError(err)
    model = config.load()["ai"]["model"]
    content = INTV_BRIEF_PROMPT.format(
        target=target or "（未填应聘方向）",
        resume=(resume or "").strip()[:6000] or "（没有提供简历，按通用问题问）")
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        temperature=0.2,
    )
    r = _extract_json(resp.choices[0].message.content)
    suspects = [str(x).strip() for x in (r.get("suspects") or []) if str(x).strip()]
    return {
        "brief": str(r.get("brief") or "").strip(),
        "suspects": suspects[:8],
    }


def interview_next(persona: dict, target: str, brief: str, suspects: list,
                   asked: list, transcript: str, trigger: str,
                   round_no: int, patience: int, init_patience: int,
                   streak: int = 0) -> dict:
    """生成面试官的下一句话

    trigger 决定这句话的性质：开场 / 正常下一问 / 卡壳后的追问 / 超时收尾 / 手动追问。
    耐心只影响语气（越没耐心话越硬），扣分是前端按本地规则算的，不由 AI 说了算。
    场次没有上限：AI 认为该收尾会在 end 里说，考生也可以随时自己结束。
    """
    client, err = _client()
    if err:
        raise RuntimeError(err)
    model = config.load()["ai"]["model"]
    content = INTV_NEXT_PROMPT.format(
        persona=(persona or {}).get("style") or "",
        target=target or "（未填应聘方向）",
        round=round_no,
        patience=patience, init_patience=init_patience,
        tone=personas.tone_for(patience, init_patience),
        streak=(f"- 他已经连续 {streak} 轮答得不好（答不上来 / 答非所问 / 讲太久）"
                if streak >= 2 else ""),
        brief=brief or "（没有简历，按通用问题问）",
        suspects="\n".join(f"- {s}" for s in (suspects or [])) or "（暂无）",
        asked="\n".join(f"{i+1}. {q}" for i, q in enumerate(asked or [])) or "（还没问过）",
        trigger=trigger,
        transcript=(transcript or "").strip()[-1200:] or "（他还没说话）",
    )
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        temperature=0.7,      # 提问要有点变化，太确定就每场都一样了
        timeout=30,
    )
    try:
        r = _extract_json(resp.choices[0].message.content)
    except Exception:
        return {"question": "", "intent": "", "react": "", "end": False}
    return {
        "question": str(r.get("question") or "").strip(),
        "intent": str(r.get("intent") or "").strip(),
        "react": str(r.get("react") or "").strip()[:20],
        "end": r.get("end") is True or str(r.get("end")).lower() == "true",
    }


def interview_close(persona: dict, target: str, rounds: list, patience: int,
                    init_patience: int, reason: str = "") -> dict:
    """面试官提前收场时的收尾话。

    真实面试里「被提前结束」是最该被记住的反馈，所以不能只弹一句系统提示——
    得让面试官本人开口说完，还常常带一句「你有什么想了解的吗」。
    """
    client, err = _client()
    if err:
        raise RuntimeError(err)
    model = config.load()["ai"]["model"]
    log = "\n".join(
        f"第 {i+1} 轮 · 问：{(r or {}).get('q','')}\n   答：{((r or {}).get('text') or '（没答）')[:120]}"
        for i, r in enumerate((rounds or [])[-6:])
    ) or "（还没问几句）"
    content = INTV_CLOSE_PROMPT.format(
        persona=(persona or {}).get("style") or "",
        target=target or "（未填应聘方向）",
        reason=reason or "你觉得问得差不多了",
        patience=patience, init_patience=init_patience,
        rounds=len(rounds or []),
        log=log,
    )
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        temperature=0.6,
        timeout=30,
    )
    try:
        r = _extract_json(resp.choices[0].message.content)
    except Exception:
        r = {}
    closing = str(r.get("closing") or "").strip()
    if not closing:
        # AI 没接上也要收得下去：按耐心给一冷一热两句兜底
        closing = ("今天就到这里吧，你这边还有什么想了解的吗？"
                   if patience > init_patience * 0.3
                   else "行，今天就到这儿。后续有消息我们会通知你。")
    return {
        "closing": closing[:200],
        "ask_back": r.get("ask_back") is True or "想了解" in closing,
    }


def interview_opening(persona: dict, target: str, brief: str = "") -> dict:
    """面试官的开场白。人设里写了 opening 就不必要走这里——
    这是给「没写开场白、也不想让 AI 顺着第一问即兴」的场景留的口子"""
    client, err = _client()
    if err:
        raise RuntimeError(err)
    model = config.load()["ai"]["model"]
    content = INTV_OPENING_PROMPT.format(
        persona=(persona or {}).get("style") or "",
        target=target or "（未填应聘方向）",
        brief=(brief or "").strip()[:1200] or "（没有简历，按通用问题问）",
    )
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        temperature=0.7,
        timeout=20,
    )
    try:
        r = _extract_json(resp.choices[0].message.content)
        text = str(r.get("text") or "").strip()
    except Exception:
        text = ""
    return {"text": text[:150]}


def generate_report(topic: str, score: int, peek: int, dur: int,
                    stats: dict, habits: list, analysis: dict,
                    peek_penalty: int = 10, mode: str = "extemp",
                    rounds: list = None, patience: int = None,
                    init_patience: int = 100) -> str:
    client, err = _client()
    if err:
        raise RuntimeError(err)
    model = config.load()["ai"]["model"]
    summary = {
        "best": analysis.get("best_sentences", []),
        "worst": analysis.get("worst_sentences", []),
        "summary": analysis.get("summary", ""),
    }
    if mode == "interview":
        content = prompts_for("interview")["report"].format(
            target=topic or "（未填应聘方向）",
            score=score if score is not None else "—",
            dims=json.dumps(analysis.get("dims", {}), ensure_ascii=False),
            patience=patience if patience is not None else "—",
            init_patience=init_patience,
            dur=dur,
            rounds_json=json.dumps([
                {"round": i + 1,
                 "question": (r or {}).get("q", ""),
                 "answer": ((r or {}).get("text", "") or "")[:800],
                 "feedback": (r or {}).get("fb", {})}
                for i, r in enumerate(rounds or [])
            ], ensure_ascii=False),
            stats_json=json.dumps(stats.get("categories", {}), ensure_ascii=False),
        )
    elif mode == "read":
        content = prompts_for("read")["report"].format(
            topic=topic, score=score, dur=dur,
            align_json=json.dumps(stats.get("align", {}), ensure_ascii=False),
            analysis_json=json.dumps(summary, ensure_ascii=False),
        )
    elif mode == "free":
        # 自由练习不评分，所以这份报告里不出现 score
        content = prompts_for("free")["report"].format(
            topic=topic or "（没定主题，自由发挥）", dur=dur,
            stats_json=json.dumps(stats.get("categories", {}), ensure_ascii=False),
            analysis_json=json.dumps(summary, ensure_ascii=False),
        )
    else:
        content = prompts_for("extemp")["report"].format(
            topic=topic, score=score, peek=peek, dur=dur, pp=peek_penalty,
            stats_json=json.dumps(stats.get("categories", {}), ensure_ascii=False),
            habits_json=json.dumps(habits, ensure_ascii=False),
            analysis_json=json.dumps(summary, ensure_ascii=False),
        )
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        temperature=0.5,
    )
    content = resp.choices[0].message.content.strip()
    if content.startswith("```"):
        content = content.split("```")[1].lstrip("markdown").lstrip()
    return content
