"""FastAPI 主应用：REST + WebSocket 语音流 + 静态前端托管"""
import asyncio
import json
import os
import time

from fastapi import FastAPI, HTTPException, UploadFile, File, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import analyzer
import bank
import config
import counter
import history
import speech

app = FastAPI(title="脱稿训练场", docs_url=None, redoc_url=None)


# ---------------- 配置 ----------------

@app.get("/api/config")
def get_config():
    return config.load()


@app.put("/api/config")
def put_config(cfg: dict):
    return config.save(cfg)


@app.get("/api/theme/resolve")
def resolve_theme():
    cfg = config.load()
    t = cfg["theme"]
    if t["preset"] == "custom":
        c = t["custom"]
        return {**c, "muted": "#A6ABB5", "faint": "#7A7F8A", "line": "rgba(128,128,128,.18)",
                "amber": "#D9A13B", "green": "#6FBF9A", "surface": c["bg"], "dark": True}
    return config.PRESETS[t["preset"]]


# ---------------- 题库 ----------------

@app.get("/api/bank")
def get_bank():
    return bank.load()


@app.put("/api/bank")
def put_bank(data: dict):
    try:
        return bank.save(data)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/bank/export", response_class=PlainTextResponse)
def export_bank():
    return bank.export_yaml()


@app.post("/api/bank/import")
async def import_bank(mode: str = Query("merge"), file: UploadFile = File(...)):
    text = (await file.read()).decode("utf-8")
    try:
        return bank.import_yaml(text, mode)
    except ValueError as e:
        raise HTTPException(400, f"题库文件格式错误：{e}")


# ---------------- 词表 ----------------

@app.get("/api/words")
def get_words():
    return counter.load()


@app.put("/api/words")
def put_words(data: dict):
    return counter.save(data)


# ---------------- 统计 ----------------

class AnalyzeReq(BaseModel):
    transcript: str
    duration_sec: float


@app.post("/api/analyze/words")
def analyze_words(req: AnalyzeReq):
    return counter.analyze(req.transcript, counter.load(), req.duration_sec)


# ---------------- 语音模型 ----------------

@app.get("/api/speech/models")
def speech_models():
    return {
        "engines": [
            {"id": "none", "name": "无（只计分）", "need_download": False},
            {"id": "web-speech", "name": "浏览器转写（Web Speech API）", "need_download": False},
            {"id": "whisper", "name": "Whisper 本地", "need_download": True},
            {"id": "sherpa", "name": "Sherpa-ONNX 本地（中文更准）", "need_download": True},
        ],
        "whisper": [
            {**m, **speech.model_status(m["id"])}
            for m in speech.list_whisper_models()
        ],
        "sherpa": [
            {k: v for k, v in m.items() if k != "repo"} | speech.model_status(m["id"])
            for m in speech.SHERPA_MODELS
        ],
    }


@app.delete("/api/speech/model")
def delete_model(model_id: str = Query(...)):
    try:
        return speech.delete_model(model_id)      # {ok, error?}
    except Exception as e:
        return {"ok": False, "error": speech.err_log(e)}


@app.post("/api/speech/warmup")
async def speech_warmup():
    """预加载转写模型（幂等，第二次是秒回）。

    实测 streaming-zipformer-zh-xl 首次 load_sherpa 要 9.3 秒；如果这笔开销留到开讲之后
    才发生，第一句话的音频会全部落在加载窗口里被丢掉 —— 用户的感觉就是
    "第一句要等说完才出字，后面才正常流式"。
    备稿阶段有 5~10 分钟，把它藏在那时做，开讲时模型已经在缓存里。
    """
    sp = config.load()["speech"]
    engine, model_id = sp.get("engine", "none"), sp.get("model", "")
    if engine not in ("sherpa", "whisper"):
        return {"ok": False, "skipped": True}
    if not model_id or not speech.is_model_downloaded(model_id):
        return {"ok": False, "skipped": True}
    loop = asyncio.get_running_loop()
    try:
        t0 = time.time()
        if engine == "whisper":
            await loop.run_in_executor(None, speech.load_whisper, model_id)
        else:
            rec = await loop.run_in_executor(
                None, speech.load_sherpa, model_id,
                int(sp.get("silence_ms", 700)), float(sp.get("max_utter_sec", 20)))
            if speech.is_streaming_model(model_id):
                await loop.run_in_executor(None, speech.StreamingSession(rec).warmup)
        return {"ok": True, "ms": int((time.time() - t0) * 1000)}
    except Exception as e:
        return {"ok": False, "error": speech.err_log(e)}


@app.get("/api/speech/punct")
def punct_status():
    """标点恢复模型的状态；enabled 从配置里读"""
    return {**speech.punct_status(),
            "enabled": bool(config.load()["speech"].get("punct_enabled", False))}


@app.post("/api/speech/punct/download")
async def punct_download():
    try:
        return await speech.download_punct()
    except Exception as e:
        raise HTTPException(500, f"下载失败：{speech.err_log(e)}")


@app.delete("/api/speech/punct")
def punct_delete():
    import shutil
    try:
        speech.reset_punct_cache()
        d = speech.punct_model_dir()
        if os.path.isdir(d):
            shutil.rmtree(d, ignore_errors=True)
        cfg = config.load()
        cfg["speech"]["punct_enabled"] = False
        config.save(cfg)
        return {"ok": True, **speech.punct_status()}
    except Exception as e:
        return {"ok": False, "error": speech.err_log(e)}


@app.post("/api/speech/download")
async def download_model(model_id: str = Query(...)):
    known = [m["id"] for m in speech.list_whisper_models()] + [m["id"] for m in speech.SHERPA_MODELS]
    if model_id not in known:
        raise HTTPException(400, "未知模型")
    try:
        await speech.download_whisper(model_id)
        return {"ok": True, "path": speech.whisper_model_dir(model_id)}
    except Exception as e:
        raise HTTPException(500, f"下载失败：{speech.err_log(e)}")


# ---------------- AI 分析 / 报告 ----------------

class AIModelsReq(BaseModel):
    base_url: str
    api_key: str = ""


@app.post("/api/ai/models")
async def ai_models(req: AIModelsReq):
    """代理拉取 OpenAI 兼容服务的模型列表（浏览器直连会被 CORS 拦截）"""
    from openai import OpenAI
    try:
        client = OpenAI(base_url=req.base_url, api_key=req.api_key or "EMPTY", timeout=20)
        models = await asyncio.get_running_loop().run_in_executor(None, lambda: client.models.list())
        return {"models": sorted(m.id for m in models.data)}
    except Exception as e:
        raise HTTPException(502, f"无法获取模型列表：{e}")


class IncrementalReq(BaseModel):
    topic: str
    sentence: str
    context: str = ""


@app.post("/api/analyze/incremental")
async def analyze_incremental(req: IncrementalReq):
    """讲的过程中逐句点评（实时教练）"""
    try:
        return await asyncio.get_running_loop().run_in_executor(
            None, analyzer.analyze_incremental, req.topic, req.sentence, req.context)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"AI 调用失败：{speech.err_log(e)}")


class HintReq(BaseModel):
    topic: str = ""
    recent: str = ""
    hints: list = []
    manual: bool = False
    notes: str = ""


@app.post("/api/analyze/hint")
async def analyze_hint(req: HintReq):
    """开讲过程中的表达提示。

    自动触发：一句 ≤15 字的当场提醒（跑题/缺例子/结构/方向）。
    manual=True（点了「提示」）：结合备稿要点与命题，给 ≤coach.max_chars 字的具体内容建议。
    """
    try:
        return await asyncio.get_running_loop().run_in_executor(
            None, analyzer.analyze_hint, req.topic, req.recent, req.hints, req.manual, req.notes)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"AI 调用失败：{speech.err_log(e)}")


class SentenceReq(BaseModel):
    topic: str
    transcript: str


@app.post("/api/analyze/sentences")
async def analyze_sentences(req: SentenceReq):
    try:
        result = await asyncio.get_running_loop().run_in_executor(
            None, analyzer.analyze_sentences, req.topic, req.transcript)
        return result
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"AI 调用失败：{speech.err_log(e)}")


class ReportReq(BaseModel):
    entry_id: str
    topic: str
    score: int
    peek: int
    duration_sec: int
    stats: dict
    habits: list
    analysis: dict


@app.post("/api/report")
async def gen_report(req: ReportReq):
    cfg = config.load()["training"]
    try:
        md = await asyncio.get_running_loop().run_in_executor(
            None, lambda: analyzer.generate_report(
                req.topic, req.score, req.peek, req.duration_sec,
                req.stats, req.habits, req.analysis,
                cfg["peek_penalty"]))
        history.save_report(req.entry_id, md)
        return {"id": req.entry_id, "markdown": md}
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"AI 调用失败：{speech.err_log(e)}")


@app.get("/api/report/{entry_id}")
def get_report(entry_id: str):
    md = history.get_report(entry_id)
    if md is None:
        raise HTTPException(404, "报告不存在")
    return {"id": entry_id, "markdown": md}


# ---------------- 历史 ----------------

class HistoryEntry(BaseModel):
    topic: str
    cat: str = ""
    score: int
    forget: int = 0
    peek: int = 0
    dur: int = 0
    transcript: str = ""
    stats: dict = {}
    analysis: dict = {}


@app.post("/api/history")
def add_history(entry: HistoryEntry):
    keep = config.load().get("ui", {}).get("history_keep", 200)
    return history.add(entry.model_dump(), keep)


@app.get("/api/history")
def get_history(limit: int | None = None):
    return history.list_all(limit)


@app.delete("/api/history/{entry_id}")
def del_history(entry_id: str):
    if not history.delete(entry_id):
        raise HTTPException(404, "记录不存在")
    return {"ok": True}


@app.post("/api/history/clear-all")
def clear_all():
    history.clear_all_data()
    return {"ok": True}


# ---------------- WebSocket 实时转写 ----------------

@app.websocket("/ws/speech")
async def ws_speech(ws: WebSocket):
    """协议：
    客户端 → {"type":"start","engine":"whisper","model":"small"} 后跟二进制 PCM16 帧
    服务端 → {"type":"partial","text":...}  正在说的一句的预览（会被随后的 final 覆盖）
             {"type":"final","text":...}    已说完的一句（定稿，入库/统计/点评）
             {"type":"error","message":...}
    客户端 → {"type":"stop"} 结束
    """
    await ws.accept()
    engine, model_id = "none", ""
    pcm_buffer = bytearray()
    model = None
    sp_cfg = config.load()["speech"]
    silence_ms = int(sp_cfg.get("silence_ms", 700))
    min_speech_ms = int(sp_cfg.get("min_speech_ms", 300))
    chunk_ms = int(sp_cfg.get("chunk_ms", 2500))
    partial_ms = int(sp_cfg.get("partial_ms", 500))
    max_utter_sec = float(sp_cfg.get("max_utter_sec", 20))
    punct_on = bool(sp_cfg.get("punct_enabled", False))
    # 离线路径的长句兜底：不能比"断句等待"还短，否则 silence_ms 设再大也会被 chunk 抢先切走。
    # 上限交给 max_utter_sec，保证和流式端点规则保持一致。
    max_seg_ms = min(max(chunk_ms, silence_ms * 2), int(max_utter_sec * 1000))
    loop = asyncio.get_running_loop()
    st = {"busy": False, "last": 0.0, "prev": "", "ver": 0}  # ver=定稿序号，用于丢弃过期预览
    bg = set()
    session = None          # 流式引擎的一路会话（zipformer）

    async def send_json(obj):
        try:
            await ws.send_text(json.dumps(obj, ensure_ascii=False))
        except Exception:
            pass

    def _run(fn, *args):
        return loop.run_in_executor(None, fn, *args)

    async def emit_final(text: str):
        """定稿输出：补句末标点（流式模型不带标点），发 final"""
        text = speech.sane_text(text)
        if not text:
            return
        if punct_on:
            # 标点恢复模型：把逗号/问号也补出来，比无脑补句号自然
            try:
                text = await _run(speech.add_punctuation, text)
            except Exception:
                pass
        if text[-1] not in "。！？；!?;…":
            text += "。"          # 流式模型不输出标点，补一个方便按句切分与点评
        st["prev"] = text
        st["ver"] += 1
        await send_json({"type": "final", "text": text, "v": st["ver"]})

    async def do_final(seg_pcm: bytes):
        """已说完的一句：整段转写后定稿"""
        try:
            if engine == "whisper":
                text = await _run(speech.transcribe_pcm, model, seg_pcm, 16000, st["prev"], True)
            else:
                text = await _run(speech.transcribe_sherpa, model, seg_pcm)
            await emit_final(text)
        except Exception as ex:
            await send_json({"type": "error", "message": str(ex)})

    async def do_partial(snapshot: bytes, ver: int):
        """正在说的一句：先转一版给用户看，定稿时前端整体覆盖（不入库）"""
        st["busy"] = True
        try:
            if engine == "whisper":
                text = await _run(speech.transcribe_pcm, model, snapshot, 16000, "", False)
            else:
                text = await _run(speech.transcribe_sherpa, model, snapshot)
            text = speech.sane_text(text)
            if text and ver >= st["ver"]:      # 定稿已经推进了就别再发过期预览
                await send_json({"type": "partial", "text": text, "v": ver})
        except Exception:
            pass
        finally:
            st["busy"] = False

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            if msg.get("text"):
                try:
                    ctrl = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue

                if ctrl.get("type") == "start":
                    if engine != "none":
                        continue  # 幂等：同一连接重复 start 忽略，防止双重转写
                    engine = ctrl.get("engine", "none")
                    model_id = ctrl.get("model", "")
                    if engine in ("whisper", "sherpa"):
                        try:
                            if not speech.is_model_downloaded(model_id):
                                await send_json({"type": "error", "message": f"模型 {model_id} 未下载"})
                                engine = "none"
                            else:
                                loader = speech.load_whisper if engine == "whisper" else speech.load_sherpa
                                if engine == "sherpa":
                                    model = await asyncio.get_running_loop().run_in_executor(
                                        None, loader, model_id, silence_ms, max_utter_sec)
                                    if speech.is_streaming_model(model_id):
                                        session = speech.StreamingSession(model)
                                        # 预热首帧推理：跟模型加载一样必须赶在用户开口之前，
                                        # 否则第一句要整句说完才出字
                                        await asyncio.get_running_loop().run_in_executor(
                                            None, session.warmup)
                                else:
                                    model = await asyncio.get_running_loop().run_in_executor(
                                        None, loader, model_id)
                                await send_json({"type": "ready"})
                        except Exception as e:
                            engine = "none"
                            await send_json({"type": "error", "message": f"模型加载失败：{e}"})
                    else:
                        await send_json({"type": "ready"})

                elif ctrl.get("type") == "flush":
                    # 前端结束汇报前调用：把还在缓冲区里的半句定稿
                    if session is not None:
                        await emit_final(session.flush())
                    elif engine in ("whisper", "sherpa") and model is not None and pcm_buffer:
                        seg = bytes(pcm_buffer)
                        pcm_buffer.clear()
                        await do_final(seg)

                elif ctrl.get("type") == "stop":
                    break

            elif msg.get("bytes"):
                data = msg["bytes"]
                if engine not in ("whisper", "sherpa") or model is None:
                    continue
                # 流式引擎：每来一帧就增量解码，逐字往外冒
                if session is not None:
                    try:
                        text, ended = await _run(session.feed, data)
                        if text:
                            await send_json({"type": "partial", "text": text, "v": st["ver"]})
                        if ended:
                            await emit_final(ended)
                    except Exception as ex:
                        await send_json({"type": "error", "message": str(ex)})
                    continue
                pcm_buffer.extend(data)

                # 1) 已说完的片段 → 立刻定稿
                segs, remain = speech.vad_cut(bytes(pcm_buffer), silence_ms, min_speech_ms)
                pcm_buffer = bytearray(remain)
                # 长句兜底：连续说太久也强制定一次，避免一直不定稿
                if not segs and len(pcm_buffer) >= int(32000 * max_seg_ms / 1000):
                    segs = [bytes(pcm_buffer)]
                    pcm_buffer.clear()
                for seg_pcm in segs:
                    await do_final(seg_pcm)

                # 2) 正在说的这段 → 每隔 partial_ms 转一版"预览"，实现边说边出字
                if (partial_ms > 0 and pcm_buffer and not st["busy"]
                        and len(pcm_buffer) >= 11000):            # 至少 0.35s 有声
                    now = loop.time()
                    if now - st["last"] >= partial_ms / 1000.0:
                        st["last"] = now
                        t = asyncio.create_task(do_partial(bytes(pcm_buffer), st["ver"]))
                        bg.add(t)
                        t.add_done_callback(bg.discard)

        # 收尾：剩余 buffer / 未到端点的半句定稿
        if session is not None:
            await emit_final(session.flush())
        elif engine in ("whisper", "sherpa") and model is not None and pcm_buffer:
            await do_final(bytes(pcm_buffer))
            pcm_buffer.clear()
    except WebSocketDisconnect:
        pass
    finally:
        for t in list(bg):
            t.cancel()
        try:
            await ws.close()
        except Exception:
            pass


# ---------------- 静态前端（最后挂载） ----------------

import pathlib
FRONTEND_DIR = pathlib.Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
