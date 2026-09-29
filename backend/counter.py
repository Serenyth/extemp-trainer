"""词汇统计与词表管理"""
import copy
import pathlib
import re
import yaml

ROOT = pathlib.Path(__file__).resolve().parent
WORDS_PATH = ROOT / "data" / "words.yaml"

DEFAULT_WORDS = {
    "filler": ["嗯", "啊", "呃", "那个", "这个", "然后", "就是说", "就是", "其实", "反正"],
    "hedging": ["可能", "大概", "应该", "也许", "好像", "感觉", "怎么说呢", "之类的", "我觉得"],
    "vague": ["东西", "事情", "方面", "各种", "很多", "比较好", "挺那个的", "什么的", "一些"],
}
CATEGORY_LABELS = {"filler": "填充词", "hedging": "犹豫词", "vague": "笼统词"}


def load() -> dict:
    if not WORDS_PATH.exists():
        save(DEFAULT_WORDS)
        return copy.deepcopy(DEFAULT_WORDS)
    with open(WORDS_PATH, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    out = {}
    for cat in DEFAULT_WORDS:
        words = raw.get(cat)
        if isinstance(words, list):
            out[cat] = [str(w) for w in words if str(w).strip()]
        else:
            out[cat] = list(DEFAULT_WORDS[cat])
    return out


def save(words: dict) -> dict:
    out = {}
    for cat in DEFAULT_WORDS:
        ws = words.get(cat)
        out[cat] = [str(w) for w in ws if str(w).strip()] if isinstance(ws, list) else list(DEFAULT_WORDS[cat])
    WORDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(WORDS_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(out, f, allow_unicode=True, sort_keys=False)
    return out


# ---------------- 统计 ----------------

STOPWORDS = set("的了是我你在和就都也很要有着与到说会被这个一个不没有人我们他们她它吗呢吧啊呀嗯".split()) | {
    "所以", "但是", "因为", "如果", "这样", "那样", "什么", "怎么", "还可以", "还是", "的话",
}


def split_sentences(text: str) -> list:
    parts = re.split(r"(?<=[。！？!?；;\n])", text)
    return [p.strip() for p in parts if p.strip()]


def mark_words(text: str, words: dict) -> list:
    """返回 [{start, end, word, cat}]，按词长优先匹配，避免重叠"""
    entries = []
    for cat, ws in words.items():
        for w in ws:
            if not w:
                continue
            for m in re.finditer(re.escape(w), text):
                entries.append({"start": m.start(), "end": m.end(), "word": w, "cat": cat})
    entries.sort(key=lambda e: (e["start"], -(e["end"] - e["start"])))
    picked, cursor = [], -1
    for e in entries:
        if e["start"] >= cursor:
            picked.append(e)
            cursor = e["end"]
    return picked


def _tokenize(text: str) -> list:
    return re.findall(r"[\u4e00-\u9fff]{2,4}|[A-Za-z]+", text)


def analyze(text: str, words: dict, duration_sec: float) -> dict:
    """完整统计：三类词、口头禅、语速、句长"""
    marks = mark_words(text, words)
    by_cat = {c: 0 for c in words}
    for m in marks:
        by_cat[m["cat"]] += 1

    minutes = max(duration_sec / 60.0, 1e-9)
    char_count = len(re.sub(r"\s", "", text))
    freq = {c: round(by_cat[c] / minutes, 2) for c in by_cat}

    # 高频口头禅：不属于任何词表、非停用词、出现>=3次的 2-4 字词
    known = set(w for ws in words.values() for w in ws)
    tokens = _tokenize(text)
    counts = {}
    for t in tokens:
        if t in known or t in STOPWORDS or len(t) < 2:
            continue
        counts[t] = counts.get(t, 0) + 1
    habits = sorted(
        [{"word": w, "count": c} for w, c in counts.items() if c >= 3],
        key=lambda x: -x["count"],
    )[:3]

    sentences = split_sentences(text)
    avg_sent = round(char_count / max(len(sentences), 1), 1)

    return {
        "char_count": char_count,
        "sentence_count": len(sentences),
        "avg_sentence_len": avg_sent,
        "chars_per_minute": round(char_count / minutes),
        "duration_sec": round(duration_sec),
        "categories": {c: {"count": by_cat[c], "per_minute": freq[c],
                            "label": CATEGORY_LABELS.get(c, c)} for c in by_cat},
        "habits": habits,
        "marks": [{"start": m["start"], "end": m["end"], "word": m["word"], "cat": m["cat"]} for m in marks],
    }
