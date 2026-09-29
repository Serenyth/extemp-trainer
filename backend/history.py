"""训练历史：data/history.json（列表）+ data/reports/*.md"""
import json
import pathlib
import time

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "data"
HISTORY_PATH = DATA / "history.json"
REPORTS_DIR = DATA / "reports"


def _read_all() -> list:
    if not HISTORY_PATH.exists():
        return []
    try:
        with open(HISTORY_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write_all(items: list):
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = HISTORY_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    tmp.replace(HISTORY_PATH)


def add(entry: dict, keep: int = 500) -> dict:
    entry.setdefault("id", f"{int(time.time()*1000)}")
    entry.setdefault("date", time.strftime("%Y-%m-%dT%H:%M:%S"))
    items = _read_all()
    items.insert(0, entry)
    # 报告是按 id 单独存 md 的，被截掉的那条的报告文件也一并清掉，免得越攒越多
    for dropped in items[max(0, int(keep) or 500):]:
        p = REPORTS_DIR / f"{dropped.get('id')}.md"
        if p.exists():
            try: p.unlink()
            except OSError: pass
    _write_all(items[:max(1, int(keep) or 500)])
    return entry


def list_all(limit: int | None = None) -> list:
    items = _read_all()
    return items[:limit] if limit else items


def delete(entry_id: str) -> bool:
    items = _read_all()
    kept = [i for i in items if i.get("id") != entry_id]
    if len(kept) == len(items):
        return False
    _write_all(kept)
    return True


def clear():
    _write_all([])


def clear_all_data():
    """一键清空：历史 + 报告（不动配置/题库/词表）"""
    clear()
    if REPORTS_DIR.exists():
        for p in REPORTS_DIR.glob("*.md"):
            p.unlink(missing_ok=True)


# ---------------- 报告文件 ----------------

def save_report(entry_id: str, markdown: str) -> str:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORTS_DIR / f"{entry_id}.md"
    with open(path, "w", encoding="utf-8") as f:
        f.write(markdown)
    return entry_id


def get_report(entry_id: str) -> str | None:
    path = REPORTS_DIR / f"{entry_id}.md"
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()
