# -*- coding: utf-8 -*-
"""
文档解析引擎抽象（统一后端）

    extract(path) -> {
        "engine":     "wps_com" | "pyparser",
        "headings":   [[level, text], ...],
        "fulltext":   "...",
        "header_text": "...",
        "toc":        {"entries": [...], "heading_pages": {...}, "heading_count": {...}},
        "sections":   {"3.4": {"title": "...", "content": "..."}, ...}   # 尽力而为
    }

两个实现：
  - wps_com_engine  Windows + WPS（生产）：大纲级别 / 页码 / 页眉 / Excel COM
  - pyparser_engine 跨平台（macOS 开发）：python-docx → olefile → ZIP/XML 三级降级（parser.py）

启动时通过 detect_engine() 探测，结果由 /health 上报，前端据此显示引擎徽标与降级提示。
"""
from __future__ import annotations

import os
import sys
import time

ENGINE_WPS_COM = "wps_com"
ENGINE_PYPARSER = "pyparser"

_engine_cache = None


def _log(msg: str) -> None:
    print(f"[doc_engine] {msg}", flush=True)


def detect_engine() -> str:
    """探测可用引擎：Windows + win32com + WPS → wps_com，否则 pyparser（探测结果记日志）"""
    global _engine_cache
    if _engine_cache:
        return _engine_cache
    engine = ENGINE_PYPARSER
    if sys.platform != "win32":
        reason = f"非 Windows 平台（{sys.platform}）"
    else:
        try:
            import win32com.client  # noqa: F401
            engine = ENGINE_WPS_COM
            reason = "win32com 可用，优先 WinCom（WPS COM）"
        except Exception as e:
            reason = f"win32com 不可用（{e}）"
    _engine_cache = engine
    _log(f"引擎探测：{engine}（{reason}）")
    return engine


# ─────────────────────────────────────────────────────────────
#  WPS COM 实现（与 check_docs.py 同源的提取逻辑）
# ─────────────────────────────────────────────────────────────

def _extract_with_wps_com(path: str) -> dict:
    import check_docs as C

    app = C._get_app()
    try:
        doc = app.Documents.Open(os.path.abspath(path))
        try:
            headings, fulltext, header_text = C.extract_doc(doc)
            toc_info = C.extract_toc_pages(doc)
        finally:
            doc.Close(False)
    finally:
        app.Quit()

    # 章节正文切片（复用 parser 的正文组织方式：按标题行切分全文）
    sections = _slice_sections(fulltext, headings)

    return {
        "engine": ENGINE_WPS_COM,
        "headings": [[lv, t] for lv, t in headings],
        "fulltext": fulltext,
        "header_text": header_text,
        "toc": {
            "entries": [[t, p] for t, p in toc_info.get("entries", [])],
            "heading_pages": toc_info.get("heading_pages", {}),
            "heading_count": toc_info.get("heading_count", {}),
        },
        "sections": sections,
    }


def _slice_sections(fulltext: str, headings) -> dict:
    """按标题行把全文切成 {标题: 上下文} 的近似章节切片（供规则2章节检索兜底）"""
    lines = fulltext.split("\n")
    title_set = {t for _, t in headings}
    sections = {}
    current = None
    buf: list = []
    for line in lines:
        s = line.strip()
        if s in title_set:
            if current is not None:
                sections.setdefault(current, "\n".join(buf))
            current = s
            buf = []
        elif current is not None:
            buf.append(line)
    if current is not None:
        sections.setdefault(current, "\n".join(buf))
    return sections


# ─────────────────────────────────────────────────────────────
#  pyparser 实现（跨平台，macOS 开发用）
# ─────────────────────────────────────────────────────────────

def _extract_with_pyparser(path: str) -> dict:
    import parser as P

    fulltext = P.extract_text_from_wps(path)
    lines = [l.rstrip() for l in fulltext.split("\n")]

    # 从正文行近似提取标题树（无大纲级别，按编号规则推断层级）
    headings = []
    for l in lines:
        s = l.strip()
        if not s or len(s) > 60:
            continue
        if P_re_heading(s):
            level = 2 if P_re_subheading(s) else 1
            headings.append([level, s])

    toc = P.parse_toc_structure(fulltext)  # {num: title}
    content_map = P.extract_all_subsections_with_content(fulltext, toc) if toc else {}

    sections = {}
    toc_entries = []
    for key in sorted(content_map.keys()):
        item = content_map[key]
        sections[key] = {"title": item.get("title", ""), "content": item.get("content", "")}
        toc_entries.append([f"{key} {item.get('title','')}".strip(), None])

    return {
        "engine": ENGINE_PYPARSER,
        "headings": headings,
        "fulltext": fulltext,
        "header_text": "",   # 纯 Python 引擎暂不解析页眉 → 页眉版本类检查降级为提示
        "toc": {
            "entries": toc_entries,
            "heading_pages": {},
            "heading_count": {},
        },
        "sections": sections,
    }


def P_re_heading(s: str) -> bool:
    import re
    return bool(re.match(r"^(第[一二三四五六七八九十百\d]+[章节部分篇]|[0-9]+(\.[0-9]+)*\s*\S)", s))


def P_re_subheading(s: str) -> bool:
    import re
    return bool(re.match(r"^\d+\.\d+", s))


# ─────────────────────────────────────────────────────────────
#  统一入口
# ─────────────────────────────────────────────────────────────

def extract(path: str) -> dict:
    """按探测到的引擎解析文档；wps_com 失败时自动降级 pyparser（实际使用引擎全程记日志）"""
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        raise FileNotFoundError(path)

    engine = detect_engine()
    name = os.path.basename(path)
    if engine == ENGINE_WPS_COM:
        _log(f"{name}: 使用 WinCom（WPS COM）解析…")
        started = time.time()
        try:
            result = _extract_with_wps_com(path)
            _log(f"{name}: WinCom 解析成功（耗时 {(time.time() - started) * 1000:.0f}ms，"
                 f"标题 {len(result.get('headings', []))} 个）")
            return result
        except Exception as e:
            _log(f"{name}: WinCom 解析失败，降级传统方案 pyparser（{type(e).__name__}: {e}）")

    _log(f"{name}: 使用传统方案 pyparser 解析…")
    started = time.time()
    result = _extract_with_pyparser(path)
    _log(f"{name}: 传统方案解析成功（耗时 {(time.time() - started) * 1000:.0f}ms，"
         f"正文 {len(result.get('fulltext', ''))} 字符）")
    return result
