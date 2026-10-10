"""路径定位。

exe 模式下代码在 _MEIPASS 临时目录里跑，__file__ 指不到项目目录，
所以路径统一从这里出：
  FRONTEND  只读，跟着 exe 走（前端页面）
  DATA      读写，默认落在用户目录，换台机器打开 exe 不会带走训练记录
  SEED      只读，预置 yaml 种子，首次运行由 _run.py 拷进 DATA
ENV 里的 EXTEMP_DATA_DIR / EXTEMP_FRONTEND 可覆盖，正常开发不用管。
"""
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
FROZEN = bool(getattr(sys, "frozen", False))
# 冻结态的资源都在 _MEIPASS 下（onedir 时是 exe 旁边的 _internal），
# 不能用 __file__ 推，那样会指到 exe 同级目录去
BUNDLE = pathlib.Path(getattr(sys, "_MEIPASS", "")) if FROZEN else ROOT

_DATA = os.environ.get("EXTEMP_DATA_DIR")
DATA = pathlib.Path(_DATA) if _DATA else (
    pathlib.Path(os.environ.get("APPDATA") or os.path.expanduser("~")) / "脱稿训练场" / "data"
    if FROZEN else ROOT / "data"
)

_FRONTEND = os.environ.get("EXTEMP_FRONTEND")
if _FRONTEND:
    FRONTEND = pathlib.Path(_FRONTEND)
else:
    in_bundle = BUNDLE / "frontend"
    FRONTEND = in_bundle if in_bundle.exists() else ROOT.parent / "frontend"
