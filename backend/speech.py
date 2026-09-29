"""语音引擎封装：懒加载 faster-whisper（本地），VAD 由能量法兜底，音频只在内存"""
import asyncio
import io
import os
import re
import sys
import traceback
import wave

import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))

# 镜像环境：huggingface-hub 走国内镜像；禁用 Xet 协议（Xet 会绕过镜像直连
# cas-server.xethub.hf.co 导致 401 Unauthorized，镜像场景必须走传统 HTTP 下载）
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

_whisper_model = None
_whisper_name = ""


def list_whisper_models() -> list:
    return [
        {"id": "tiny",    "size_mb": 75,   "zh_quality": 1, "desc": "最快，中文一般"},
        {"id": "base",    "size_mb": 142,  "zh_quality": 2, "desc": "较快，中文一般"},
        {"id": "small",   "size_mb": 466,  "zh_quality": 3, "desc": "均衡，中文尚可"},
        {"id": "medium",  "size_mb": 1500, "zh_quality": 4, "desc": "较准，建议GPU"},
        {"id": "large-v3","size_mb": 3000, "zh_quality": 5, "desc": "最准，需GPU"},
    ]


# sherpa-onnx 模型池（中文优先）
# group: 流式=边说边出字（OnlineRecognizer）/ 离线=整段转写（OfflineRecognizer）
# desc 只写短备注（列表里显示），完整说明放 tip（鼠标悬浮）
SHERPA_MODELS = [
    {"id": "streaming-zipformer-zh-xl", "group": "流式",
     "repo": "csukuangfj/sherpa-onnx-streaming-zipformer-zh-xlarge-int8-2025-06-30",
     "dir": "sherpa-streaming-zipformer-zh-xl", "size_mb": 736, "zh_quality": 5,
     "desc": "最准·吃性能", "tip": "xlarge 流式版，准确率最高，CPU 占用大，机器好再选",
     "type": "streaming-transducer"},
    {"id": "streaming-zipformer-ctc-zh-xl", "group": "流式",
     "repo": "csukuangfj/sherpa-onnx-streaming-zipformer-ctc-zh-xlarge-int8-2025-06-30",
     "dir": "sherpa-streaming-zipformer-ctc-zh-xl", "size_mb": 728, "zh_quality": 5,
     "desc": "xl·CTC 解码", "tip": "xlarge 的 CTC 版（728MB）：与 xl transducer 同级精度，但 CTC 无 joiner 网络，纯中文场景更省算力",
     "type": "streaming-zipformer-ctc"},
    {"id": "streaming-zipformer-zh-25", "group": "流式",
     "repo": "csukuangfj/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30",
     "dir": "sherpa-streaming-zipformer-zh-25", "size_mb": 160, "zh_quality": 5,
     "desc": "纯中文·新", "tip": "2025 版，纯中文场景最准；但遇到英文单词会识别成乱码，只说中文就选它",
     "type": "streaming-transducer"},
    {"id": "streaming-zipformer-zh", "group": "流式",
     "repo": "csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20",
     "dir": "sherpa-streaming-zipformer-zh", "size_mb": 190, "zh_quality": 5,
     "desc": "中英·推荐", "tip": "双语版：纯中文不输新模型，中英夹杂（术语/品牌名）时英文也能识别对，最稳的选择",
     "type": "streaming-transducer"},
    {"id": "streaming-zipformer-zh-14m", "group": "流式",
     "repo": "csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23",
     "dir": "sherpa-streaming-zipformer-zh-14m", "size_mb": 30, "zh_quality": 3,
     "desc": "极小·极快", "tip": "14M 参数流式模型，低配机器也能实时，准确率一般",
     "type": "streaming-transducer"},
    {"id": "fire-red-asr-zh-en", "group": "离线",
     "repo": "csukuangfj/sherpa-onnx-fire-red-asr-large-zh_en-2025-02-16",
     "dir": "sherpa-fire-red-asr-zh-en", "size_mb": 1658, "zh_quality": 5,
     "desc": "精度最高·1.6G",
     "tip": "小红书 FireRedASR-AED-L（1.1B 参数）：公开中文基准平均 CER 约 3.05%，优于 Paraformer-Large(4.56)、SenseVoice-L(4.47)、Whisper-Large-v3(9.86)。体积 1.6G、编码器-解码器自回归，CPU 上偏慢，只建议用于讲完之后的全文转写复盘；实时字幕别选",
     "type": "fire-red-asr"},
    {"id": "sense-voice-zh", "group": "离线",
     "repo": "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
     "dir": "sherpa-sense-voice-zh", "size_mb": 230, "zh_quality": 5,
     "desc": "最准·带标点", "tip": "离线模型里中文最准，自带标点、断句准，但只能整段出字",
     "type": "sense-voice"},
    {"id": "paraformer-zh", "group": "离线",
     "repo": "csukuangfj/sherpa-onnx-paraformer-zh-2023-09-14",
     "dir": "sherpa-paraformer-zh", "size_mb": 232, "zh_quality": 5,
     "desc": "准·快·推荐", "tip": "实测与 SenseVoice 同档准确度，速度更快（5.6s 音频 0.2s 转完）",
     "type": "paraformer"},
    {"id": "zipformer-ctc-zh", "group": "离线",
     "repo": "csukuangfj/sherpa-onnx-zipformer-ctc-zh-int8-2025-07-03",
     "dir": "sherpa-zipformer-ctc-zh", "size_mb": 350, "zh_quality": 5,
     "desc": "新·中文专训", "tip": "2025 版 zipformer CTC，纯中文训练，准确率高、速度快",
     "type": "zipformer-ctc"},
]


# 各类型需要的文件（_find_file 是精确名匹配，别写通配符；一个键里给多种命名写法）
MODEL_FILES = {
    "streaming-transducer": {
        "encoder": ["encoder-epoch-99-avg-1.int8.onnx", "encoder.int8.onnx", "encoder.onnx"],
        "decoder": ["decoder-epoch-99-avg-1.int8.onnx", "decoder-epoch-99-avg-1.onnx",
                    "decoder.int8.onnx", "decoder.onnx"],
        "joiner": ["joiner-epoch-99-avg-1.int8.onnx", "joiner.int8.onnx", "joiner.onnx"],
        "tokens": ["tokens.txt"],
    },
    "streaming-zipformer-ctc": {
        "model": ["model.int8.onnx", "model.onnx"],
        "tokens": ["tokens.txt"],
    },
    "zipformer-ctc": {
        "model": ["model.int8.onnx", "model.onnx"],
        "tokens": ["tokens.txt"],
    },
    # FireRedASR：encoder + decoder 分离，无 joiner
    "fire-red-asr": {
        "encoder": ["encoder.int8.onnx", "encoder.onnx"],
        "decoder": ["decoder.int8.onnx", "decoder.onnx"],
        "tokens": ["tokens.txt"],
    },
}
# 单文件模型（SenseVoice / Paraformer）共用这一套
SINGLE_FILES = {"model": ["model.int8.onnx", "model.onnx"], "tokens": ["tokens.txt"]}

# 下载时只取量化版，跳过未量化的大文件（有的仓库 model.onnx 近 1GB）
DOWNLOAD_PATTERNS = {
    "streaming-transducer": ["*encoder*.int8.onnx", "*decoder*.onnx", "*joiner*.int8.onnx", "tokens.txt"],
    "streaming-zipformer-ctc": ["model.int8.onnx", "tokens.txt"],
    "zipformer-ctc": ["model.int8.onnx", "tokens.txt"],
    "fire-red-asr": ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"],
}


def _sherpa_dir(model_id: str) -> str:
    m = next((x for x in SHERPA_MODELS if x["id"] == model_id), None)
    return os.path.join(ROOT, "data", "models", m["dir"]) if m else ""


def _sherpa_meta(model_id: str) -> dict:
    return next((x for x in SHERPA_MODELS if x["id"] == model_id), {})


_sherpa_rec = None
_sherpa_id = ""


def _find_file(d: str, names: list) -> str:
    for n in names:
        p = os.path.join(d, n)
        if os.path.isfile(p):
            return p
    # 仓库里可能放在子目录
    for root, _d, files in os.walk(d):
        for n in names:
            if n in files:
                return os.path.join(root, n)
    return ""


def is_streaming_model(model_id: str) -> bool:
    return _sherpa_meta(model_id).get("type", "").startswith("streaming")


def required_files(model_id: str) -> dict:
    """该模型需要哪些文件（key → 候选文件名列表）"""
    t = _sherpa_meta(model_id).get("type", "")
    return MODEL_FILES.get(t, SINGLE_FILES)


def find_model_files(model_id: str) -> dict:
    """返回 {key: 实际路径 or ""}"""
    d = _sherpa_dir(model_id)
    return {k: _find_file(d, names) for k, names in required_files(model_id).items()}


def load_sherpa(model_id: str, silence_ms: int = 700, max_utter_sec: float = 20.0):
    """加载 sherpa-onnx 识别器（离线 SenseVoice/Paraformer 或 流式 Zipformer）"""
    global _sherpa_rec, _sherpa_id
    # 缓存键带上端点参数：改了断句规则要能重建流式端点规则
    key = f"{model_id}@{silence_ms}@{max_utter_sec}"
    if _sherpa_rec is not None and _sherpa_id == key:
        return _sherpa_rec
    import sherpa_onnx

    meta = _sherpa_meta(model_id)
    d = _sherpa_dir(model_id)
    t = meta.get("type", "")
    # 端点（=断句）规则跟着设置走：
    #   rule1 通用静音阈值；rule2 已说了一段后更短的停顿也算说完
    #   rule3 单句最长时长：连续说满这么多秒就强制断一句，**不看停顿**
    #     ↑ 这个之前写死 6.0s，导致"一直说话不停顿也会被加句号"
    rule1 = max(0.6, silence_ms / 1000.0)
    rule2 = max(0.25, silence_ms / 2000.0)
    rule3 = max(3.0, float(max_utter_sec))

    if t == "streaming-transducer":
        found = find_model_files(model_id)
        missing = [k for k, p in found.items() if not p]
        if missing:
            raise RuntimeError(f"缺少文件：{missing}，请重新下载模型")
        rec = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=found["tokens"], encoder=found["encoder"],
            decoder=found["decoder"], joiner=found["joiner"],
            num_threads=4, sample_rate=16000, feature_dim=80,
            decoding_method="greedy_search", enable_endpoint_detection=True,
            rule1_min_trailing_silence=rule1, rule2_min_trailing_silence=rule2,
            rule3_min_utterance_length=rule3)
        _sherpa_rec, _sherpa_id = rec, key
        return rec

    if t == "streaming-zipformer-ctc":
        found = find_model_files(model_id)
        missing = [k for k, p in found.items() if not p]
        if missing:
            raise RuntimeError(f"缺少文件：{missing}，请重新下载模型")
        rec = sherpa_onnx.OnlineRecognizer.from_zipformer2_ctc(
            tokens=found["tokens"], model=found["model"],
            num_threads=4, sample_rate=16000, feature_dim=80,
            decoding_method="greedy_search", enable_endpoint_detection=True,
            rule1_min_trailing_silence=rule1, rule2_min_trailing_silence=rule2,
            rule3_min_utterance_length=rule3)
        _sherpa_rec, _sherpa_id = rec, key
        return rec

    if t == "zipformer-ctc":
        found = find_model_files(model_id)
        if not found.get("model") or not found.get("tokens"):
            raise RuntimeError("缺少 model.onnx/tokens.txt，请重新下载模型")
        rec = sherpa_onnx.OfflineRecognizer.from_zipformer_ctc(
            model=found["model"], tokens=found["tokens"], num_threads=4,
            sample_rate=16000, feature_dim=80, decoding_method="greedy_search")
        _sherpa_rec, _sherpa_id = rec, key
        return rec

    if t == "fire-red-asr":
        found = find_model_files(model_id)
        missing = [k for k, p in found.items() if not p]
        if missing:
            raise RuntimeError(f"缺少文件：{missing}，请重新下载模型")
        # 编码器-解码器自回归，1.6G 体积，CPU 上较慢：只走整段转写，不进流式管线
        rec = sherpa_onnx.OfflineRecognizer.from_fire_red_asr(
            encoder=found["encoder"], decoder=found["decoder"], tokens=found["tokens"],
            num_threads=4, decoding_method="greedy_search", provider="cpu")
        _sherpa_rec, _sherpa_id = rec, key
        return rec

    if meta.get("type") == "sense-voice":
        model = _find_file(d, ["model.int8.onnx", "model.onnx"])
        tokens = _find_file(d, ["tokens.txt"])
        try:
            # SenseVoice 是多语种模型，锁定 zh 避免对噪声片段猜成韩/日文
            rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=model, tokens=tokens, language="zh", use_itn=True, num_threads=4)
        except TypeError:
            rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=model, tokens=tokens, use_itn=True, num_threads=4)
    else:
        model = _find_file(d, ["model.int8.onnx", "model.onnx"])
        tokens = _find_file(d, ["tokens.txt"])
        rec = sherpa_onnx.OfflineRecognizer.from_paraformer(
            paraformer=model, tokens=tokens, num_threads=4)
    _sherpa_rec, _sherpa_id = rec, key
    return rec


def transcribe_sherpa(rec, pcm16: bytes, sample_rate: int = 16000) -> str:
    import numpy as np
    audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
    stream = rec.create_stream()
    stream.accept_waveform(sample_rate, audio)
    rec.decode_stream(stream)
    return stream.result.text.strip()


def _online_text(res) -> str:
    """不同版本 sherpa-onnx 的 get_result 返回值不一致（有 .text 属性 / 直接是字符串）"""
    return (res.text if hasattr(res, "text") else str(res)).strip()


class StreamingSession:
    """流式会话：一路音频持续喂进来，每帧都能拿到"到目前为止"的文本

    与离线识别（整段转写）的区别：这里由 OnlineRecognizer 增量解码，
    所以是真正的逐字往外冒，而不是等一句说完再整段出字。
    feed() 返回 (当前整句文本, 刚说完的一句 or None)
    """

    def __init__(self, rec, sample_rate: int = 16000):
        self.rec = rec
        self.sr = sample_rate
        self.stream = rec.create_stream()
        self.text = ""

    def feed(self, pcm16: bytes):
        audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
        if not len(audio):
            return self.text, None
        self.stream.accept_waveform(self.sr, audio)
        while self.rec.is_ready(self.stream):
            self.rec.decode_stream(self.stream)
        text = _online_text(self.rec.get_result(self.stream))
        ended = None
        if self.rec.is_endpoint(self.stream):
            ended = text
            self.rec.reset(self.stream)   # 端点=一句说完，开启下一句
            self.text = ""
        else:
            self.text = text
        return text, ended

    def flush(self) -> str:
        """收尾：把还没到端点但已经识别出的内容吐出来"""
        text = _online_text(self.rec.get_result(self.stream))
        try:
            self.rec.reset(self.stream)
        except Exception:
            pass
        self.text = ""
        return text


async def download_sherpa(model_id: str) -> str:
    from huggingface_hub import snapshot_download

    meta = _sherpa_meta(model_id)
    target = _sherpa_dir(model_id)
    loop = asyncio.get_running_loop()

    def _download():
        t = meta.get("type", "")
        if t in DOWNLOAD_PATTERNS:
            # 流式 transducer / paraformer / CTC：按需取量化版文件
            patterns = DOWNLOAD_PATTERNS[t]
        else:
            # SenseVoice / Paraformer：只要量化版 + 词表，跳过未量化的大文件
            patterns = ["model.int8.onnx", "tokens.txt", "config.json"]
        snapshot_download(repo_id=meta["repo"], local_dir=target,
                          allow_patterns=patterns, resume_download=True, max_workers=2)
        # 注意：校验用精确文件名（_find_file 不支持通配符）
        missing = [k for k, names in required_files(model_id).items()
                   if not _find_file(target, names)]
        if missing:
            raise RuntimeError(f"下载不完整，缺 {missing}，请重试")
        return target

    return await loop.run_in_executor(None, _download)


"""---------------- 标点恢复模型（可选，独立于 ASR 模型池）----------------

流式模型不输出标点，句末的句号是我们补的；挂一个标点模型可以把逗号、问号也补出来。
用 sherpa-onnx 的 OfflinePunctuation（CT-Transformer），官方仓库只提供 fp32 版 ≈281MB。
"""
PUNCT_MODEL = {
    "dir": "sherpa-punct-ct-transformer-zh-en",
    "repo": "csukuangfj/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12",
    "file": "model.onnx",
    "size_mb": 281,
}
_punct_obj = None


def punct_model_dir() -> str:
    return os.path.join(ROOT, "data", "models", PUNCT_MODEL["dir"])


def punct_status() -> dict:
    """只回报下载状态；开关状态由上层从 config 里读"""
    p = os.path.join(punct_model_dir(), PUNCT_MODEL["file"])
    has = os.path.isfile(p) and os.path.getsize(p) > 5 * 1024 * 1024   # 小于 5MB 视为残缺
    return {"downloaded": has, "expected_mb": PUNCT_MODEL["size_mb"],
            "size_mb": round(os.path.getsize(p) / 1048576, 1) if os.path.isfile(p) else 0.0}


def reset_punct_cache():
    """重新下载后要清掉缓存的识别器，否则用的还是旧文件"""
    global _punct_obj
    _punct_obj = None


def load_punct():
    global _punct_obj
    if _punct_obj is not None:
        return _punct_obj
    p = os.path.join(punct_model_dir(), PUNCT_MODEL["file"])
    if not os.path.isfile(p):
        return None
    import sherpa_onnx
    mc = sherpa_onnx.OfflinePunctuationModelConfig(
        ct_transformer=p, num_threads=1, debug=False, provider="cpu")
    _punct_obj = sherpa_onnx.OfflinePunctuation(
        sherpa_onnx.OfflinePunctuationConfig(model=mc))
    return _punct_obj


def add_punctuation(text: str) -> str:
    """给一段无标点文本补标点；模型没下载就原样返回"""
    if not text or not text.strip():
        return text
    obj = load_punct()
    if obj is None:
        return text
    try:
        out = obj.add_punctuation(text)
    except Exception:
        return text
    return (out or text).strip()


async def download_punct() -> dict:
    from huggingface_hub import snapshot_download

    reset_punct_cache()
    loop = asyncio.get_running_loop()
    target = punct_model_dir()

    def _download():
        snapshot_download(repo_id=PUNCT_MODEL["repo"], local_dir=target,
                          allow_patterns=[PUNCT_MODEL["file"]],
                          resume_download=True, max_workers=2)

    await loop.run_in_executor(None, _download)
    reset_punct_cache()
    st = punct_status()
    if not st["downloaded"]:
        raise RuntimeError("下载未完成，请重试")
    return st


def whisper_model_dir(model_id: str) -> str:
    return os.path.join(ROOT, "data", "models", f"whisper-{model_id}")


REQUIRED_FILES = ["model.bin", "config.json"]
MIN_MODEL_BYTES = 5 * 1024 * 1024  # 小于 5MB 视为残缺（最小的 tiny 也有 ~40MB）


def _whisper_status(model_id: str) -> dict:
    """判断模型是否可用：目录 + 关键文件 + 体积校验，避免"下载中断"被当成已下载"""
    d = whisper_model_dir(model_id)
    missing, size = [], 0
    for f in REQUIRED_FILES:
        p = os.path.join(d, f)
        if not os.path.isfile(p) or os.path.getsize(p) < (MIN_MODEL_BYTES if f == "model.bin" else 1):
            missing.append(f)
        elif f == "model.bin":
            size = os.path.getsize(p)
    return {"downloaded": not missing, "missing": missing, "size_mb": round(size / 1048576, 1)}


def is_model_downloaded(model_id: str) -> bool:
    return model_status(model_id)["downloaded"]


def model_status(model_id: str) -> dict:
    """统一入口：whisper 与 sherpa 模型共用状态判断"""
    if model_id in [m["id"] for m in SHERPA_MODELS]:
        d = _sherpa_dir(model_id)
        missing = [k for k, names in required_files(model_id).items() if not _find_file(d, names)]
        return {"downloaded": not missing, "missing": missing,
                "size_mb": dir_size_mb(d) if not missing else 0.0}
    return _whisper_status(model_id)


def _cleanup_partial(target: str):
    """清理中断残留：.incomplete 文件与体积异常的 model.bin"""
    if not os.path.isdir(target):
        return
    for name in os.listdir(target):
        p = os.path.join(target, name)
        if name.endswith(".incomplete") and os.path.isfile(p):
            os.remove(p)
    mb = os.path.join(target, "model.bin")
    if os.path.isfile(mb) and os.path.getsize(mb) < MIN_MODEL_BYTES:
        os.remove(mb)


async def download_whisper(model_id: str, progress_cb=None) -> str:
    """从 hf-mirror 下载模型；whisper / sherpa 均走此入口"""
    if model_id in [m["id"] for m in SHERPA_MODELS]:
        return await download_sherpa(model_id)
    from huggingface_hub import snapshot_download

    loop = asyncio.get_running_loop()
    target = whisper_model_dir(model_id)

    def _download():
        _cleanup_partial(target)  # 先清掉上次中断的残片
        snapshot_download(
            repo_id=f"Systran/faster-whisper-{model_id}",
            local_dir=target,
            local_dir_use_symlinks=False,
            allow_patterns=["model.bin", "config.json", "tokenizer.json",
                            "vocabulary.txt", "vocabulary.json", "preprocessor_config.json"],
            resume_download=True,   # 断点续传，大文件中断后不必从头再来
            max_workers=2,          # 镜像场景下降低并发更稳
        )
        if not os.path.isfile(os.path.join(target, "model.bin")):
            raise RuntimeError("下载完成但缺少 model.bin，请重试（镜像可能未返回完整文件）")
        return target

    # snapshot_download 自带 tqdm 进度；在后台线程执行避免阻塞事件循环
    return await loop.run_in_executor(None, _download)


def _model_dir(model_id: str) -> str:
    return _sherpa_dir(model_id) if model_id in [m["id"] for m in SHERPA_MODELS] else whisper_model_dir(model_id)


def delete_model(model_id: str) -> dict:
    """删除模型目录。返回 {ok, error?}，失败原因要能显示给用户

    Windows 上如果识别器还加载着这个模型，onnx 文件会被占用而删不掉，
    所以先释放缓存里的 recognizer 再删；仍失败就返回原因而不是抛 500。
    """
    import shutil
    global _sherpa_rec, _sherpa_id, _whisper_model, _whisper_name
    d = _model_dir(model_id)
    if not d or not os.path.isdir(d):
        return {"ok": False, "error": "模型目录不存在"}

    # 先卸载：缓存键可能是 "模型id@silence_ms"
    if _sherpa_id == model_id or _sherpa_id.split("@")[0] == model_id:
        _sherpa_rec, _sherpa_id = None, ""
    if _whisper_name == model_id:
        _whisper_model, _whisper_name = None, ""
    try:
        import gc
        gc.collect()
    except Exception:
        pass

    try:
        shutil.rmtree(d)
        return {"ok": True}
    except Exception as e:
        err = str(e)
        # 再试一次：先改名（占用的目录通常改不了，但能过就多一层机会）
        try:
            tmp = d + ".pending-delete"
            if os.path.isdir(tmp):
                shutil.rmtree(tmp, ignore_errors=True)
            os.rename(d, tmp)
            shutil.rmtree(tmp, ignore_errors=True)
            if not os.path.isdir(tmp):
                return {"ok": True, "note": "已删除"}
        except Exception as e2:
            err = f"{err} / {e2}"
        return {"ok": False, "error": f"删除失败（文件可能正被占用）：{err}"}


def load_whisper(model_id: str):
    global _whisper_model, _whisper_name
    if _whisper_model is not None and _whisper_name == model_id:
        return _whisper_model
    from faster_whisper import WhisperModel

    compute_type = "auto"
    _whisper_model = WhisperModel(whisper_model_dir(model_id), device="auto", compute_type=compute_type)
    _whisper_name = model_id
    return _whisper_model


def transcribe_pcm(model, pcm16: bytes, sample_rate: int = 16000,
                   prompt: str = "", vad: bool = True) -> str:
    """PCM16 单声道 → 文本（内存中转 numpy）

    prompt: 上一句定稿文本，作为 initial_prompt 保持上下文/专有名词一致
    vad:    短片段（实时预览）建议关掉内部 VAD，否则容易被整段判成静音
    """
    audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
    segments, _ = model.transcribe(
        audio, language="zh", beam_size=5, vad_filter=vad,
        initial_prompt=(prompt[-200:] if prompt else None),
    )
    return "".join(seg.text for seg in segments)


def pcm_to_wav_bytes(pcm16: bytes, sample_rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm16)
    return buf.getvalue()


def vad_cut(pcm16: bytes, silence_ms: int = 700, min_speech_ms: int = 300,
            sample_rate: int = 16000):
    """增量切段：返回 (已完成片段列表[bytes], 需保留的剩余音频[bytes])

    与 energy_vad_split 的区别：它只把"已经说完（尾部静音够长）"的片段切出来，
    正在说的那一段保留在剩余音频里，从而实现边说边转写、不用等整句结束。
    """
    audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
    frame = int(sample_rate * 0.03)          # 30ms 一帧
    n = len(audio) // frame
    if n == 0:
        return [], pcm16
    rms = np.sqrt((audio[: n * frame].reshape(n, frame) ** 2).mean(axis=1))
    threshold = max(rms.max() * 0.02, 1e-4)
    silent_need = max(1, silence_ms // 30)
    min_frames = int(sample_rate * min_speech_ms / 1000) // frame

    segs, start, run, keep_from = [], None, 0, len(audio)
    for i, r in enumerate(rms):
        if r > threshold:
            if start is None:
                start = i
            run = 0
        else:
            if start is not None:
                run += 1
                if run >= silent_need:
                    end = i - silent_need + 1
                    if end - start >= max(min_frames, 1):
                        segs.append((start * frame, end * frame))
                    start, run = None, 0
                    keep_from = (i + 1) * frame
    if start is not None:
        keep_from = start * frame           # 正在说话：保留这一段
    elif keep_from > len(audio):
        keep_from = len(audio)
    return [pcm16[s * 2:e * 2] for s, e in segs], pcm16[keep_from * 2:]


def energy_vad_split(pcm16: bytes, sample_rate: int = 16000,
                     frame_ms: int = 30, silence_ms: int = 700, threshold_ratio: float = 0.02):
    """能量 VAD：按静音段切分音频，返回片段列表 [(start_byte, end_byte)]"""
    audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
    frame = int(sample_rate * frame_ms / 1000)
    n_frames = len(audio) // frame
    if n_frames == 0:
        return []
    rms = np.sqrt((audio[: n_frames * frame].reshape(n_frames, frame) ** 2).mean(axis=1))
    threshold = max(rms.max() * threshold_ratio, 1e-4)
    silent_frames_needed = silence_ms // frame_ms

    segments, start = [], None
    silent_run = 0
    for i, r in enumerate(rms):
        if r > threshold:
            if start is None:
                start = i
            silent_run = 0
        else:
            if start is not None:
                silent_run += 1
                if silent_run >= silent_frames_needed:
                    segments.append((start * frame, i * frame))
                    start, silent_run = None, 0
    if start is not None:
        segments.append((start * frame, n_frames * frame))
    # 过滤过短片段（<0.3s 多为呼吸/噪声）
    return [(s, e) for s, e in segments if (e - s) > int(sample_rate * 0.3)]


def sane_text(t: str) -> str:
    """过滤噪声片段产生的胡言乱语：很短且不含汉字的一律丢弃"""
    t = t.strip()
    if not t:
        return ""
    if len(t) <= 3 and not re.search(r"[\u4e00-\u9fff]", t):
        return ""
    return t


def dir_size_mb(path: str) -> float:
    total = 0
    if os.path.isdir(path):
        for root, _d, files in os.walk(path):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
    return round(total / 1048576, 1)


def err_log(e: Exception) -> str:
    traceback.print_exception(type(e), e, e.__traceback__, file=sys.stderr)
    return f"{type(e).__name__}: {e}"
