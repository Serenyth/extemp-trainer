# 脱稿训练场 · extemp-trainer

一个**本地部署的即席演讲 / 脱稿表达训练器**：随机抽题 → 限时备稿 → 对着麦克风脱稿开讲，本地语音模型实时转写字幕，AI 演讲教练逐句点评，结束后自动统计口头禅与语速，并生成一份可留存的 Markdown 训练报告。

- 🔒 **隐私优先**：语音只在内存中处理，不落盘、不上传；API Key 只存在本机配置文件
- 🖥️ **纯本地运行**：FastAPI 单体服务 + 原生单页前端，无需数据库、无需 Node 构建
- 🎙️ **多语音引擎**：浏览器转写 / faster-Whisper / sherpa-onnx（9 款中文模型，流式边说边出字）
- 🤖 **兼容任意 OpenAI 协议大模型**：DeepSeek、通义、Kimi、OpenAI 等填个地址就能用

---

## 目录

- [功能特性](#功能特性)
- [训练流程](#训练流程)
- [快速开始](#快速开始)
- [语音引擎与模型](#语音引擎与模型)
- [AI 教练配置](#ai-教练配置)
- [项目结构](#项目结构)
- [HTTP / WebSocket 接口](#http--websocket-接口)
- [配置文件说明](#配置文件说明)
- [数据目录与隐私](#数据目录与隐私)
- [技术栈](#技术栈)
- [常见问题](#常见问题)

---

## 功能特性

| 模块 | 说明 |
|---|---|
| 题库系统 | 内置观点思辨 / 职场汇报 / 生活叙事 / 知识讲解 / 认知思维 / 心理洞察 6 大类约 90 道命题；支持增删改、YAML 导入（合并 / 替换）与导出 |
| 限时备稿 | 多档备稿时长（1/5/10/20/30 分钟），时间到自动进入开讲倒计时，也可随时手动开始 |
| 实时转写 | WebSocket 推送 PCM 音频，VAD 自动断句，流式模型逐字出字幕；支持暂停 / 继续（暂停期间不计时长与语速） |
| 脱稿计分 | 基础分 100，「忘词」「看稿」一键记录并扣分；看稿以"纸条"形式限时展示，模拟真实脱稿压力 |
| 词汇统计 | 填充词 / 犹豫词 / 笼统词三类自定义词表，统计次数、每分钟频次、高频口头禅 Top3、语速、平均句长，结算页逐词高亮 |
| 实时教练 | 讲述过程中每出一句定稿，AI 立即针对该句给问题与改法（可配置每几句点评一次以节省 token） |
| 赛后复盘 | AI 对全文逐句分析（重复、削弱表达、结构、跑题），挑出最好 / 最差句子，生成 400–600 字 Markdown 报告并本地存档 |
| 历史记录 | 全部训练记录保存在本机，可回看任意一场的字稿、统计与报告，支持单条删除与一键清空 |
| 界面定制 | 三套预设主题（carbon 深色 / paper 纸白 / forest 墨绿）+ 自定义配色，字幕与教练字号可调 |

## 训练流程

```
抽题（分类/随机/自拟命题）
   │
   ▼
限时备稿 ──► 开讲准备倒计时（可跳过）
   │
   ▼
脱稿汇报 ── 麦克风 → WebSocket → 本地 ASR → 实时字幕
   │           ├─ 忘词 / 看稿 计数扣分
   │           ├─ AI 逐句即时点评
   │           └─ 暂停 / 继续
   ▼
结算复盘 ── 词汇画像 + 逐句分析 + AI Markdown 报告 → 存入历史
```

## 快速开始

### 环境要求

- **Python 3.11+**（代码使用标准库 `tomllib`）
- Windows / macOS / Linux（启动脚本为 Windows `.bat`，其他系统见下方手动命令）
- 可选：Chrome / Edge 浏览器（使用「浏览器转写」引擎时需要 Web Speech API 支持）

### 1. 安装依赖

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/
# macOS / Linux
# venv/bin/pip install -r requirements.txt
```

依赖中已包含 `sherpa-onnx` 中文语音引擎与 `faster-whisper`；语音模型本体不随仓库分发，启动后在应用内按需下载。

### 2. 启动服务

**Windows**：直接双击项目根目录的 `启动.bat`，脚本会自动检测虚拟环境、检查 8642 端口占用并打开浏览器。

**手动启动（全平台）**：

```bash
# 在项目根目录
python -m uvicorn main:app --host 0.0.0.0 --port 8642 --app-dir backend
```

然后浏览器打开 **http://localhost:8642** 。

> 首次打开会在 `backend/data/` 下自动生成默认配置 `config.toml`、题库 `bank.yaml` 与词表 `words.yaml`。
> 语音模型不随仓库分发，需在应用内「设置 → 语音模型」中按需下载（详见下节）。

## 语音引擎与模型

在「设置 → 语音模型」中选择，四种引擎可随时切换：

| 引擎 | 中文效果 | 硬件 | 模型体积 | 实时性 | 说明 |
|---|---|---|---|---|---|
| 无（只计分） | — | 无 | 无 | — | 不转写，仅计分与录音回放 |
| 浏览器转写 | 一般，因浏览器而异 | 无 | 无需下载 | 真实时 | 走 Web Speech API，Chrome/Edge 中文尚可 |
| Whisper 本地 | small 尚可，large 好 | small+ 建议 GPU | 75 MB – 3 GB | 延迟 1–3 秒 | faster-whisper，tiny/base/small/medium/large-v3 |
| **sherpa-onnx** | **中文最优** | CPU 可跑 | 30 MB – 1.6 GB | 流式逐字 / 离线整段 | 中文模型池，推荐首选 |

sherpa-onnx 模型池（均在应用内一键下载，支持断点续传）：

- **流式（边说边出字）**：双语 Zipformer（中英夹杂推荐，190 MB）、2025 纯中文新版（160 MB）、xlarge 高精度版（736 MB）、14M 低配极速版（30 MB）等
- **离线（整段转写）**：SenseVoice（230 MB，自带标点）、Paraformer（232 MB，快而准）、FireRedASR（1.6 GB，公开中文基准 CER 最低，适合赛后精转）
- **标点恢复（可选）**：CT-Transformer（281 MB），为流式模型的输出补逗号、问号，而非每句无脑加句号

下载源默认走国内镜像 `https://hf-mirror.com` 并禁用 Xet 协议（见 [speech.py](backend/speech.py) 开头的环境变量设置），无需额外网络配置。

**断句调节**：设置中的「断句等待」控制静音多久算一句话说完；「最长一句」控制连续说话不被打断的上限（到点强制断句，不看停顿）。

## AI 教练配置

实时点评与赛后报告为可选项，不配置也能完成转写、计分与词汇统计。

在「设置 → AI」中填写任意 **OpenAI 兼容接口**：

| 配置项 | 示例值 |
|---|---|
| Base URL | `https://api.deepseek.com`（也支持通义 / Kimi / 本地 Ollama 等兼容地址） |
| API Key | 你的密钥，仅写入本机 `backend/data/config.toml` |
| Model | 如 `deepseek-flash`；接口支持时可在界面直接拉取模型列表选择 |

「实时教练」分区还可自定义逐句点评的提示词模板（支持 `{topic}` `{context}` `{sentence}` 占位符，留空使用内置教练词）、点评频率与最短送评句长。

## 项目结构

```
extemp-trainer/
├── 启动.bat                # Windows 一键启动（检测 venv / 端口 / 自动开浏览器）
├── frontend/
│   └── index.html          # 整个前端：原生 HTML/CSS/JS 单文件，无需构建
└── backend/
    ├── main.py             # FastAPI：REST 接口 + /ws/speech 音频流 + 静态前端托管
    ├── speech.py           # 语音引擎：faster-whisper / sherpa-onnx 封装、VAD、模型下载
    ├── analyzer.py         # AI 教练：实时逐句点评、全文分析、Markdown 报告（OpenAI 协议）
    ├── counter.py          # 词汇统计：三类词标记、频次、口头禅、语速句长
    ├── bank.py             # 题库：YAML 读写、校验、导入（merge/replace）、导出
    ├── config.py           # 配置：TOML 读写 + 全部默认值 + 主题预设
    ├── history.py          # 历史：history.json 原子写入 + reports/*.md
    ├── requirements.txt
    └── data/               # 运行时生成（已在 .gitignore 中）
        ├── config.toml     # 用户配置（含 API Key，勿提交）
        ├── bank.yaml       # 题库
        ├── words.yaml      # 词表
        ├── history.json    # 训练历史（最多保留 500 条）
        ├── models/         # 语音模型缓存（体积大，应用内按需下载）
        └── reports/        # 历次 AI 报告（Markdown）
```

**运行架构**：

```
浏览器 SPA (index.html)
   │  WebSocket /ws/speech：PCM16 音频上行，partial/final 字幕下行
   │  REST /api/*：配置、题库、词表、分析、报告、历史
   ▼
FastAPI (localhost:8642)
   ├── 线程池执行阻塞推理，不堵事件循环
   ├── 能量 VAD 增量切段 + sherpa 端点检测（rule1/2/3）
   └── 音频全程仅存内存缓冲，退出即释放
```

## HTTP / WebSocket 接口

| 方法 | 路径 | 功能 |
|---|---|---|
| GET / PUT | `/api/config` | 读取 / 保存全部配置 |
| GET | `/api/theme/resolve` | 解析当前主题色值 |
| GET / PUT | `/api/bank` | 题库读写 |
| GET / POST | `/api/bank/export`、`/api/bank/import?mode=merge\|replace` | 题库导入导出 |
| GET / PUT | `/api/words` | 词表读写 |
| POST | `/api/analyze/words` | 本地词汇统计 |
| GET / POST / DELETE | `/api/speech/models`、`/api/speech/download`、`/api/speech/model` | 模型状态 / 下载 / 删除 |
| GET / POST / DELETE | `/api/speech/punct` | 标点恢复模型管理 |
| POST | `/api/ai/models` | 代理拉取 OpenAI 兼容服务的模型列表（绕过浏览器 CORS） |
| POST | `/api/analyze/incremental` | 实时逐句点评 |
| POST | `/api/analyze/sentences` | 赛后全文逐句分析 |
| POST / GET | `/api/report`、`/api/report/{id}` | 生成 / 读取 Markdown 报告 |
| GET / POST / DELETE | `/api/history`、`/api/history/{id}`、`/api/history/clear-all` | 训练历史管理 |
| WebSocket | `/ws/speech` | 实时语音流转写 |

WebSocket 协议要点：客户端发 `{"type":"start","engine":"sherpa","model":"streaming-zipformer-zh"}` 后推送二进制 PCM16/16kHz 单声道帧；服务端回 `ready` / `{"type":"partial"}` 预览 / `{"type":"final"}` 定稿 / `error`；`flush` 强制半句定稿，`stop` 结束。

## 配置文件说明

`backend/data/config.toml` 首次运行自动生成，主要分区：

| 分区 | 关键项 |
|---|---|
| `[theme]` | `preset`: carbon / paper / forest / custom |
| `[ai]` | `base_url`、`api_key`、`model`、`timeout` |
| `[speech]` | `engine`、`model`、`silence_ms`（断句等待）、`max_utter_sec`（最长一句）、`punct_enabled` |
| `[coach]` | `prompt`（自定义点评模板）、`every`（每几句点评）、`min_chars` |
| `[training]` | `base_score`、`forget_penalty`、`peek_penalty`、`prep_durations`、`filler_threshold`、倒计时与看稿时长 |
| `[display]` | `subtitle_size`、`coach_size`、`sentence_newline`、`show_punct` |

所有配置也可在应用内设置面板可视化修改，一般无需手工编辑。

## 数据目录与隐私

- **音频**：麦克风数据经浏览器编码为 PCM 后通过本机 WebSocket 传输，只在后端内存缓冲中做 VAD 与推理，**任何时候都不写磁盘、不转发第三方**
- **API Key**：仅保存在本机 `data/config.toml`；请求直接从你的电脑发往所配置的模型厂商
- **语音模型**：缓存于 `data/models/`，体积可达数 GB，已通过 `.gitignore` 排除，删除后可随时在应用内重新下载
- **题库 / 词表 / 历史 / 报告**：均为本地 YAML / JSON / Markdown 纯文本，可直接备份或编辑

## 技术栈

- **后端**：Python 3.11+、FastAPI、Uvicorn、WebSockets
- **语音**：sherpa-onnx（ONNX Runtime）、faster-whisper（CTranslate2）、NumPy 能量 VAD、HuggingFace Hub（国内镜像）
- **AI**：OpenAI Python SDK（兼容任意 OpenAI 协议服务）
- **前端**：原生 HTML / CSS / JavaScript 单文件，Web Audio API + Web Speech API
- **存储**：TOML（配置）、YAML（题库 / 词表）、JSON（历史）、Markdown（报告），零数据库

## 常见问题

**Q：打开页面后说话没有字幕？**
先在「设置 → 语音模型」确认引擎不是「无」，且所选模型状态为已下载（流式模型推荐 `streaming-zipformer-zh`）。浏览器地址栏需为 `localhost` 或 https 才会授予麦克风权限。

**Q：模型下载很慢或中断？**
下载默认走 `hf-mirror.com` 并支持断点续传，中断后重新点击下载即可续传；也可自行将模型文件放入 `backend/data/models/` 对应目录。

**Q：断句不符合说话习惯？**
有停顿却被频繁切开 → 调大「断句等待」；一直连贯说话也被加句号 → 调大「最长一句」（这是 rule3 强制断句在起作用，与停顿无关）。

**Q：sherpa 引擎报 `No module named 'sherpa_onnx'`？**
在虚拟环境中执行 `pip install -r requirements.txt` 补装后重启服务即可。

**Q：AI 点评不出现？**
检查「设置 → AI」中的 Base URL、API Key 与模型名是否正确；未配置 AI 时转写、计分和词汇统计仍可正常使用。
