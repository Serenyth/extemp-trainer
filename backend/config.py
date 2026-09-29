"""TOML 配置管理：data/config.toml 读写 + 默认值生成"""
import copy
import pathlib
import tomllib
import tomli_w

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
CONFIG_PATH = DATA / "config.toml"

DEFAULTS = {
    "theme": {
        "preset": "carbon",
        "custom": {"bg": "#0F1013", "ink": "#EDEDEF", "accent": "#E24B4A"},
    },
    "ai": {
        "base_url": "",
        "api_key": "",
        "model": "",
        "timeout": 60,
        "auto_analyze": False,  # 讲完自动跑一次整体分析（省掉手动点那一下）
    },
    "speech": {
        "engine": "none",       # none | web-speech | whisper | sherpa
        "model": "",            # whisper: tiny/base/...; sherpa: sense-voice-zh / paraformer-zh ...
        # 断句等待（silence_ms）与最长一句（max_utter_sec）可在设置面板调节；
        # 其余两项是固定值（前端不下发）：
        "silence_ms": 1200,     # 静音多久算"一句话说完"（离线引擎分段 + 流式端点规则都用它）
                                # 端点规则由它推导：rule1 = max(0.6s, silence_ms)，rule2 = max(0.25s, silence_ms/2)
        "max_utter_sec": 20,    # 单句最长时长：连续说满这么久就强制断一句（**不看停顿**）
                                # 想要"一直说话也不加句号"就把它调大，比如 60
        "punct_enabled": False, # 是否启用"标点恢复模型"（需先在设置里下载）；
                                # 关=沿用原来的"每段补个句号"；开=由模型补逗号/问号等
        "min_speech_ms": 300,   # 短于此的片段视为噪声丢弃
        "chunk_ms": 1500,       # 连续说太久时的兜底：强制转一次，避免一直不定稿
        "partial_ms": 0,        # "边说边出字"已移除：0=关闭，离线引擎只在说完一句后出字
                                # （流式模型不受此项影响，本身就是边说边出字）
    },
    # 界面交互：抽题音效（Web Audio 合成，无音频文件）
    "ui": {
        "sfx": True,
        "history_keep": 200,    # 历史保留条数，超出后从最旧的一条开始丢（连它的报告一起）
    },
    # 表达提示（开讲时给一句短提醒：跑题 / 缺例子 / 接下来往哪讲）
    "coach": {
        "prompt": "",       # 留空 = 用 analyzer.HINT_PROMPT 内置提示词；
                            # 自定义时可用 {topic} / {recent} / {hints} 三个占位符
        "every": 3,         # 每几句触发一次 AI 提示（1=每句；3=每三句，省 token）
        "min_chars": 8,     # 短于此的句子不参与计数（过滤"嗯""对"这类碎片）
        "max_chars": 40,    # 点「提示」按钮要的方向建议字数上限（比段落建议长、更具体）
        "hint_sec": 24,     # 提示条停留秒数；0=不自动收起，必须手动点掉
    },
    "training": {
        "base_score": 100,
        "peek_penalty": 10,
        "prep_durations": [5, 10, 20, 30],
        "filler_scoring": False,
        "filler_threshold": 8,  # 次/分钟，超出部分每2次扣1分
        "hint_penalty": 5,      # 主动点「提示」换一条方向建议的扣分；0=不扣分
        "auto_pause": True,     # 看稿/提示时自动暂停计时（看稿看完、提示拿到就自动继续）
        "ready_countdown": 3,   # 开讲前的准备倒计时（秒）；0=不倒计时，点了就直接开始
        "auto_start_sec": 5,    # 备稿倒计时归零后，再倒数这么多秒自动开讲；0=不自动，等你手动点
        "peek_duration": 3,     # 每次看稿时，纸条展示多久（秒）——长的代价是进度条也走得慢
        # 实时信号：本地算的提醒阈值（不经过 AI）
        "stuck_sec": 3,         # 多久没出字算一次卡壳；卡壳次数与平均时长按这个算
        "wpm_fast": 330,        # 语速超过多少（字/分钟）提醒放慢
        "wpm_slow": 0,          # 语速低于多少（字/分钟）提醒提速；0=不提醒
        "filler_burst": 3,      # 最近 200 字内同一口头禅出现几次就提醒
    },
    # 开讲页的文字大小与转写排版：只影响显示层，不影响统计
    "display": {
        "subtitle_size": 30,    # 实时字稿字号（px）
        "coach_size": 13.5,     # 实时教练文字字号（px）
        "sentence_newline": True,   # 转写按句分行显示
        "show_punct": True,         # 显示句末标点（关闭只是不显示，文本仍带标点供点评切句用）
    },
}

# 预设主题（前端应用为 CSS 变量）
PRESETS = {
    "carbon": {"bg": "#0F1013", "ink": "#EDEDEF", "muted": "#8A8F98",
               "faint": "#5A5E66", "line": "rgba(237,237,239,.10)", "accent": "#E24B4A",
               "amber": "#D9A13B", "green": "#6FBF9A", "surface": "#141519", "dark": True},
    "paper": {"bg": "#F4F2ED", "ink": "#23241F", "muted": "#6E6B62",
              "faint": "#9C988C", "line": "rgba(35,36,31,.12)", "accent": "#B3402F",
              "amber": "#9A6B1B", "green": "#3E7D5C", "surface": "#FFFFFF", "dark": False},
    "forest": {"bg": "#0D1412", "ink": "#E2EAE4", "muted": "#84988D",
               "faint": "#4E5E55", "line": "rgba(226,234,228,.10)", "accent": "#5DCAA5",
               "amber": "#D9A13B", "green": "#6FBF9A", "surface": "#121A17", "dark": True},
}


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load() -> dict:
    if not CONFIG_PATH.exists():
        save(DEFAULTS)
        return copy.deepcopy(DEFAULTS)
    with open(CONFIG_PATH, "rb") as f:
        user_cfg = tomllib.load(f)
    return _merge(DEFAULTS, user_cfg)


def save(cfg: dict) -> dict:
    cfg = _merge(DEFAULTS, cfg)  # 补全缺失字段
    DATA.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "wb") as f:
        tomli_w.dump(cfg, f)
    return cfg
