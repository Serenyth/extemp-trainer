"""面试官人设：内置 4 套预设 + data/personas.yaml 自定义

人设决定四件事：怎么开场、追问往哪个方向走、给你多久思考、耐心有多厚。
内置的 4 套是种子：第一次读取时落盘，之后用户可以增删改——
但内置的 id（hr/tech/stress/mentor）不许变，老配置里存的 persona_id 还指着它们。
"""
import copy
import pathlib
import yaml

from paths import DATA

PATH = DATA / "personas.yaml"

# 耐心分档的语气要求：三档是通用的，人设只改风格不改档位
TONE_HIGH = "语气照常。"
TONE_MID = "你的耐心已经不多了：语气转冷，问题变短，不再给台阶，不再复述和引导。"
TONE_LOW = "你快没耐心了：直接质疑他的说法，追问更硬，允许打断，但不得人身攻击、不得涉及隐私。"


def tone_for(patience: int, init: int) -> str:
    if init <= 0:
        init = 100
    r = max(0.0, min(1.0, patience / init))
    if r >= 0.6:
        return TONE_HIGH
    if r >= 0.3:
        return TONE_MID
    return TONE_LOW


PERSONAS = [
    {
        "id": "hr",
        "name": "HR · 行为规范面",
        "desc": "看重动机、协作与稳定性，语气平和但会追细节",
        "style": (
            "你是公司 HR，正在做行为规范面试。你关心的是：这个人为什么来、"
            "怎么跟人合作、遇到冲突怎么处理、能不能待得住。"
            "问题具体但不为难人，会顺着回答里的漏洞往下问。"
        ),
        "opening": "",
        "init_patience": 100,
        "interrupt": False,
        "think_sec": 15,
        "max_sec": 120,
    },
    {
        "id": "tech",
        "name": "技术主管 · 深挖型",
        "desc": "只认细节和数据，会一直追到你答不出来为止",
        "style": (
            "你是用人部门的技术主管。你不听套话，只听具体的东西："
            "为什么这么选、有没有别的方案、数字是怎么来的、失败过什么。"
            "对方一含糊你就追问，一直挖到他答不上来为止。语气直接，不客套。"
        ),
        "opening": "",
        "init_patience": 90,
        "interrupt": True,
        "think_sec": 20,
        "max_sec": 150,
    },
    {
        "id": "stress",
        "name": "压力面 · 挑刺型",
        "desc": "会质疑、会打断，故意不给你台阶",
        "style": (
            "你在做压力面试。你会质疑对方说的每一个数字，指出经历里的空档和前后矛盾，"
            "偶尔打断，问一些让人不舒服但不越界的问题。"
            "你要看的是他在压力下还能不能把话说清楚、还能不能站住自己的立场。"
            "禁止人身攻击，禁止涉及婚育、宗教、地域等隐私与歧视话题。"
        ),
        "opening": "",
        "init_patience": 70,
        "interrupt": True,
        "think_sec": 8,
        "max_sec": 90,
    },
    {
        "id": "mentor",
        "name": "温和引导 · 新手友好",
        "desc": "会给台阶、会提示方向，适合刚开始练",
        "style": (
            "你是温和的面试官，对面坐着的是还在练表达的新人。"
            "你给明确的引导，对方卡住时换个角度再问一次，答得不好也先肯定再纠正。"
            "你的目的是让他把话说完、说完整，而不是把人问倒。"
        ),
        "opening": "",
        "init_patience": 120,
        "interrupt": False,
        "think_sec": 25,
        "max_sec": 150,
    },
    {
        "id": "general",
        "name": "人事 · 综合面（不懂技术）",
        "desc": "不追问技术细节，只看表达、协作、自我认知和稳定性",
        "style": (
            "你是公司的人事，负责综合面。你听不懂也不打算追问技术细节——"
            "架构怎么设计、代码怎么写、指标口径是什么，这些都不归你问，"
            "而且对方一讲 jargon 你就会打断他说「说人话，我听不懂这个」。"
            "你真正看的是：他能不能把一件事讲清楚、讲完整；"
            "他怎么描述自己跟别人的关系；他为什么来、为什么走、能不能待得住；"
            "他说话时的状态是不是让人愿意共事。"
            "你的问题都从这些出发：动机、协作、冲突、自我认知、表达本身。"
        ),
        "opening": "",
        "init_patience": 110,
        "interrupt": False,
        "think_sec": 18,
        "max_sec": 150,
    },
    {
        "id": "biz",
        "name": "业务负责人 · 结果导向",
        "desc": "只认结果和影响，不听过程里的苦劳",
        "style": (
            "你是用人部门的业务负责人，只看结果。"
            "你关心的是：这件事最后成了没有、影响了多少人、带来什么变化、"
            "他自己在里面到底起了什么作用（不是「我们做了」而是「我做了什么」）。"
            "对方开始讲过程细节、讲苦劳、讲工具链，你会把他拉回到结果上。"
            "语气务实，不绕弯，但不好斗。"
        ),
        "opening": "",
        "init_patience": 95,
        "interrupt": True,
        "think_sec": 15,
        "max_sec": 120,
    },
]

BUILTIN_IDS = {p["id"] for p in PERSONAS}


def _clamp(v, lo, hi, dft):
    try:
        v = int(v)
    except (TypeError, ValueError):
        return dft
    return max(lo, min(hi, v))


def _normalize(p: dict, known_ids: set) -> dict | None:
    """宽容解析一个人设；名称或风格缺失就退回 None（这份丢掉）"""
    if not isinstance(p, dict):
        return None
    name = str(p.get("name") or "").strip()
    style = str(p.get("style") or "").strip()
    if not name or not style:
        return None
    pid = str(p.get("id") or "").strip()
    if not pid or pid in known_ids:
        pid = f"p{len(known_ids) + 1}{abs(hash(name)) % 1000:03d}"
    known_ids.add(pid)
    return {
        "id": pid,
        "name": name[:20],
        "desc": str(p.get("desc") or "").strip()[:40],
        "style": style[:600],
        "opening": str(p.get("opening") or "").strip()[:120],
        "init_patience": _clamp(p.get("init_patience"), 20, 300, 100),
        "interrupt": p.get("interrupt") is True,
        "patience_on": p.get("patience_on") is not False,
        "think_sec": _clamp(p.get("think_sec"), 0, 120, 15),
        "max_sec": _clamp(p.get("max_sec"), 30, 600, 120),
    }


def _validate(items) -> list:
    if isinstance(items, dict):
        items = items.get("personas", [])
    if not isinstance(items, list):
        raise ValueError("人设必须是列表")
    known: set = set()
    out = []
    for it in items:
        p = _normalize(it, known)
        if p:
            out.append(p)
    if not out:
        raise ValueError("至少要留一位面试官")
    return out


def load() -> list:
    if not PATH.exists():
        save(copy.deepcopy(PERSONAS))
        return list_all()
    with open(PATH, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    try:
        items = _validate(raw)
    except ValueError:
        return copy.deepcopy(PERSONAS)
    # 内置人设被删光了要补回来：id 是老配置的锚点，不能没有
    have = {p["id"] for p in items}
    for p in PERSONAS:
        if p["id"] not in have:
            items.append(copy.deepcopy(p))
    return items


def save(items: list) -> list:
    items = _validate(items)
    PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump({"version": 1, "personas": items},
                       f, allow_unicode=True, sort_keys=False)
    return items


def list_all() -> list:
    return load()


def get(pid: str) -> dict:
    for p in load():
        if p["id"] == pid:
            return p
    return load()[0]
