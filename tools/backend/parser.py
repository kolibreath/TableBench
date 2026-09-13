from __future__ import annotations

import os
import re
import struct
import sys
import zipfile
import xml.etree.ElementTree as ET

if getattr(sys, 'frozen', False):
    _vendor_dir = os.path.join(sys._MEIPASS, "vendor_pkgs")
else:
    _vendor_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor_pkgs")
if os.path.isdir(_vendor_dir):
    sys.path.insert(0, _vendor_dir)

try:
    import olefile  # noqa: F811
    _HAS_OLEFILE = True
except ImportError:
    _HAS_OLEFILE = False


def _log(msg: str) -> None:
    print(f"[parser] {msg}", flush=True)


def extract_text_from_wps(file_path: str) -> str:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"文件不存在: {file_path}")

    name = os.path.basename(file_path)
    try:
        from docx import Document
        doc = Document(file_path)
        text = _extract_from_docx(doc)
        _log(f"{name}: python-docx 解析成功（{len(text)} 字符）")
        return text
    except Exception as e:
        _log(f"{name}: python-docx 解析失败，转传统兜底（{type(e).__name__}: {e}）")
        return extract_text_fallback(file_path)


def _extract_from_docx(doc) -> str:
    parts = []
    table_idx = 0
    for element in doc.element.body:
        tag = element.tag.split('}')[-1] if '}' in element.tag else element.tag
        if tag == 'p':
            para = None
            for p in doc.paragraphs:
                if p._element is element:
                    para = p
                    break
            if para is None:
                continue
            style_name = (para.style.name or '').lower() if para.style else ''
            text = para.text.strip()
            if not text:
                parts.append('')
                continue
            if 'heading 1' in style_name or 'heading1' in style_name:
                parts.append(text)
            elif 'heading 2' in style_name or 'heading2' in style_name:
                parts.append(text)
            elif 'heading 3' in style_name or 'heading3' in style_name:
                parts.append(text)
            elif 'toc' in style_name:
                parts.append(text)
            else:
                parts.append(text)
        elif tag == 'tbl':
            if table_idx < len(doc.tables):
                table = doc.tables[table_idx]
                table_idx += 1
                for row in table.rows:
                    cells = []
                    for cell in row.cells:
                        cell_text = cell.text.strip().replace('\n', ' ')
                        cells.append(cell_text)
                    parts.append('\t'.join(cells))
                parts.append('')
    return "\n".join(parts)


def _is_ole2(file_path: str) -> bool:
    MAGIC = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1"
    with open(file_path, "rb") as f:
        return f.read(len(MAGIC)) == MAGIC


def _extract_utf16le_text(data: bytes) -> str:
    chunks = []
    i = 0
    while i < len(data) - 1:
        code = struct.unpack_from("<H", data, i)[0]
        if 0x4E00 <= code <= 0x9FFF or 0x3000 <= code <= 0x303F or 0x0020 <= code <= 0x007E or 0xFF00 <= code <= 0xFFEF or 0x3000 <= code <= 0x30FF or 0x3100 <= code <= 0x312F or 0x2000 <= code <= 0x206F or code in (0x0D, 0x0A, 0x09, 0x3001, 0x3002):
            chunks.append(chr(code))
        elif chunks and chunks[-1] != "\n":
            chunks.append("\n")
        i += 2
    return re.sub(r"\n{3,}", "\n\n", "".join(chunks)).strip()


def _clean_ole2_text(text: str) -> str:
    # 先清理域代码
    out = []
    stack = []
    for c in text:
        if c == '\x13':
            stack.append(True)
        elif c == '\x14':
            if stack:
                stack[-1] = False
        elif c == '\x15':
            if stack:
                stack.pop()
        elif c == '\x07':
            pass
        else:
            in_instruction = any(stack)
            if not in_instruction:
                out.append(c)

    cleaned = ''.join(out)
    # 清理多余空白和换行
    cleaned = re.sub(r'[ \t]+\n', '\n', cleaned)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    # 尝试去除连续的乱码段落（长度>1且纯非中文字符）
    lines = cleaned.splitlines()
    filtered = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            filtered.append('')
            continue
        chinese = sum(1 for c in stripped if '\u4e00' <= c <= '\u9fff')
        if chinese == 0 and len(stripped) > 5:
            continue
        filtered.append(line)

    cleaned = '\n'.join(filtered).strip()
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    return cleaned


def _extract_with_olefile(file_path: str) -> str | None:
    if not _HAS_OLEFILE:
        return None

    try:
        ole = olefile.OleFileIO(file_path)
        wd = ole.openstream("WordDocument").read()
        ole.close()

        # 先用暴力提取（更兼容非标准格式）
        raw = _extract_utf16le_text(wd)
        return _clean_ole2_text(raw)
    except Exception:
        return None


def extract_text_fallback(file_path: str) -> str:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"文件不存在: {file_path}")

    name = os.path.basename(file_path)
    if _is_ole2(file_path):
        result = _extract_with_olefile(file_path)
        if result:
            _log(f"{name}: 传统兜底 → OLE2/olefile 提取成功（{len(result)} 字符）")
            return result
        with open(file_path, "rb") as f:
            data = f.read()
        text = _extract_utf16le_text(data)
        _log(f"{name}: 传统兜底 → OLE2 原始 UTF-16LE 暴力提取（{len(text)} 字符）")
        return text

    nsmap = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []

    with zipfile.ZipFile(file_path, "r") as zf:
        if "word/document.xml" not in zf.namelist():
            _log(f"{name}: 传统兜底 → ZIP 中无 word/document.xml，提取结果为空")
            return ""

        with zf.open("word/document.xml") as xml_file:
            tree = ET.parse(xml_file)
            root = tree.getroot()

            for p_elem in root.iterfind(".//w:p", nsmap):
                texts: list[str] = []
                for t_elem in p_elem.iterfind(".//w:t", nsmap):
                    if t_elem.text:
                        texts.append(t_elem.text)
                paragraphs.append("".join(texts))

    text = "\n".join(paragraphs)
    _log(f"{name}: 传统兜底 → ZIP/XML（word/document.xml）提取成功（{len(text)} 字符）")
    return text


_CHAPTER_NAMES: list[str] = [
    "引言",
    "业务概述",
    "功能需求",
    "需求后评价指标需求",
    "用户体验需求",
    "业务运维需求",
    "其他需求",
]


def _match_chapter(line: str) -> int | None:
    stripped = line.strip()
    cleaned = re.sub(r"[（(].*?[）)]", "", stripped).strip()
    for idx, name in enumerate(_CHAPTER_NAMES, start=1):
        if cleaned == name or stripped == name or stripped.startswith(name) or name in stripped:
            return idx
    return None


def _parse_toc_unnumbered(text: str) -> dict[str, str]:
    dir_idx = text.find("目录")
    if dir_idx == -1:
        return {}

    after = text[dir_idx:]
    lines = re.split(r'[\r\n]', after)

    toc_lines: list[str] = []
    empty_count = 0
    for line in lines[1:]:
        stripped = line.strip()
        # 跳过空行，但连续空行过多时停止
        if not stripped:
            empty_count += 1
            if empty_count >= 3:
                break
            continue
        empty_count = 0

        chinese_count = sum(1 for c in stripped if '\u4e00' <= c <= '\u9fff')

        # 跳过单独页码行（纯数字）
        if stripped.isdigit():
            continue

        # 跳过编号行（如 "1. 引言"），因为这是无编号模式兜底
        if re.match(r'^\d+[\.、]\s*', stripped):
            continue

        # 有效无编号目录项：至少1个中文字符，且不太长
        if chinese_count >= 1 and len(stripped) <= 60:
            toc_lines.append(stripped)
            continue

        # 其他情况（如长段落正文），停止收集
        break

    chapter_indices: dict[int, int] = {}
    for i, line in enumerate(toc_lines):
        ch = _match_chapter(line)
        if ch is not None:
            if ch not in chapter_indices:
                chapter_indices[ch] = i

    result: dict[str, str] = {}
    sorted_chapters = sorted(chapter_indices.keys())

    for ci, ch in enumerate(sorted_chapters):
        ch_idx = chapter_indices[ch]
        ch_key = str(ch)
        result[ch_key] = toc_lines[ch_idx]

        next_ch_idx = len(toc_lines)
        if ci + 1 < len(sorted_chapters):
            next_ch_idx = chapter_indices[sorted_chapters[ci + 1]]

        sub_counter = 1
        for j in range(ch_idx + 1, next_ch_idx):
            line = toc_lines[j]
            matched_ch = _match_chapter(line)
            if matched_ch is not None and matched_ch != ch:
                continue
            sub_key = f"{ch_key}.{sub_counter}"
            result[sub_key] = line
            sub_counter += 1

    return result


def parse_toc_structure(text: str) -> dict[str, str]:
    # 先定位目录区域
    toc_start = text.find("目录")
    if toc_start < 0:
        return {}

    # 找到目录区域的结束位置：找到连续两行以上的长内容
    lines = text.splitlines()
    toc_end_idx = None
    toc_line_idx = None
    for i, line in enumerate(lines):
        if line.strip() == "目录":
            toc_line_idx = i
            break
    if toc_line_idx is None:
        return {}

    # 目录区域：从 "目录" 之后开始，收集目录项
    toc_lines = []
    empty_count = 0
    # 先找到第一个目录项开始的行，避免收集前面的空行
    start_idx = None
    for i in range(toc_line_idx + 1, len(lines)):
        raw_line = lines[i]
        stripped = raw_line.strip()
        if not stripped:
            continue
        chinese_count = sum(1 for c in stripped if '\u4e00' <= c <= '\u9fff')
        # 目录项：以数字开头（如 "1. 引言"），或包含中文字符（无编号标题）
        if re.match(r'^\d+', stripped) or chinese_count >= 1:
            start_idx = i
            break
    else:
        # 没有找到数字或中文开头的行，无法解析目录
        return {}

    # 从 start_idx 开始收集目录项
    for i in range(start_idx, len(lines)):
        raw_line = lines[i]
        stripped = raw_line.strip()
        if not stripped:
            empty_count += 1
            toc_lines.append(raw_line)
            if empty_count >= 3:
                break
            continue
        empty_count = 0

        # 数字单独一行 → 页码
        if stripped.isdigit():
            toc_lines.append(raw_line)
            continue

        chinese_count = sum(1 for c in stripped if '\u4e00' <= c <= '\u9fff')

        # 以数字开头 → 编号目录项（如 "1. 引言" / "1.1. 编写目的"）
        if re.match(r'^\d+', stripped):
            toc_lines.append(raw_line)
            continue

        # 包含中文字符且长度不太长 → 可能是无编号目录标题
        # 排除过长的行（可能是正文段落）
        if chinese_count >= 1 and len(stripped) <= 60:
            toc_lines.append(raw_line)
            continue

        # 其他情况，停止收集目录（进入正文）
        break

    toc_text = "\n".join(toc_lines)

    # 先清理目录文本里的单独数字行（页码）
    cleaned_toc_lines = []
    for line in toc_lines:
        stripped = line.strip()
        if not stripped:
            cleaned_toc_lines.append("")
            continue
        # 去掉只有数字的行（页码）
        if stripped.isdigit() or (stripped.startswith('(') and stripped.endswith(')') and stripped[1:-1].isdigit()):
            continue
        cleaned_toc_lines.append(stripped)
    toc_text = "\n".join(cleaned_toc_lines)

    # 先尝试带"第X章"的模式
    numbered_match = re.search(r"第\s*(\d+)\s*章\s*(.+)", toc_text)
    if numbered_match:
        pattern = re.compile(
            r"^(\d+)\.(\d+)\s*[.、\s]*\s*(.+)",
            re.MULTILINE,
        )
        numbered_result: dict[str, str] = {}
        for m in pattern.finditer(toc_text):
            ch = m.group(1)
            sub = m.group(2)
            title = m.group(3).strip()
            key = f"{int(ch)}.{int(sub)}"
            if key not in numbered_result:
                numbered_result[key] = title

        for m in re.finditer(r"第\s*(\d+)\s*章\s*(.+)", toc_text):
            ch = m.group(1)
            title = m.group(2).strip()
            numbered_result[str(int(ch))] = title

        if numbered_result:
            return numbered_result

    # 再尝试纯数字编号模式（如：1. 引言 / 3.4 网点查询功能优化）
    # 先收集所有符合条件的项，然后按编号排序
    items = []
    # 先匹配 x.y. 和 x.y 格式的子项（末尾点号可选）
    sub_pattern = re.compile(r'^(\d+)\.(\d+)(?:[\.。])?\s*(.+)$', re.MULTILINE)
    for m in sub_pattern.finditer(toc_text):
        x = int(m.group(1))
        y = int(m.group(2))
        title = m.group(3).strip()
        if title and len(title) >= 1:
            items.append( (x, y, title) )
    # 再匹配 x.  x、  x  格式的主项（多种分隔符）
    main_pattern = re.compile(r'^(\d+)[\.。、\s]\s+(.+)$', re.MULTILINE)
    for m in main_pattern.finditer(toc_text):
        x = int(m.group(1))
        title = m.group(2).strip()
        if title and len(title) >= 1:
            items.append( (x, 0, title) )

    # 构建结果 dict
    plain_chapters = {}
    for x, y, title in items:
        if y ==0:
            key = str(x)
        else:
            key = f"{x}.{y}"
        if key not in plain_chapters:
            plain_chapters[key] = title

    if len(plain_chapters)>=2:
        return plain_chapters

    return _parse_toc_unnumbered(text)


def _find_body_start(text: str) -> int:
    """定位目录结束位置，返回正文在 text 中的起始索引。

    利用 parse_toc_structure 已解析出的 TOC 结果，精确定位目录中最后一个条目，
    并跳过其后的页码行/空行，避免正文被目录残留内容污染。
    """
    from parser import parse_toc_structure

    dir_start = text.find("目录")
    if dir_start < 0:
        return 0

    toc = parse_toc_structure(text)
    if not toc:
        return dir_start + len("目录")

    # 找到 TOC 中编号最大的条目（通常是目录最后一个带编号项）
    def _max_sort_key(key: str):
        if "." in key:
            return tuple(int(x) for x in key.split("."))
        return (int(key),)

    max_key = max(toc.keys(), key=_max_sort_key)
    max_title = toc[max_key]

    dir_text = text[dir_start:]

    # 尝试多种格式匹配最后一个目录项的完整文本（编号+标题）
    # 目录总在正文之前，dir_text.find 第一个匹配就是目录中的条目
    candidates = []
    if "." in max_key:
        candidates.append(f"{max_key}. {max_title}")
        candidates.append(f"{max_key}.\t{max_title}")
        candidates.append(f"{max_key} {max_title}")
        candidates.append(f"{max_key}.{max_title}")
    else:
        candidates.append(f"{max_key}. {max_title}")
        candidates.append(f"{max_key}.\t{max_title}")
        candidates.append(f"{max_key} {max_title}")

    last_match_end = -1
    for candidate in candidates:
        idx = dir_text.find(candidate)
        if idx >= 0:
            last_match_end = idx + len(candidate)
            break

    if last_match_end < 0:
        # 回退：匹配最后一个带编号目录项的编号前缀
        # 先尝试子章节，再尝试主章节
        sub_pattern = re.compile(r'^(\s*)(\d+)\.(\d+)[.、\s]*', re.MULTILINE)
        last_sub_end = -1
        for m in sub_pattern.finditer(dir_text):
            last_sub_end = m.end()
        if last_sub_end < 0:
            main_pattern = re.compile(r'^(\s*)(\d+)[.、]\s+', re.MULTILINE)
            for m in main_pattern.finditer(dir_text):
                last_sub_end = m.end()
        last_match_end = last_sub_end if last_sub_end >= 0 else len("目录")

    # 从 last_match_end 之后继续向后扫描，跳过页码行和空行
    pos = dir_start + last_match_end
    remaining = text[pos:]
    lines = remaining.splitlines()
    skip_idx = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            skip_idx = i + 1
            continue
        if stripped.isdigit():
            skip_idx = i + 1
            continue
        # 遇到非空、非数字行，停止
        break

    toc_end_pos = pos
    for i in range(skip_idx):
        toc_end_pos += len(lines[i]) + 1  # +1 for newline

    return min(toc_end_pos, len(text))


def _is_valid_content_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if '\t' in stripped:
        return True
    chinese = [c for c in stripped if '\u4e00' <= c <= '\u9fff']
    non_whitespace = [c for c in stripped if c not in ' \t\r\n' and not ('\u4e00' <= c <= '\u9fff')]

    if len(non_whitespace) >= 3:
        return True
    if chinese and non_whitespace and len(stripped) >= 4:
        return True
    if len(chinese) >= 6:
        return True
    if len(chinese) >= 3 and len(stripped) >= 6 and len(set(chinese)) >= 2:
        return True
    if len(chinese) >= 1 and len(non_whitespace) <= 1:
        return True
    return False


def _strip_toc_prefix(title: str) -> str:
    """去掉 TOC 标题中的编号前缀，适配正文中无编号的标题"""
    patterns = [
        r'^\d+\.\d+\.\s+',
        r'^\d+\.\s+',
        r'^\d+\s+',
        r'^\d+[.、\s]+',
    ]
    for pattern in patterns:
        stripped = re.sub(pattern, '', title, count=1)
        if stripped != title:
            return stripped
    return title


def _find_title_at_line_start(body: str, title: str) -> int:
    """在正文中搜索标题是否出现在行首（段落开头）。

    仅当标题文本出现在一行的开头（允许前导空白）时才视为匹配，
    避免正文中间出现的相同文字被误识别为章节标题。

    Returns:
        标题实际开始的位置（相对于 body，已跳过前导空白），未找到返回 -1
    """
    escaped = re.escape(title)
    pattern = re.compile(r'^(\s*)' + escaped, re.MULTILINE)
    match = pattern.search(body)
    if match:
        # 跳过前导空白（\s* 可能匹配到换行符等），返回标题实际开始位置
        return match.start() + len(match.group(1))
    return -1


def _parse_key_tuple(key: str) -> tuple[int, ...]:
    """将 '3.10' 解析为 (3, 10)，避免 float('3.10') == 3.1 的问题"""
    return tuple(int(x) for x in key.split("."))


def _sort_key(key: str):
    """排序键：带点的按元组排序，纯章节号排在子节之后"""
    if "." in key:
        return _parse_key_tuple(key)
    return (int(key), float("inf"))


def _extract_body_by_title(text: str, subsections: dict[str, str]) -> dict[str, dict[str, str]]:
    # 无需提取正文内容的标题（精确匹配）
    SKIP_TITLES = {"错误信息", "错误信息(可选)", "错误信息（可选）"}
    subsection_keys = [k for k in subsections if "." in k]
    if not subsection_keys:
        return {}

    subsection_keys.sort(key=_parse_key_tuple)
    titles = [subsections[k] for k in subsection_keys]

    body_start = _find_body_start(text)
    body = text[body_start:]

    title_positions = []  # (key, idx, matched_title, is_skip)
    for key, title in zip(subsection_keys, titles):
        is_skip = title in SKIP_TITLES
        # 用 key（如 "3.1"）+ title 组合搜索行首匹配
        # 正文中标题格式可能是 "3.1. 功能分类"、"3.1 功能分类" 等
        matched = None
        idx = -1
        for joiner in ['. ', '.\t', '.', ' ']:
            candidate = f'{key}{joiner}{title}'
            idx = _find_title_at_line_start(body, candidate)
            if idx >= 0:
                matched = candidate
                break
        # 尝试去掉编号前缀匹配纯文本标题（正文中可能无编号）
        if idx < 0:
            stripped = _strip_toc_prefix(title)
            search_text = stripped if stripped != title else title
            idx = _find_title_at_line_start(body, search_text)
            if idx >= 0:
                matched = search_text

        if idx >= 0:
            title_positions.append((key, idx, matched, is_skip))

    if not title_positions:
        return {}

    title_positions.sort(key=lambda x: x[1])

    last_sub_pos = title_positions[-1][1] if title_positions else 0
    boundary = len(body)
    for key, title in subsections.items():
        if "." in key:
            continue
        idx = _find_title_at_line_start(body[last_sub_pos + 1:], title)
        if idx >= 0:
            abs_idx = last_sub_pos + 1 + idx
            if abs_idx < boundary:
                boundary = abs_idx

    result: dict[str, dict[str, str]] = {}
    for i, (key, pos, matched_title, is_skip) in enumerate(title_positions):
        if is_skip:
            continue
        content_start = pos + len(matched_title)
        if i + 1 < len(title_positions):
            content_end = title_positions[i + 1][1]
        else:
            content_end = min(boundary, len(body))
        raw_content = body[content_start:content_end].strip()
        clean_content = _clean_content(raw_content)
        result[key] = {"title": subsections[key], "content": clean_content}

    return result


def _clean_content(content: str) -> str:
    lines = content.split('\n')
    cleaned = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            cleaned.append('')
            continue
        if not _is_valid_content_line(stripped):
            continue
        cleaned.append(stripped)
    return '\n'.join(cleaned).strip()


def extract_all_subsections_with_content(
    text: str,
    subsections: dict[str, str],
    max_chapter: int = 3,
) -> dict[str, dict[str, str]]:
    subsection_keys = sorted(
        [k for k in subsections if "." in k and int(k.split(".")[0]) <= max_chapter],
        key=_parse_key_tuple,
    )
    if not subsection_keys:
        return {}

    all_keys = sorted(
        [k for k in subsections if "." not in k or int(k.split(".")[0]) <= max_chapter],
        key=_sort_key,
    )
    result = _extract_body_by_title(text, {k: subsections[k] for k in all_keys})
    return {k: v for k, v in result.items() if k in subsection_keys}


def check_toc_body_consistency(text: str, subsections: dict[str, str], max_chapter: int = 3) -> dict | None:
    """检查第3章从3.4开始的目录小节是否都提取到了正文内容（排除错误信息等无需提取的标题）"""
    SKIP_TITLES = {"错误信息", "错误信息(可选)", "错误信息（可选）"}
    subsection_keys = sorted(
        [k for k in subsections
         if "." in k
         and int(k.split(".")[0]) == max_chapter
         and _parse_key_tuple(k) >= (3, 4)
         and subsections.get(k, "") not in SKIP_TITLES],
        key=_parse_key_tuple,
    )
    if not subsection_keys:
        return None

    result = _extract_body_by_title(text, subsections)
    extracted_keys = set(result.keys())
    missing = [k for k in subsection_keys if k not in extracted_keys]

    if missing:
        return {
            "total_expected": len(subsection_keys),
            "total_extracted": len(subsection_keys) - len(missing),
            "missing": missing,
            "missing_titles": {k: subsections[k] for k in missing},
        }
    return None
