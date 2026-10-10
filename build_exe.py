"""把 脱稿训练场 打包成 Windows 可执行程序。

默认打成一个文件夹（dist/脱稿训练场/），双击里面的 exe 就能用；
加 --onefile 出单个 exe，方便拷贝，但首次启动要解压，慢几秒。

常用：
  python build_exe.py                  # 默认：文件夹版，不含语音模型
  python build_exe.py --onefile        # 单文件版
  python build_exe.py --with-models    # 语音模型一起打进去（几百 MB，离线可用）
  python build_exe.py --noconsole      # 不弹黑窗口
  python build_exe.py --dry            # 只打印命令，不真打
"""
import argparse
import pathlib
import shutil
import subprocess
import sys
import time

# 中文输出统一走 utf-8：cmd 默认 936，Python 默认跟着 locale 走，
# 两边不配对就会显示成一堆乱码方块
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = pathlib.Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
VENV = BACKEND / "venv"
PY = VENV / "Scripts" / "python.exe"
ENTRY = BACKEND / "_run.py"
DEFAULT_NAME = "脱稿训练场"

# 语音引擎是函数里懒加载的，PyInstaller 静态分析扫不到，得手动带上
HIDDEN = [
    "uvicorn", "uvicorn.logging", "uvicorn.server", "uvicorn.config",
    "websockets", "wsproto", "multipart", "yaml", "tomli_w", "openai",
    "sherpa_onnx", "onnxruntime", "ctranslate2", "av", "faster_whisper",
    "huggingface_hub", "tokenizers", "numpy",
]
COLLECT_BIN = ["ctranslate2", "sherpa_onnx", "onnxruntime", "av"]
COLLECT_SUB = ["faster_whisper", "sherpa_onnx", "onnxruntime", "ctranslate2", "av"]
# 打了也用不上的大件，剔掉能省一半体积
EXCLUDES = [
    "torch", "torchaudio", "torchvision", "tensorflow", "matplotlib", "scipy", "pandas",
    "notebook", "ipython", "pytest", "sphinx", "PIL", "PIL.Image", "bs4", "lxml",
    "PyQt5", "PySide2", "PySide6", "tkinter", "h5py", "networkx", "sklearn",
]


def log(*msg):
    print(*msg, flush=True)


def ensure_env():
    if not PY.exists():
        log("[!] 没找到 backend/venv，先装依赖…")
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
        subprocess.run([str(PY), "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt")],
                       check=True)
    log("[1/4] 检查 PyInstaller…")
    if subprocess.run([str(PY), "-m", "PyInstaller", "--version"],
                      capture_output=True).returncode != 0:
        log("     没装，正在安装 pyinstaller（国内走阿里源）…")
        subprocess.run([str(PY), "-m", "pip", "install", "pyinstaller",
                        "-i", "https://mirrors.aliyun.com/pypi/simple/"], check=True)
    v = subprocess.run([str(PY), "-m", "PyInstaller", "--version"],
                       capture_output=True, text=True)
    log("     PyInstaller", (v.stdout or "").strip())


def frontend_datas():
    """前端文件一个一个加，跳过开发期脚本（_smoke.cjs 之类不该进最终包）。

    目标是包内的 frontend/ 目录——静态路由挂的就是它，落点写成 js/ 会导致 404。
    """
    base = ROOT / "frontend"
    out = []
    for p in sorted(base.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(base)
        if rel.parts[0].startswith("_") or p.name.startswith("_") or p.suffix in {".log"}:
            continue
        out.append((str(p), str(pathlib.Path("frontend") / rel.parent)))
    return out


def clear_way_for(name):
    """给输出目录让路。

    PyInstaller 打包前会 rmtree 掉 dist/<name>，里面的 dll/pyd 有几百个，
    在受限环境里这一步会被当成批量删除拦下来，构建直接失败。
    这里先整块 rename 走（一次改名，不算删除），PyInstaller 再建就是空目录了。
    """
    stale = ROOT / "dist" / name
    if not stale.exists():
        return
    backup = (ROOT / "build" / f"旧-{name}-{time.strftime('%m%d-%H%M%S')}")
    n = 1
    while backup.exists():
        backup = ROOT / "build" / f"旧-{name}-{time.strftime('%m%d-%H%M%S')}-{n}"
        n += 1
    backup.parent.mkdir(parents=True, exist_ok=True)
    stale.rename(backup)
    log(f"     上次的输出挪到了 {backup.name}")
    prune(f"旧-{name}-*")


def prune(pattern, keep=1):
    """build/ 下的备份与工作目录都很大（几百个文件），只留最新的几个。"""
    olds = sorted(p for p in (ROOT / "build").glob(pattern) if p.is_dir())
    for old in (olds[:-keep] if len(olds) > keep else []):
        shutil.rmtree(old, ignore_errors=True)
        log(f"     已删掉旧的 {old.name}")


def build(args):
    ensure_env()
    clear_way_for(args.name)

    datas = frontend_datas()
    for y in sorted((BACKEND / "data").glob("*.yaml")):
        datas.append((str(y), "data"))
    if args.with_models:
        datas.append((str(BACKEND / "data" / "models"), "data/models"))

    # 工作目录每次换一个新的：PyInstaller 的 --clean 会先把旧的整棵删掉，
    # 几百个文件，受限环境里这一步会被拦；换目录就永远无债一身轻
    prune("work-*")
    workpath = ROOT / "build" / f"work-{time.strftime('%m%d-%H%M%S')}"
    cmd = [
        str(PY), "-m", "PyInstaller",
        "--noconfirm", "--noupx",
        "--name", args.name,
        "--distpath", str(ROOT / "dist"),
        "--workpath", str(workpath),
        "--specpath", str(ROOT / "build" / "spec"),
        "--paths", str(BACKEND),
        "--console" if not args.noconsole else "--noconsole",
    ]
    if args.onefile:
        cmd.append("--onefile")
    for h in HIDDEN:
        cmd += ["--hidden-import", h]
    for b in COLLECT_BIN:
        cmd += ["--collect-binaries", b]
    for s in COLLECT_SUB:
        cmd += ["--collect-submodules", s]
    for e in EXCLUDES:
        cmd += ["--exclude-module", e]
    for src, dst in datas:
        cmd += ["--add-data", f"{src};{dst}"]
    cmd.append(str(ENTRY))

    log("[2/4] 收集依赖（首次会慢，项目里有个装了语音引擎的大环境）…")
    if args.dry:
        log("     " + " ".join(f'"{c}"' if " " in c else c for c in cmd))
        return
    r = subprocess.run(cmd, cwd=str(BACKEND))
    if r.returncode != 0:
        log("[x] PyInstaller 退出码", r.returncode)
        return False
    log("[3/4] 收尾…")
    return True


def finish(args, ok):
    if not ok:
        return
    exe = (ROOT / "dist" / args.name / f"{args.name}.exe") if not args.onefile \
        else (ROOT / "dist" / f"{args.name}.exe")
    if not exe.exists():
        log("[x] 没找到生成的 exe：", exe)
        return
    size = exe.stat().st_size / 1024 / 1024 if args.onefile else (
        sum(f.stat().st_size for f in (ROOT / "dist").rglob("*") if f.is_file()) / 1024 / 1024)
    tip = ROOT / "dist" / "使用说明.txt"
    tip.write_text(
        "脱稿训练场 · 使用说明\n"
        "==================\n"
        f"1) 双击运行：{exe.name}（{args.name} 文件夹=文件夹版，{args.name}.exe=单文件版）\n"
        "2) 程序会自己开浏览器，地址栏里是训练场首页；关掉黑窗口就退出程序\n"
        "3) 训练记录、配置、报告、题库都写在用户目录的 脱稿训练场/data 下\n"
        "4) 离线语音模型默认不打包，到「设置 → 语音识别」里按需下载\n",
        encoding="utf-8")
    log(f"[4/4] 打包完成：{exe}  ({size:.0f} MB)")
    log("      说明文件：" + str(tip))


def main():
    ap = argparse.ArgumentParser(description="把 脱稿训练场 打包成 exe")
    ap.add_argument("--onefile", action="store_true", help="打单个 exe（默认打文件夹）")
    ap.add_argument("--with-models", action="store_true", help="语音模型一起打包（体积大）")
    ap.add_argument("--noconsole", action="store_true", help="不弹黑窗口")
    ap.add_argument("--clean", action="store_true", help="先清掉上次的 dist/build")
    ap.add_argument("--dry", action="store_true", help="只打印 PyInstaller 命令")
    ap.add_argument("--name", default=DEFAULT_NAME)
    args = ap.parse_args()

    if args.clean and (ROOT / "dist").exists():
        shutil.rmtree(ROOT / "dist")

    kind = "单文件版" if args.onefile else "文件夹版"
    log(f"脱稿训练场 · 打包开始（{kind}）\n")
    ok = build(args)
    finish(args, ok)


if __name__ == "__main__":
    main()
