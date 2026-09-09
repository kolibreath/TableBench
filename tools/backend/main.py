import sys
import os

from parser import extract_text_from_wps, parse_toc_structure, extract_all_subsections_with_content


def main():
    if len(sys.argv) < 2:
        print("用法: python main.py <wps_file_path>")
        sys.exit(1)

    file_path = sys.argv[1]

    if not os.path.isfile(file_path):
        print(f"错误: 文件不存在 - {file_path}")
        sys.exit(1)

    try:
        text = extract_text_from_wps(file_path)
    except Exception as e:
        print(f"错误: 无法提取文本 - {e}")
        sys.exit(1)

    if not text:
        print("警告: 文档中未提取到任何文本内容。")
        sys.exit(0)

    try:
        subsections = parse_toc_structure(text)
    except Exception as e:
        print(f"错误: 解析文档目录失败 - {e}")
        sys.exit(1)

    if not subsections:
        print("未解析到任何目录章节。")
        sys.exit(0)

    print("=" * 50)
    print("文档目录结构")
    print("=" * 50)
    for key in sorted(subsections.keys(), key=lambda k: (int(k.split(".")[0]), float(k) if "." in k else 0)):
        value = subsections[key]
        print(f"\n[{key}]")
        print(value)

    print(f"\n共提取到 {len(subsections)} 个章节/子节")

    print("\n" + "=" * 50)
    print("功能需求子节正文内容")
    print("=" * 50)
    try:
        sections_with_content = extract_all_subsections_with_content(text, subsections)
    except Exception as e:
        print(f"错误: 提取子节内容失败 - {e}")
        sys.exit(1)

    for key, item in sections_with_content.items():
        print(f"\n--- [{key}] {item['title']} ---")
        content = item['content'].strip()
        if content:
            print(content[:500])
            if len(content) > 500:
                print(f"\n...（共 {len(content)} 字符，仅显示前 500 字符）")
        else:
            print("（无内容）")


if __name__ == "__main__":
    main()
