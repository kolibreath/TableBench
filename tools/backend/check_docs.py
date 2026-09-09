# -*- coding: utf-8 -*-
"""
项目文档自查工具（核心逻辑，可被本地服务 server.py 调用）
- 扫描目录，过滤"业务需求说明书/业务需求书"文档
- 用 WPS COM 打开 .wps/.docx，提取标题结构与全文
- 按"检查规则1（业务需求说明书）"逐项检查
- 检查规则 2、3 暂为占位

用法：
    python check_docs.py "要检查的目录"     # 命令行方式
    from check_docs import check_directory  # 供服务调用
"""
import os
import sys
import re
import json
import datetime
import win32com.client


def _resource_path(rel):
    """兼容 PyInstaller 打包：onefile 时资源位于 sys._MEIPASS"""
    if getattr(sys, "frozen", False):
        return os.path.join(sys._MEIPASS, rel)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), rel)


TEMPLATES = _resource_path("templates.json")

# 规则1 的问题举例（来自附件2）
ISSUE_EXAMPLES = {
    "op1": "一般应用类项目应包含 Part1、Part2 两部分。",
    "op2": "应基于规范模板编写，不能删除模板必填项章节。",
    "op3": "必填项（功能定义、操作人员、权限要求、业务规则、输入、输出等）应有相关内容。",
    "op4": "敏捷项目需求列表应含功能类别、故事名称、故事描述、业务规则、验收标准；Part1 与敏捷需求条目列表应一致。",
    "op5": "存在文档格式问题或逻辑问题，如正文残留原模板引导性内容。",
}


def load_templates():
    with open(TEMPLATES, encoding="utf-8") as f:
        return json.load(f)


def extract_doc(doc):
    """提取标题结构、全文与页眉文本，返回 (headings, fulltext, header_text)"""
    headings = []
    texts = []
    for i in range(1, doc.Paragraphs.Count + 1):
        try:
            p = doc.Paragraphs(i)
            ol = p.OutlineLevel
            txt = p.Range.Text.strip().replace("\x07", "").strip()
            if txt:
                texts.append(txt)
            if 1 <= ol <= 9 and txt:
                headings.append((ol, txt))
        except Exception:
            pass
    # 提取页眉文本（用于检查模板版本与页眉版本一致性）
    header_text = ""
    try:
        for si in range(1, doc.Sections.Count + 1):
            try:
                hdr = doc.Sections(si).Headers(1)  # 1 = wdHeaderFooterPrimary
                header_text += hdr.Range.Text + "\n"
            except Exception:
                pass
    except Exception:
        pass
    return headings, "\n".join(texts), header_text


def extract_toc_pages(doc):
    """提取目录条目与正文标题页码，返回 {"entries": [(条目文本,页码)...], "heading_pages": {标题:页码}}"""
    paras = []
    for i in range(1, doc.Paragraphs.Count + 1):
        try:
            p = doc.Paragraphs(i)
            page = p.Range.Information(1)  # wdActiveEndAdjustedPageNumber（与目录页码同基准）
            txt = p.Range.Text.strip().replace("\x07", "").strip()
            ol = p.OutlineLevel
            paras.append((ol, txt, page))
        except Exception:
            pass
    # 定位"目录"标题（可能带空格，如"目 录"）
    toc_start = None
    for idx, (ol, txt, page) in enumerate(paras):
        if txt.replace(" ", "") == "目录":
            toc_start = idx
            break
    toc_entries = []
    if toc_start is not None:
        for idx in range(toc_start + 1, len(paras)):
            ol, txt, page = paras[idx]
            if ol == 1 and txt and txt != "目录":  # 遇到下一个一级标题，目录结束
                break
            if txt and txt != "目录":
                toc_entries.append((txt, page))
    # 正文标题页码（统计重复次数，用于目录页码对比时跳过重复标题）
    heading_pages = {}
    heading_count = {}
    for ol, txt, page in paras:
        if 1 <= ol <= 9 and txt and txt != "目录":
            if txt not in heading_pages:
                heading_pages[txt] = page
            heading_count[txt] = heading_count.get(txt, 0) + 1
    return {"entries": toc_entries, "heading_pages": heading_pages,
            "heading_count": heading_count}


def parse_toc_entry(entry):
    """从目录条目文本中解析出 标题 和 页码"""
    m = re.search(r"(\d+)\s*$", entry)
    page = int(m.group(1)) if m else None
    title = entry[:m.start()] if page is not None else entry
    title = re.sub(r"[\s\.…·•\t]+$", "", title)
    return title.strip(), page


def find_placeholder_pages(doc, placeholders):
    """统计每个占位符出现的页码（adjusted，与目录同基准），返回 {占位符: [页码,...]}"""
    result = {}
    for i in range(1, doc.Paragraphs.Count + 1):
        try:
            p = doc.Paragraphs(i)
            page = p.Range.Information(1)
            txt = p.Range.Text.strip().replace("\x07", "").strip()
            for ph in placeholders:
                if ph in txt:
                    result.setdefault(ph, set()).add(page)
        except Exception:
            pass
    return {k: sorted(v) for k, v in result.items()}


def find_heading_page(title, heading_pages):
    """在正文标题中查找匹配标题的实际页码"""
    if title in heading_pages:
        return heading_pages[title]
    stripped = re.sub(r"^[\d\.\s]+", "", title).strip()  # 去掉编号前缀
    if stripped in heading_pages:
        return heading_pages[stripped]
    best, bs = None, 0
    for k, v in heading_pages.items():
        s = _name_similarity(stripped, k)
        if s > bs:
            bs, best = s, v
    return best if bs > 0.7 else None


def detect_mode(text):
    """根据文档内容判断模板模式：敏捷/RPA/常规"""
    if re.search(r"故事|敏捷|故事名称|验收标准", text):
        return "敏捷"
    if re.search(r"流程步骤|RPA", text):
        return "RPA"
    return "常规"


def is_required_title(title):
    """判断模板标题是否为必填（不含'可选'标记）"""
    return "可选" not in title


def check_section_content(text, headings, key):
    """粗略判断某标题章节下是否有实质内容"""
    lines = text.split("\n")
    try:
        idx = next((i for i, l in enumerate(lines) if key in l), -1)
    except Exception:
        idx = -1
    if idx < 0:
        return False
    content = []
    title_set = set(t for _, t in headings)
    for i in range(idx + 1, min(idx + 8, len(lines))):
        if lines[i].strip() in title_set:
            break
        if lines[i].strip() and lines[i].strip() not in ("（可选）", "可选", "无"):
            content.append(lines[i])
    return len(content) >= 1


def check_rule1(headings, text, header_text, toc_info, mode, templates, filename="", series_parts=None, ph_pages=None):
    """按检查规则1（业务需求说明书）逐项检查"""
    tpl = templates.get(mode, templates.get("常规", {}))
    # 根据文件名 part 选择对应模板部分：part1 对比 part1 模板，part2 对比 part2 模板
    _, part = _extract_part(filename)
    tpl_section = tpl.get(part, tpl.get("part1", []))
    tpl_titles = [t for _, t in tpl_section]
    doc_titles = [t for _, t in headings]
    results = []
    part_label = (part or "part1").upper()

    # 操作1：一般应用类项目是否包括 Part1、Part2（文件层面，检查上传同系列文件）
    results.append(check_part1_part2(filename, series_parts or {}))

    # 操作2：是否基于模板、不删必填章节（按对应 part 模板对比，排除"功能名称1"占位符）
    required_tpl = [t for t in tpl_titles
                    if is_required_title(t) and not _is_placeholder_title(t)]
    missing_required = [t for t in required_tpl if t not in doc_titles]
    if missing_required:
        results.append({"op": "操作2（基于模板，不删必填章节）", "status": "不通过",
                        "detail": f"[{part_label}] 模板必填章节缺失：{'、'.join(missing_required[:10])}",
                        "example": ISSUE_EXAMPLES["op2"]})
    else:
        results.append({"op": "操作2（基于模板，不删必填章节）", "status": "通过",
                        "detail": f"[{part_label}] 模板必填章节均已包含（功能名称1占位符可替换为具体功能）。", "example": ""})

    # 操作3：必填项内容是否填写（功能必填项在 Part1）
    if part in (None, "part1"):
        required_keys = ["功能定义", "操作人员", "权限要求", "业务规则", "输入说明", "输出说明"]
        filled, empty = [], []
        for key in required_keys:
            if key in doc_titles and check_section_content(text, headings, key):
                filled.append(key)
            else:
                empty.append(key)
        if empty:
            results.append({"op": "操作3（必填项内容填写）", "status": "不通过",
                            "detail": f"以下必填项缺失或内容为空：{'、'.join(empty)}",
                            "example": ISSUE_EXAMPLES["op3"]})
        else:
            results.append({"op": "操作3（必填项内容填写）", "status": "通过",
                            "detail": f"必填项均已填写：{'、'.join(filled)}", "example": ""})
    else:
        results.append({"op": "操作3（必填项内容填写）", "status": "跳过",
                        "detail": "Part2 以非功能需求为主，功能必填项检查不适用。", "example": ""})

    # 操作4：敏捷需求列表合规（仅敏捷模式）
    if mode == "敏捷":
        agile_keys = ["功能类别", "故事名称", "故事描述", "业务规则", "验收标准"]
        missing_agile = [k for k in agile_keys if k not in text]
        if missing_agile:
            results.append({"op": "操作4（敏捷需求列表合规）", "status": "不通过",
                            "detail": f"敏捷需求列表缺少关键条目字段：{'、'.join(missing_agile)}",
                            "example": ISSUE_EXAMPLES["op4"]})
        else:
            results.append({"op": "操作4（敏捷需求列表合规）", "status": "通过",
                            "detail": "敏捷需求列表关键条目字段均已包含。", "example": ""})
    else:
        results.append({"op": "操作4（敏捷需求列表合规）", "status": "跳过",
                        "detail": "非敏捷项目，不适用。", "example": ""})

    # 操作5：格式/逻辑问题（汇总为一个结果项）
    results.append(check_format_issues(headings, text, header_text, toc_info, filename, tpl_section, ph_pages or {}))

    return results


def check_format_issues(headings, text, header_text, toc_info, filename, tpl_heads=None, ph_pages=None):
    """操作5：格式/逻辑问题检查，汇总为单个结果项，子项按依据编号1-6排序
    tpl_heads: 模板标题 [(level, title), ...]
    ph_pages: 占位符出现页码 {占位符: [页码]}"""
    head = text[:300]  # 封面区域
    toc_info = toc_info or {}
    tpl_heads = tpl_heads or []
    ph_pages = ph_pages or {}
    doc_titles = [t for _, t in headings]
    blocks = []  # (no, symbol, text, basis)  no=依据编号

    # 依据1：必填章节内容缺失且无原因说明
    required_keys = ["功能定义", "操作人员", "权限要求", "业务规则", "输入说明", "输出说明"]

    def has_reason(t):
        return any(k in t for k in ["不适用", "暂不", "无原因", "暂无", "不涉及"])
    missing_no_reason = []
    for key in required_keys:
        present = key in doc_titles and check_section_content(text, headings, key)
        if not present and not has_reason(text):
            missing_no_reason.append(key)
    if missing_no_reason:
        blocks.append((1, "✗", "必填章节内容缺失且无原因说明：" + "、".join(missing_no_reason),
                       "1.输入说明、输出说明等必填章节内容缺失且无原因说明"))
    else:
        blocks.append((1, "✓", "必填章节内容均已填写或有原因说明", None))

    # 依据2：模板部分章节被删减（对比模板必填一级章节，可选章节不计）
    tpl_l1 = [t for lv, t in tpl_heads
              if lv == 1 and is_required_title(t) and not _is_placeholder_title(t)]
    missing_l1 = [t for t in tpl_l1 if t not in doc_titles]
    if missing_l1:
        blocks.append((2, "✗", "模板必填一级章节被删减：" + "、".join(missing_l1),
                       "2.模板部分章节被删减"))
    else:
        blocks.append((2, "✓", "未发现模板必填章节被删减", None))

    # 依据3：文档首页项目名称
    placeholder_names = re.findall(r"XX项目|xxx项目|XXX项目|项目名称[:：]\s*$|项目名称[:：]\s*[（(]|XXX", head)
    if placeholder_names:
        blocks.append((3, "✗", "文档首页项目名称为模板占位或未填写",
                       "3.文档首页项目名称有误"))
    else:
        blocks.append((3, "✓", "未发现项目名称占位问题", None))

    # 依据4：模板版本与页眉版本一致性
    body_ver = re.search(r"模板版本[:：]\s*([Vv]?\s*[\d.]+)", text)
    body_version = body_ver.group(1).strip().replace(" ", "") if body_ver else None
    hdr_ver = re.search(r"([Vv]\s*[\d.]+)", header_text)
    header_version = hdr_ver.group(1).strip().replace(" ", "") if hdr_ver else None
    if body_version and header_version and body_version != header_version:
        blocks.append((4, "✗", f"模板版本「{body_version}」与页眉版本「{header_version}」不一致",
                       "4.模板版本与页眉版本不一致"))
    elif body_version and not header_version:
        blocks.append((4, "△", f"模板版本「{body_version}」，页眉未检测到版本号，需人工核对",
                       "4.模板版本与页眉版本不一致"))
    else:
        blocks.append((4, "✓", "未发现版本不一致问题", None))

    # 依据5：残留模板提示性文字（统计出现次数与页码）
    placeholders = ["功能名称1", "（可选）", "详见本模板part2", "填写说明", "template", "TODO"]
    leaked = [p for p in placeholders if p in text]
    if leaked:
        details = []
        for p in leaked:
            cnt = text.count(p)
            pages = ph_pages.get(p, [])
            pages_str = ",".join(str(x) for x in pages[:15]) + ("…" if len(pages) > 15 else "")
            if pages:
                details.append(f"{p}（{cnt}处，页码:{pages_str}）")
            else:
                details.append(f"{p}（{cnt}处）")
        blocks.append((5, "✗", "残留模板提示性文字：" + "；".join(details),
                       "5.残留模板提示性文字"))
    else:
        blocks.append((5, "✓", "未发现残留模板提示性文字", None))

    # 依据6：目录页码（自动比对目录页码与正文标题实际页码）
    toc_entries = toc_info.get("entries", [])
    heading_pages = toc_info.get("heading_pages", {})
    heading_count = toc_info.get("heading_count", {})
    if toc_entries:
        mismatches = []
        checked = 0
        for entry_text, toc_page in toc_entries:
            title, epage = parse_toc_entry(entry_text)
            if epage is None:
                continue
            actual = find_heading_page(title, heading_pages)
            if actual is None:
                continue
            checked += 1
            # 同名标题（如各功能下的"功能定义"）无法精确定位，跳过对比
            stripped = re.sub(r"^[\d\.\s]+", "", title).strip()
            key = stripped if stripped in heading_pages else title
            if heading_count.get(key, 1) > 1:
                continue
            if actual != epage:
                mismatches.append(f"「{title}」目录{epage}页/实际{actual}页")
        if mismatches:
            blocks.append((6, "✗", "目录页码与正文不一致：" + "；".join(mismatches[:6]),
                           "6.目录页码未更新，与文档页码不一致"))
        else:
            blocks.append((6, "✓", f"已核对 {checked} 条目录页码，均与正文一致", None))
    else:
        blocks.append((6, "△", "未检测到目录，无法比对目录页码", None))

    # 按依据编号排序
    blocks.sort(key=lambda b: b[0])

    # 汇总
    problems = [b[2].split("：")[0] for b in blocks if b[1] == "✗"]
    notices = [b[2] for b in blocks if b[1] == "△"]
    lines = []
    for no, sym, txt, basis in blocks:
        lines.append(f"{sym} {txt}")
        if basis:
            lines.append(f"   [依据] {basis}")
    if problems:
        status = "不通过"
        summary = "存在格式问题（" + str(len(problems)) + "处）：" + "、".join(problems)
    elif notices:
        status = "提示"
        summary = "存在需人工核对项：" + "、".join(notices)
    else:
        status = "通过"
        summary = "未发现格式/逻辑问题"

    return {"op": "操作5（格式/逻辑问题）", "status": status,
            "detail": summary + "\n" + "\n".join(lines),
            "example": "1.输入说明、输出说明等必填章节内容缺失且无原因说明；2.模板部分章节被删减；3.文档首页项目名称有误；4.模板版本与页眉版本不一致；5.残留模板提示性文字；6.目录页码未更新。"}




def _lcs_sub(a, b):
    """最长连续公共子串长度"""
    m = 0
    for i in range(len(a)):
        for j in range(len(b)):
            k = 0
            while i + k < len(a) and j + k < len(b) and a[i + k] == b[j + k]:
                k += 1
            if k > m:
                m = k
    return m


def _name_similarity(a, b):
    """文件名与检查内容名称的相似度（0~1）：字符 Dice 与 连续公共子串比例取较大值"""
    a = a or ''
    b = b or ''
    if not a or not b:
        return 0
    if a == b:
        return 1
    set_a, set_b = set(a), set(b)
    inter = len(set_a & set_b)
    dice = 2 * inter / (len(a) + len(b))
    sub = _lcs_sub(a, b)
    sub_ratio = sub / min(len(a), len(b)) if min(len(a), len(b)) else 0
    return max(dice, sub_ratio)


def detect_check_type(filename):
    """根据文件名与各检查内容做相似度匹配（相似度>50% 则归入），判断检查内容"""
    targets = ["业务需求说明书", "工作产品清单", "系统设计说明书"]
    best_type = "未知"
    best_score = 0.0
    for t in targets:
        score = _name_similarity(filename, t)
        if score > best_score:
            best_score = score
            best_type = t
    return best_type if best_score > 0.5 else "未知"


def _extract_part(filename):
    """从文件名提取系列名与 part 标识，返回 (series, part)，无 part 返回 (None, None)
    系列名忽略文件扩展名，以便 .docx/.wps 等不同后缀的 part1/part2 归为同一系列"""
    base = os.path.splitext(filename)[0]
    # 支持 (part1) /（part2）等形式
    m = re.search(r"[（(]\s*part\s*([12])\s*[）)]", base, re.I)
    if m:
        series = (base[:m.start()] + base[m.end():]).strip()
        part = "part1" if m.group(1) == "1" else "part2"
        return series, part
    # 支持 part1 / part2 不带括号
    m2 = re.search(r"part\s*([12])", base, re.I)
    if m2:
        series = (base[:m2.start()] + base[m2.end():]).strip()
        part = "part1" if m2.group(1) == "1" else "part2"
        return series, part
    return None, None


def _is_placeholder_title(title):
    """是否为模板占位符标题（如"功能名称1"，会被具体功能名替代）"""
    return "功能名称" in title


def check_part1_part2(filename, series_parts):
    """操作1：检查上传的同一系列文件是否同时包含 Part1 和 Part2"""
    series, part = _extract_part(filename)
    if not series or not part:
        return {"op": "操作1（Part1/Part2）", "status": "提示",
                "detail": "文件名未标识 part1/part2，无法判断是否包含两部分。",
                "example": "一般应用类项目应包含 Part1、Part2 两部分。"}
    parts = series_parts.get(series, set())
    if "part1" in parts and "part2" in parts:
        return {"op": "操作1（Part1/Part2）", "status": "通过",
                "detail": f"系列「{series}」已同时包含 Part1 和 Part2。", "example": ""}
    missing = [p for p in ["part1", "part2"] if p not in parts]
    return {"op": "操作1（Part1/Part2）", "status": "不通过",
            "detail": f"系列「{series}」缺少 {'、'.join(missing)} 文件。",
            "example": "一般应用类项目应包含 Part1、Part2 两部分。"}


def check_rule2(text):
    """检查规则2（工作产品清单）"""
    results = []
    # 操作1：是否存在制度要求出具、实际未出具的文档
    if "不出具" in text or "未出具" in text:
        results.append({"op": "操作1（制度要求出具却未出具）", "status": "提示",
                        "detail": "清单中存在'不出具/未出具'标记，请人工核对是否属于制度必须出具项。",
                        "example": "必须出具文档的'不出具理由'填写无、不适用等非实质性内容。"})
    else:
        results.append({"op": "操作1（制度要求出具却未出具）", "status": "通过",
                        "detail": "未发现明显的'不出具/未出具'标记。", "example": ""})
    # 操作2：不出具理由是否合规（不能填"不适用""无"等）
    bad_reasons = ["不适用", "无需出具", "无", "不用"]
    found_bad = []
    if "不出具" in text:
        for b in bad_reasons:
            if b in text:
                found_bad.append(b)
    if found_bad:
        results.append({"op": "操作2（不出具理由合规）", "status": "不通过",
                        "detail": f"必须文档的'不出具理由'填写了非实质性内容：{'、'.join(found_bad)}",
                        "example": "1.必须出具文档的'不出具理由'填写无、不适用等非实质性内容。2.报表目录不涉及直接删除。"})
    else:
        results.append({"op": "操作2（不出具理由合规）", "status": "通过",
                        "detail": "未发现明显不合规的'不出具理由'。", "example": ""})
    return results


def check_rule3(headings, text, templates=None):
    """检查规则3（系统设计说明书）"""
    results = []
    doc_titles = [t for _, t in headings]
    tpl = ((templates or {}).get("系统设计说明书") or {}).get("part1", [])
    tpl_titles = [t for _, t in tpl]

    # 操作1：封面内容是否填写合规（项目名称、文档名称）
    cover_ok = ("项目名称" in text) or ("文档名称" in text) or ("系统设计说明书" in text)
    if cover_ok:
        results.append({"op": "操作1（封面合规）", "status": "通过",
                        "detail": "已检测到封面相关标识（项目名称/文档名称/系统设计说明书）。",
                        "example": ""})
    else:
        results.append({"op": "操作1（封面合规）", "status": "提示",
                        "detail": "未检测到明确的封面项目名称/文档名称。",
                        "example": "文档首页项目名称有误。"})

    # 操作2：文档章节是否与模板章节一致（对比模板必填一级章节）
    if tpl_titles:
        # 模板一级必填章节（排除"附：接口"等）
        tpl_l1 = [t for lv, t in tpl if lv == 1 and "附：" not in t]
        missing = []
        for t in tpl_l1:
            if not title_in_doc(t, doc_titles):
                missing.append(t)
        if missing:
            results.append({"op": "操作2（章节与模板一致）", "status": "不通过",
                            "detail": "缺少模板一级章节：" + "、".join(missing),
                            "example": "文档章节与模板章节不一致。"})
        else:
            results.append({"op": "操作2（章节与模板一致）", "status": "通过",
                            "detail": "文档一级章节与模板一致。", "example": ""})
    else:
        results.append({"op": "操作2（章节与模板一致）", "status": "提示",
                        "detail": "暂无系统设计说明书模板可对比。", "example": ""})

    # 操作3：章节是否有删除，无内容章节是否填写"无"
    has_empty_mark = "无" in text
    results.append({"op": "操作3（章节完整/空章节填'无'）", "status": "提示",
                    "detail": f"检测到标题 {len(headings)} 个" + ("，存在'无'占位标记。" if has_empty_mark else "，未发现'无'占位标记。"),
                    "example": "模板部分章节被删减；无内容章节未填写'无'。"})

    # 操作4：数据迁移（新建/替代老系统/架构重构类）
    if "数据迁移" in text or "数据移植" in text or "数据移植策略" in text:
        results.append({"op": "操作4（数据迁移）", "status": "通过",
                        "detail": "文档包含数据迁移/数据移植相关内容。",
                        "example": ""})
    else:
        results.append({"op": "操作4（数据迁移）", "status": "提示",
                        "detail": "未检测到数据迁移内容；若属新建系统替代老系统或数据架构重构类项目，应补充数据迁移策略及验证方法、移植清单、程序、脚本等。",
                        "example": "涉及数据迁移但系统设计书中缺失数据迁移内容。"})

    # 操作5：内容完善度
    lines = [l.strip() for l in text.split("\n") if l.strip() and l.strip() not in ("无", "（可选）")]
    if len(lines) < 15:
        results.append({"op": "操作5（内容完善度）", "status": "提示",
                        "detail": "文档内容较少，可能存在照搬模板、实质内容不足的情况，请人工确认。",
                        "example": "文档内容照搬模板，实质内容较少。"})
    else:
        results.append({"op": "操作5（内容完善度）", "status": "通过",
                        "detail": "文档内容较为充实。", "example": ""})
    return results


def title_in_doc(title, doc_titles):
    """判断模板标题是否在文档标题中存在（精确/去括号/相似度）"""
    if title in doc_titles:
        return True
    stripped = re.sub(r"[（(][^）)]*[）)]", "", title).strip()
    if stripped and stripped in doc_titles:
        return True
    # 相似度匹配
    for dt in doc_titles:
        if _name_similarity(stripped, dt) > 0.7:
            return True
    return False


def find_target_docs(root):
    """扫描目录，过滤业务需求书/业务需求说明书文档"""
    targets = []
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            if not fn.lower().endswith((".wps", ".wpsx", ".doc", ".docx")):
                continue
            if fn.startswith("~$"):
                continue
            if "业务需求" in fn:
                targets.append(os.path.join(dirpath, fn))
    return targets


def is_excel(filename):
    return filename.lower().endswith((".et", ".xls", ".xlsx"))


def extract_excel(path):
    """用 WPS 表格 COM 读取 Excel 内容，返回 [sheet_rows...]，每 sheet 为二维行数组"""
    app = win32com.client.Dispatch("KET.Application")
    app.Visible = False
    wb = app.Workbooks.Open(path)
    data = []
    try:
        for si in range(1, wb.Sheets.Count + 1):
            sh = wb.Sheets(si)
            used = sh.UsedRange
            rows = used.Rows.Count
            cols = used.Columns.Count
            sheet_data = []
            for r in range(1, rows + 1):
                row = []
                for c in range(1, cols + 1):
                    v = sh.Cells(r, c).Value
                    row.append("" if v is None else str(v))
                sheet_data.append(row)
            if sheet_data:
                data.append(sheet_data)
    finally:
        wb.Close(False)
        app.Quit()
    return data


def check_rule2(excel_data):
    """检查规则2（工作产品清单，Excel 表格）
    操作1：制度要求出具（是否必须编写=是）却未出具（是否出具=否）
    操作2：必须出具却不出具的"不出具理由"是否合规（不能填"不适用/无/空"等）"""
    results = []
    header = None
    data_rows = []
    # 定位含"是否必须编写"表头的 sheet 与数据行
    for sheet in excel_data:
        for ri, row in enumerate(sheet):
            if any("是否必须编写" in str(c) for c in row):
                header = row
                data_rows = sheet[ri + 1:]
                break
        if header:
            break
    if not header:
        results.append({"op": "检查内容识别", "status": "跳过",
                        "detail": "未识别到工作产品清单表头（缺少'是否必须编写'列）。",
                        "example": ""})
        return results

    def col(name):
        for i, c in enumerate(header):
            if name in str(c):
                return i
        return -1

    idx_required = col("是否必须编写")
    idx_output = col("是否出具")
    idx_reason = col("不出具理由")
    idx_product = col("工作产品")

    must_not_output = []   # 制度要求出具却未出具
    bad_reason = []        # 不出具理由不合规
    bad_reasons = ["不适用", "无", "", "不用", "无需"]

    for row in data_rows:
        def cell(i):
            return str(row[i]).strip() if 0 <= i < len(row) else ""
        req = cell(idx_required)
        out = cell(idx_output)
        reason = cell(idx_reason)
        product = cell(idx_product)
        if req == "是" and out == "否":
            must_not_output.append(product or "（未命名文档）")
            if reason in bad_reasons:
                bad_reason.append(f"{product or '未命名'}(理由：{'空' if not reason else reason})")

    # 操作1
    if must_not_output:
        results.append({"op": "操作1（制度要求出具却未出具）", "status": "不通过",
                        "detail": "制度要求必须出具但实际未出具的文档：" + "、".join(must_not_output),
                        "example": "制度要求必须出具的文档，项目组选择不出具。"})
    else:
        results.append({"op": "操作1（制度要求出具却未出具）", "status": "通过",
                        "detail": "未发现制度要求出具却未出具的文档。", "example": ""})

    # 操作2
    if bad_reason:
        results.append({"op": "操作2（不出具理由合规）", "status": "不通过",
                        "detail": "必须出具文档的'不出具理由'填写了非实质性内容：" + "、".join(bad_reason),
                        "example": "必须出具文档的'不出具理由'填写无、不适用等非实质性内容。"})
    else:
        results.append({"op": "操作2（不出具理由合规）", "status": "通过",
                        "detail": "未发现不合规的'不出具理由'。", "example": ""})

    return results


def check_file(app, path, templates, series_parts=None):
    """检查单个文档文件，返回结构化 entry dict"""
    entry = {"name": os.path.basename(path), "path": path}
    check_type = detect_check_type(entry["name"])

    # Excel 文档（工作产品清单）
    if is_excel(entry["name"]):
        entry["checkType"] = check_type
        if check_type == "工作产品清单":
            try:
                excel_data = extract_excel(path)
                entry["results"] = check_rule2(excel_data)
            except Exception as e:
                entry["error"] = str(e)
        else:
            entry["results"] = [{"op": "检查内容识别", "status": "跳过",
                                 "detail": "Excel 文档，当前仅支持工作产品清单检查。", "example": ""}]
        return entry

    # Word 文档
    try:
        doc = app.Documents.Open(path)
        headings, text, header_text = extract_doc(doc)
        toc_info = extract_toc_pages(doc)
        placeholders = ["功能名称1", "（可选）", "详见本模板part2", "填写说明", "template", "TODO"]
        ph_pages = find_placeholder_pages(doc, placeholders)
        doc.Close(False)
    except Exception as e:
        entry["error"] = str(e)
        return entry

    mode = detect_mode(text)
    entry["mode"] = mode
    entry["checkType"] = check_type
    if check_type == "业务需求说明书":
        entry["results"] = check_rule1(headings, text, header_text, toc_info, mode, templates,
                                       entry["name"], series_parts or {}, ph_pages)
    elif check_type == "工作产品清单":
        entry["results"] = check_rule2([[t.split("\n") for t in [text]]])
    elif check_type == "系统设计说明书":
        entry["results"] = check_rule3(headings, text, templates)
    else:
        entry["results"] = [{"op": "检查内容识别", "status": "跳过",
                             "detail": "无法根据文件名识别检查内容。", "example": ""}]
    return entry


def _build_series_parts(file_paths):
    """统计每个系列名已提交的 part 集合"""
    series_parts = {}
    for p in file_paths:
        series, part = _extract_part(os.path.basename(p))
        if series and part:
            series_parts.setdefault(series, set()).add(part)
    return series_parts


def _get_app():
    app = win32com.client.Dispatch("KWps.Application")
    app.Visible = False
    return app


def check_files(file_paths):
    """检查指定文件列表（供插件传入勾选的文件），返回结果并附日志与耗时"""
    import time
    logs = []
    t0 = time.time()

    def log(msg):
        logs.append(msg)
        try:
            print(msg)
            sys.stdout.flush()
        except Exception:
            pass

    log(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] 开始检查，共 {len(file_paths)} 个文件")

    templates = load_templates()
    log("已加载模板配置 templates.json")

    result = {"time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
              "documents": [], "logs": logs}
    series_parts = _build_series_parts(file_paths)

    app = _get_app()
    log("已连接 WPS 服务（WPS COM）")
    try:
        for p in file_paths:
            p = os.path.abspath(p)
            if not os.path.isfile(p):
                log(f"  跳过不存在文件: {p}")
                continue
            t1 = time.time()
            log(f"  开始解析文件: {os.path.basename(p)}")
            entry = check_file(app, p, templates, series_parts)
            dt = time.time() - t1
            name = entry.get("name", "?")
            if entry.get("error"):
                log(f"  ✗ 文件[{name}] 打开/解析失败: {entry['error']}（耗时 {dt:.2f}s）")
            else:
                log(f"  ✓ 文件[{name}] 识别为[{entry.get('checkType','?')}]，检查 {len(entry.get('results', []))} 项（耗时 {dt:.2f}s）")
            result["documents"].append(entry)
    finally:
        app.Quit()
        log("已释放 WPS 服务")

    total = time.time() - t0
    log(f"检查完成，共 {len(result['documents'])} 份，总耗时 {total:.2f}s")
    result["totalTime"] = round(total, 2)
    return result


def check_directory(root):
    """扫描目录并检查，返回结构化结果 dict（供本地服务调用）"""
    root = os.path.abspath(root)
    result = {"dir": root, "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
              "documents": []}
    if not os.path.isdir(root):
        result["error"] = "目录不存在: " + root
        return result

    targets = find_target_docs(root)
    result["found"] = len(targets)
    if not targets:
        return result

    templates = load_templates()
    series_parts = _build_series_parts(targets)
    app = _get_app()
    try:
        for path in targets:
            result["documents"].append(check_file(app, path, templates, series_parts))
    finally:
        app.Quit()
    return result


def main():
    import sys
    if len(sys.argv) > 1:
        root = sys.argv[1]
    else:
        root = input("请输入要检查的目录路径: ").strip().strip('"')

    result = check_directory(root)
    print("=" * 60)
    print("检查目录:", result.get("dir"))
    print("生成时间:", result.get("time"))
    if result.get("error"):
        print("错误:", result["error"])
        return
    print("发现业务需求文档:", result.get("found", 0), "份")
    for entry in result.get("documents", []):
        print("-" * 60)
        print("文档:", entry["name"], f"(检查内容:{entry.get('checkType','')} 模式:{entry.get('mode','')})")
        if entry.get("error"):
            print("  [打开失败]", entry["error"])
            continue
        for r in entry.get("results", []):
            print(f"  [{r['status']}] {r['op']}: {r['detail']}")
            if r.get("example"):
                print(f"      依据: {r['example']}")

    # 保存报告
    out_path = os.path.join(result["dir"], f"自查报告_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.txt")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("项目文档自查报告\n")
        f.write(f"生成时间: {result['time']}\n")
        f.write(f"检查目录: {result['dir']}\n")
        f.write("=" * 60 + "\n")
        for entry in result.get("documents", []):
            f.write(f"\n文档: {entry['name']} (检查内容:{entry.get('checkType','')} 模式:{entry.get('mode','')})\n")
            if entry.get("error"):
                f.write(f"  [打开失败] {entry['error']}\n")
                continue
            for r in entry.get("results", []):
                f.write(f"  [{r['status']}] {r['op']}: {r['detail']}\n")
                if r.get("example"):
                    f.write(f"      依据: {r['example']}\n")
    print("\n报告已保存到:", out_path)


if __name__ == "__main__":
    main()
