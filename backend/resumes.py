"""简历库：data/resumes.yaml 读写。结构是列表，每份 {name, target, text}

面试模式的第一步就是挑一份简历——没有简历，AI 只能问通用问题；
有了简历，它才能追到「你写的 QPS 提升 30% 到底怎么做的」。
简历是纯文本：粘贴进来即可，不做 PDF/Word 解析（排版花哨的文件抽出来多半是乱码）。
"""
import copy
import pathlib
import yaml

from paths import DATA

RESUMES_PATH = DATA / "resumes.yaml"

# 提示用：超过这个长度 AI 读起来又贵又容易漏掉后半段，前端也会挡一道
GUIDE_CHARS = 6000

SAMPLE_RESUME = {
    "name": "示例简历（看完就删）",
    "target": "后端工程师 · 三年经验",
    "text": (
        "张示例，三年后端开发经验。\n\n"
        "工作经历\n"
        "2023.03 - 至今　某某科技　后端工程师\n"
        "- 负责订单服务的重构，把下单接口 P99 从 800ms 压到 220ms\n"
        "- 主导引入本地缓存，数据库 QPS 下降约 30%\n"
        "- 带过 2 名新人，其中 1 人半年后独立负责模块\n\n"
        "2021.07 - 2023.02　某某网络　后端开发\n"
        "- 参与会员系统从单体拆到微服务\n"
        "- 做过一次线上故障复盘，推动补齐了监控告警\n\n"
        "教育\n"
        "2017 - 2021　某大学　计算机科学与技术　本科\n\n"
        "技能\n"
        "Go / Python / MySQL / Redis / Kafka；熟悉 Kubernetes 基本运维"
    ),
}


def _validate(items) -> list:
    """容错解析：接受 [简历] 或 {resumes:[简历]}；名字或正文为空就跳过这份"""
    if isinstance(items, dict):
        items = items.get("resumes", [])
    if not isinstance(items, list):
        raise ValueError("简历库必须是列表")
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "").strip()
        text = str(it.get("text") or "").strip()
        if not name or not text:
            continue
        out.append({
            "name": name,
            "target": str(it.get("target") or "").strip(),
            "text": text,
        })
    return out


def load() -> list:
    if not RESUMES_PATH.exists():
        save([SAMPLE_RESUME])
        return copy.deepcopy([SAMPLE_RESUME])
    with open(RESUMES_PATH, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    try:
        items = _validate(raw)
    except ValueError:
        return copy.deepcopy([SAMPLE_RESUME])
    # 全被删空了不补样例：跟材料库一个规矩，别让手滑的人面对一堆看不懂的示例
    return items


def save(items: list) -> list:
    items = _validate(items)
    RESUMES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(RESUMES_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(
            {"version": 1, "resumes": items},
            f, allow_unicode=True, sort_keys=False,
        )
    return items
