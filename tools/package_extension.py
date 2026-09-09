#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
项目管理工具（浏览器插件）打包脚本

把 filechecker-extension/ 打包为带密码的 7z 归档：
    python3 tools/package_extension.py                                # 插件包（日常发版，不含后端/wheels）
    python3 tools/package_extension.py --with-backend                 # 完整包（插件+后端源码+安装脚本）
    python3 tools/package_extension.py --with-backend --with-wheels   # 首次发布完整包（含离线 wheels）

输出：<项目根>/项目管理工具_v<版本>_插件.7z 或 项目管理工具_v<版本>_完整包.7z（密码 1234）
依赖：7z 命令行工具（brew install p7zip）；无 7z 时回退 Python py7zr 库。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys

EXTENSION_NAME = "filechecker-extension"
DEFAULT_PASSWORD = "1234"
EXCLUDE_FILES = {".DS_Store", "Thumbs.db", ".gitignore", "history.db", "package_extension.py"}
EXCLUDE_DIRS = {"__pycache__", ".git", ".claude", "node_modules", "temp_uploads", "collect_data",
                "venv", "dist", "build"}
EXCLUDE_SUFFIXES = (".pyc", ".log", ".7z", ".zip", ".spec")


def get_root() -> str:
    """项目根（filechecker-extension 的上级目录）"""
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def collect_files(base: str, rel_dir: str = "") -> list[str]:
    """收集 base/rel_dir 下待打包文件（相对 base 的路径列表）"""
    items = []
    cur = os.path.join(base, rel_dir) if rel_dir else base
    for name in sorted(os.listdir(cur)):
        rel = os.path.join(rel_dir, name) if rel_dir else name
        if os.path.isdir(os.path.join(base, rel)):
            if name in EXCLUDE_DIRS:
                continue
            items.extend(collect_files(base, rel))
        else:
            if name in EXCLUDE_FILES or name.endswith(EXCLUDE_SUFFIXES):
                continue
            items.append(rel)
    return items


def pack_with_7z_cli(files: list[str], ext_dir: str, target: str, password: str) -> bool:
    sevenz = shutil.which("7z") or shutil.which("7za")
    if not sevenz:
        return False
    cmd = [sevenz, "a", "-t7z", target, *files,
           f"-p{password}", "-mhe=on", "-mx=7"]
    r = subprocess.run(cmd, cwd=ext_dir, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-800:] or r.stderr[-800:])
        sys.exit("[错误] 7z 打包失败")
    return True


def pack_with_py7zr(files: list[str], ext_dir: str, target: str, password: str) -> bool:
    try:
        import py7zr
    except ImportError:
        return False
    with py7zr.SevenZipFile(target, "w", password=password, header_encryption=True) as zf:
        for rel in files:
            zf.write(os.path.join(ext_dir, rel), arcname=rel)
    return True


def verify(target: str, password: str, expect_min_files: int = 1) -> int:
    """校验归档可用性，返回文件数"""
    sevenz = shutil.which("7z") or shutil.which("7za")
    r = subprocess.run([sevenz, "t", f"-p{password}", target],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("[错误] 归档校验失败（密码或文件损坏）")
    l = subprocess.run([sevenz, "l", f"-p{password}", "-slt", target],
                       capture_output=True, text=True)
    count = l.stdout.count("Path = ")
    if count < expect_min_files:
        sys.exit(f"[错误] 归档内文件数异常：{count}")
    return count


def main():
    parser = argparse.ArgumentParser(description="项目管理工具插件打包（7z 加密）")
    parser.add_argument("--version", default=None, help="版本号（默认读取 manifest.json）")
    parser.add_argument("--password", default=DEFAULT_PASSWORD, help=f"7z 密码（默认 {DEFAULT_PASSWORD}）")
    parser.add_argument("--with-backend", action="store_true", help="同时打包 tools/backend 统一后端源码")
    parser.add_argument("--with-wheels", action="store_true",
                        help="完整包附带离线 wheels（仅首次发布需要；需配合 --with-backend）")
    args = parser.parse_args()

    root = get_root()
    ext_dir = os.path.join(root, EXTENSION_NAME)
    if not os.path.isdir(ext_dir):
        sys.exit(f"[错误] 未找到插件目录：{ext_dir}")

    # 版本号：以 manifest.json 为准
    with open(os.path.join(ext_dir, "manifest.json"), encoding="utf-8") as f:
        manifest_version = json.load(f)["version"]
    version = args.version or manifest_version
    if args.version and args.version != manifest_version:
        print(f"[警告] 指定版本 {args.version} 与 manifest.json 中 {manifest_version} 不一致，"
              f"请先更新 manifest.json 再打包（本次按 {manifest_version} 打包）")
        version = manifest_version

    # 收集文件
    files = collect_files(ext_dir)
    if not args.with_backend:
        files = [f for f in files if not f.startswith("tools")]
    elif not args.with_wheels:
        # 完整包默认不带离线 wheels（仅首次发布用 --with-wheels 携带）
        files = [f for f in files if not f.startswith("tools/backend/wheels")]
    if not files:
        sys.exit("[错误] 没有可打包的文件")

    pkg_kind = "完整包" if args.with_backend else "插件"
    target = os.path.join(root, f"项目管理工具_v{version}_{pkg_kind}.7z")
    if os.path.exists(target):
        os.remove(target)

    print("=" * 60)
    print("  项目管理工具（浏览器插件）打包")
    print("=" * 60)
    print(f"  版本号: v{version}（manifest.json）")
    print(f"  插件目录: {ext_dir}")
    print(f"  文件数量: {len(files)} 个（{pkg_kind}" + ("，含离线 wheels）" if args.with_backend and args.with_wheels else ("，不含 wheels）" if args.with_backend else "）")))
    print(f"  压缩密码: {args.password}（AES-256 + 文件名加密）")
    print()

    # 打包：优先 7z CLI，回退 py7zr
    if pack_with_7z_cli(files, ext_dir, target, args.password):
        print("[1/2] ✓ 已用 7z CLI 完成压缩")
    elif pack_with_py7zr(files, ext_dir, target, args.password):
        print("[1/2] ✓ 已用 py7zr 完成压缩")
    else:
        sys.exit("[错误] 本机缺少 7z 工具与 py7zr 库。请执行：brew install p7zip 或 pip3 install py7zr")

    # 校验
    print("[2/2] ✓ 归档完整性/密码校验通过")
    count = verify(target, args.password)
    size_mb = os.path.getsize(target) / 1024 / 1024

    print()
    print("=" * 60)
    print(f"  ✅ 打包完成：{target}")
    print(f"     归档内文件 {count} 个 | 大小 {size_mb:.1f} MB")
    print()
    print("  使用方式：")
    print(f"    1. 用 7-Zip/WinRAR 解压（密码：{args.password}）")
    print("    2. Chrome/Edge → 扩展管理 → 开发者模式 → 加载已解压的扩展程序")
    print("    3. 选择解压出的文件夹（含 manifest.json）")
    print("=" * 60)


if __name__ == "__main__":
    main()
