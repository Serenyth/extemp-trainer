"""启动入口：起服务 → 开浏览器 → 优雅退出。

开发时等价于 `python _run.py`（比 uvicorn CLI 多一件自动开浏览器的事），
打包后是 exe 本体。数据目录、端口都在这里定。
"""
import os
import pathlib
import shutil
import socket
import sys
import threading
import time
import webbrowser

import paths
from paths import DATA, FRONTEND

PORT = 8642


def seed_resources():
    """exe 首次运行：把包里的预置 yaml / 语音模型落到数据目录。"""
    if not paths.FROZEN:
        return
    src = pathlib.Path(getattr(sys, "_MEIPASS", "")) / "data"
    if not src.exists():
        return
    DATA.mkdir(parents=True, exist_ok=True)
    for y in src.glob("*.yaml"):
        dst = DATA / y.name
        if not dst.exists():
            shutil.copy2(y, dst)
    models = src / "models"
    if models.exists():
        for one in models.iterdir():
            dst = DATA / "models" / one.name
            if not dst.exists():
                shutil.copytree(one, dst, dirs_exist_ok=True)


def pick_port(start=PORT, tries=30):
    for p in range(start, start + tries):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", p))
            return p
        except OSError:
            continue
        finally:
            s.close()
    raise RuntimeError(f"没有可用端口（{start} 起 {tries} 个都被占了）")


def open_when_ready(server, url):
    while not server.started and not server.should_exit:
        time.sleep(0.2)
    if server.started:
        time.sleep(0.4)
        print(f"已打开浏览器：{url}")
        webbrowser.open(url)


def main():
    seed_resources()
    DATA.mkdir(parents=True, exist_ok=True)
    port = pick_port()
    url = f"http://127.0.0.1:{port}/"

    print("=" * 46)
    print("  脱稿训练场")
    print("=" * 46)
    print(f"  本机访问：  {url}")
    print(f"  数据目录：  {DATA}")
    print("  关掉这个窗口 = 结束训练场")
    print("=" * 46)

    import uvicorn

    from main import app as fastapi_app

    cfg = uvicorn.Config(fastapi_app, host="127.0.0.1", port=port,
                         log_level="info", access_log=False)
    server = uvicorn.Server(cfg)
    threading.Thread(target=open_when_ready, args=(server, url), daemon=True).start()
    server.run()
    print("\n服务已退出。")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, BrokenPipeError):
        pass
