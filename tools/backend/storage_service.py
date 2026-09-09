# -*- coding: utf-8 -*-
"""
统一后端 - 本地持久化服务

  检查历史备份：SQLite（标准库 sqlite3，单文件 history.db，随 exe 存放）
  合规检查数据收集：JSONL 按月落盘（collect_data/collect_YYYYMM.jsonl）

零第三方依赖（开发文档 4.4.1 / 4.5.2）。
"""
from __future__ import annotations

import datetime
import json
import os
import sqlite3
import threading
import zipfile

from version_manager import _get_base_dir

_lock = threading.Lock()


def _db_path() -> str:
    return os.path.join(_get_base_dir(), "history.db")


def _collect_dir() -> str:
    d = os.path.join(_get_base_dir(), "collect_data")
    os.makedirs(d, exist_ok=True)
    return d


def _init_db(conn: sqlite3.Connection):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time TEXT,
            type TEXT,
            source TEXT,
            ext_version TEXT,
            project_json TEXT,
            rule_version TEXT,
            files_json TEXT,
            summary_json TEXT,
            detail_json TEXT,
            duration_sec REAL,
            created_at TEXT
        )
        """
    )


# ── 检查历史（SQLite 备份） ────────────────────────────────────

def history_sync(record: dict) -> dict:
    """插入一条检查记录（幂等不敏感：允许重复，按时间排序展示）"""
    if not isinstance(record, dict):
        return {"ok": False, "error": "记录格式错误"}
    with _lock:
        conn = sqlite3.connect(_db_path())
        try:
            _init_db(conn)
            conn.execute(
                "INSERT INTO checks (time, type, source, ext_version, project_json, rule_version,"
                " files_json, summary_json, detail_json, duration_sec, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    record.get("time") or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    record.get("type") or "",
                    record.get("source") or "",
                    str(record.get("extVersion") or ""),
                    json.dumps(record.get("project") or {}, ensure_ascii=False),
                    str(record.get("ruleVersion") or ""),
                    json.dumps(record.get("files") or [], ensure_ascii=False),
                    json.dumps(record.get("summary") or {}, ensure_ascii=False),
                    json.dumps(record.get("detail") or {}, ensure_ascii=False),
                    record.get("durationSec"),
                    datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                ),
            )
            conn.commit()
            row_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        finally:
            conn.close()
    return {"ok": True, "id": row_id}


def _row_to_record(row) -> dict:
    return {
        "id": row[0],
        "time": row[1],
        "type": row[2],
        "source": row[3],
        "extVersion": row[4],
        "project": json.loads(row[5] or "{}"),
        "ruleVersion": row[6],
        "files": json.loads(row[7] or "[]"),
        "summary": json.loads(row[8] or "{}"),
        "detail": json.loads(row[9] or "{}"),
        "durationSec": row[10],
    }


def history_list(filter_: dict | None = None) -> dict:
    filter_ = filter_ or {}
    sql = "SELECT id,time,type,source,ext_version,project_json,rule_version,files_json,summary_json,detail_json,duration_sec FROM checks"
    conds, params = [], []
    if filter_.get("type") and filter_["type"] != "__ALL__":
        conds.append("type = ?")
        params.append(filter_["type"])
    if filter_.get("source") and filter_["source"] != "__ALL__":
        conds.append("source = ?")
        params.append(filter_["source"])
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY time DESC LIMIT 500"
    with _lock:
        conn = sqlite3.connect(_db_path())
        try:
            _init_db(conn)
            rows = conn.execute(sql, params).fetchall()
        finally:
            conn.close()

    keyword = (filter_.get("keyword") or "").strip().lower()
    records = [_row_to_record(r) for r in rows]
    if keyword:
        def hit(r):
            hay = json.dumps(
                {
                    "p": (r.get("project") or {}).get("projname", ""),
                    "n": (r.get("project") or {}).get("projectno", ""),
                    "f": ",".join(f.get("name", "") for f in r.get("files", [])),
                },
                ensure_ascii=False,
            ).lower()
            return keyword in hay
        records = [r for r in records if hit(r)]
    return {"ok": True, "records": records}


def history_get(record_id: int) -> dict:
    with _lock:
        conn = sqlite3.connect(_db_path())
        try:
            _init_db(conn)
            row = conn.execute(
                "SELECT id,time,type,source,ext_version,project_json,rule_version,files_json,summary_json,detail_json,duration_sec"
                " FROM checks WHERE id = ?",
                (record_id,),
            ).fetchone()
        finally:
            conn.close()
    if not row:
        return {"ok": False, "error": "记录不存在"}
    return {"ok": True, "record": _row_to_record(row)}


def history_delete(record_id) -> dict:
    with _lock:
        conn = sqlite3.connect(_db_path())
        try:
            _init_db(conn)
            if record_id in ("__ALL__", None):
                conn.execute("DELETE FROM checks")
            else:
                conn.execute("DELETE FROM checks WHERE id = ?", (record_id,))
            conn.commit()
        finally:
            conn.close()
    return {"ok": True}


# ── 合规检查数据收集（JSONL 按月落盘） ─────────────────────────

def collect_append(payload: dict) -> dict:
    if not isinstance(payload, dict):
        return {"ok": False, "error": "报告格式错误"}
    month = datetime.datetime.now().strftime("%Y%m")
    path = os.path.join(_collect_dir(), f"collect_{month}.jsonl")
    line = json.dumps(payload, ensure_ascii=False)
    with _lock:
        count = 0
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        # 返回当前文件条数（轻量统计）
        with open(path, "r", encoding="utf-8") as f:
            for count, _ in enumerate(f, 1):
                pass
    print(f"[collect] 已落盘 {os.path.basename(path)}（第 {count} 条）")
    return {"ok": True, "file": os.path.basename(path), "count": count}


def collect_export(month: str | None) -> str | None:
    """打包指定月份（缺省全部）收集数据为 zip，返回文件路径"""
    d = _collect_dir()
    files = [f for f in os.listdir(d) if f.startswith("collect_") and f.endswith(".jsonl")]
    if month:
        files = [f for f in files if month in f]
    if not files:
        return None
    zip_path = os.path.join(d, f"collect_export_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(os.path.join(d, f), f)
    return zip_path
