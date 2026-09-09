"""
版本检查与自动更新核心模块

功能：
  - 读取本地版本信息
  - 从内网 Git Releases API 获取最新版本（Cookie 认证）
  - 下载更新包（zip 归档）
  - SHA256 校验
  - 备份当前文件
  - 解压替换
  - 生成重启脚本（Windows exe）
  - 回滚到备份
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import zipfile
from html.parser import HTMLParser
from urllib.parse import urljoin

import requests

# V3.0 统一后端 exe 名称（安装脚本/协议注册/更新重启均以此为准）
BACKEND_EXE_NAME = "项目管理工具后端.exe"
# 兼容 V2 时代旧备份文件的识别前缀
_LEGACY_EXE_BACKUP_PREFIX = "wps_server_backup_"
_EXE_BACKUP_PREFIX = "backend_backup_"

# ── 全局更新状态（线程安全）───────────────────────────────
_update_lock = threading.Lock()
_update_state: dict = {
    "phase": "idle",           # idle → checking → downloading → verifying → backing_up
                               # → installing → cleaning → success / error / restarting
    "progress_percent": 0,
    "stage_message": "",
    "detail_message": "",
    "error_code": None,
    "error_message": "",
    "can_retry": True,
    "last_check_time": None,
    "last_update_time": None,
}


def _set_state(phase: str, progress: int, stage: str,
               detail: str = "", error_code: str = None,
               error_message: str = "", can_retry: bool = True):
    """线程安全地更新全局状态"""
    with _update_lock:
        _update_state["phase"] = phase
        _update_state["progress_percent"] = progress
        _update_state["stage_message"] = stage
        _update_state["detail_message"] = detail
        _update_state["error_code"] = error_code
        _update_state["error_message"] = error_message
        _update_state["can_retry"] = can_retry
        if phase == "success" or phase == "error":
            _update_state["last_update_time"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_update_state() -> dict:
    """获取当前更新状态的副本"""
    with _update_lock:
        return dict(_update_state)


def reset_update_state():
    """重置更新状态（更新完成后调用）"""
    with _update_lock:
        _update_state["phase"] = "idle"
        _update_state["progress_percent"] = 0
        _update_state["stage_message"] = ""
        _update_state["detail_message"] = ""
        _update_state["error_code"] = None
        _update_state["error_message"] = ""
        _update_state["can_retry"] = True


# ── 路径工具函数 ──────────────────────────────────────────

def _get_base_dir() -> str:
    """获取 backend 目录路径，兼容 PyInstaller 打包和源码运行"""
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后，version.json 放在 exe 所在目录
        return os.path.dirname(sys.executable)
    else:
        return os.path.dirname(os.path.abspath(__file__))


def _find_version_file() -> str:
    """定位 version.json"""
    base = _get_base_dir()
    path = os.path.join(base, "version.json")
    if not os.path.exists(path):
        # PyInstaller 打包后在 _MEIPASS 中查找
        if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
            path = os.path.join(sys._MEIPASS, "version.json")
    return path


def _find_config_file() -> str:
    """定位 update_config.json"""
    base = _get_base_dir()
    path = os.path.join(base, "update_config.json")
    if not os.path.exists(path):
        if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
            path = os.path.join(sys._MEIPASS, "update_config.json")
    return path


def _resolve_frontend_dir(config: dict) -> str:
    """解析前端目录路径，自动适配源码和 exe 两种部署模式

    源码模式: _get_base_dir()=backend/  → ../frontend → 项目根/frontend
    exe 模式: _get_base_dir()=deploy/   → ../frontend → 上级目录/frontend (错误!)
                                        → frontend     → deploy/frontend   (正确)

    自动探测: 按配置路径 → exe同级frontend → ./frontend 的顺序尝试
    """
    base = _get_base_dir()
    configured = config.get("frontend_target_path", "../frontend")
    candidates = [configured]

    # exe 模式下追加备选路径
    if getattr(sys, 'frozen', False):
        candidates.extend(["frontend", "./frontend"])
    else:
        candidates.extend(["./frontend", "frontend"])

    for rel in candidates:
        resolved = os.path.normpath(os.path.join(base, rel))
        if os.path.isdir(resolved):
            return resolved

    # 全部未命中，返回配置路径（后续代码会报目录不存在）
    return os.path.normpath(os.path.join(base, configured))


def _get_backup_dir() -> str:
    """获取备份目录路径"""
    base = _get_base_dir()
    backup_dir = os.path.join(base, "update_backups")
    os.makedirs(backup_dir, exist_ok=True)
    return backup_dir


def _get_temp_dir() -> str:
    """获取临时下载目录"""
    base = _get_base_dir()
    temp_dir = os.path.join(base, "temp_updates")
    os.makedirs(temp_dir, exist_ok=True)
    return temp_dir


# ── 版本号解析与比较 ──────────────────────────────────────

def parse_version(v: str) -> tuple:
    """将版本字符串解析为可比较的元组

    '2.1.0.1'   → (2, 1, 0, 1)
    'v2.1.0.2'  → (2, 1, 0, 2)
    'V0.0.1.7'  → (0, 0, 1, 7)
    """
    stripped = v.lstrip('v').lstrip('V')
    parts = re.split(r'[.\-_]', stripped)
    return tuple(int(p) for p in parts if p.isdigit())


def is_newer(remote_version: str, local_version: str) -> bool:
    """远程版本是否比本地版本新"""
    try:
        return parse_version(remote_version) > parse_version(local_version)
    except (ValueError, IndexError):
        return False


# ── 本地版本读取 ──────────────────────────────────────────

def read_local_version() -> dict:
    """读取本地 version.json"""
    path = _find_version_file()
    if not os.path.exists(path):
        return {"version": "0.0.0.0"}
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _write_local_version(version: str):
    """将新版本号写入本地 version.json"""
    version_path = _find_version_file()
    try:
        with open(version_path, 'w', encoding='utf-8') as f:
            json.dump({"version": version}, f)
    except IOError as e:
        print(f"[Version] 写入 version.json 失败: {e}")


def read_update_config() -> dict:
    """读取更新配置文件"""
    path = _find_config_file()
    if not os.path.exists(path):
        return {"enabled": False}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {"enabled": False}


# ── HTTP 请求辅助 ─────────────────────────────────────────

def _build_auth_headers(config: dict) -> dict:
    """构建请求头，模拟浏览器请求

    Cookie 从 config['cookie'] 读取，由调用方（server.py）注入。
    """
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Cache-Control": "max-age=0",
        "Connection": "keep-alive",
    }
    cookie = config.get("cookie", "")
    if cookie:
        headers["Cookie"] = cookie
    return headers


def _http_get(url: str, config: dict, timeout: int = 30, stream: bool = False,
              log: bool = False) -> requests.Response | None:
    """带 Cookie 认证的 HTTP GET 请求

    Args:
        log: 是否打印请求/响应报文到控制台
    """
    headers = _build_auth_headers(config)
    try:
        if log:
            print(f"[HTTP] >>> GET {url}")
            print(f"[HTTP] >>> Headers:")
            for k, v in headers.items():
                # Cookie 只打印前 50 字符，防止泄露完整内容
                val = (v[:50] + "...") if k.lower() == "cookie" and len(v) > 50 else v
                print(f"[HTTP] >>>   {k}: {val}")

        resp = requests.get(url, headers=headers, timeout=timeout, stream=stream,
                           allow_redirects=False)

        if log:
            print(f"[HTTP] <<< Status: {resp.status_code} {resp.reason}")
            print(f"[HTTP] <<< Response Headers:")
            for k, v in resp.headers.items():
                print(f"[HTTP] <<<   {k}: {v}")
            content_type = resp.headers.get("Content-Type", "")
            if "text/html" in content_type:
                body_preview = (resp.text or "")[:500]
                print(f"[HTTP] <<< Body (HTML, 前500字符):")
                print(body_preview)
            else:
                body_preview = (resp.text or "")[:300]
                print(f"[HTTP] <<< Body preview: {body_preview}")

        return resp
    except requests.exceptions.ConnectionError as e:
        if log:
            print(f"[HTTP] <<< 连接失败: {e}")
        return None
    except requests.exceptions.Timeout as e:
        if log:
            print(f"[HTTP] <<< 请求超时: {e}")
        return None
    except Exception as e:
        if log:
            print(f"[HTTP] <<< 请求异常: {e}")
        return None


# ── HTML 解析：从 Releases 页面提取下载链接 ──────────────

class _ArchiveLinkParser(HTMLParser):
    """从 Releases 页面 HTML 中提取所有 .zip 归档下载链接

    内网 Git 平台的 releases 页面返回的是 HTML 文档，
    其中包含指向 /archive/{version}.zip 的 <a> 标签。
    """

    def __init__(self, page_url: str):
        super().__init__()
        self.page_url = page_url       # 用于将相对链接转为绝对链接
        self.archive_links: list[dict] = []  # [{url, text, version}]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        if tag.lower() != 'a':
            return

        href = None
        text = ""
        for name, value in attrs:
            if name.lower() == 'href':
                href = value
                break

        if not href:
            return

        # 提取链接文本（在 handle_data 中收集）
        self._current_href = href
        self._current_text = ""

    def handle_data(self, data: str):
        if hasattr(self, '_current_href'):
            self._current_text += data

    def handle_endtag(self, tag: str):
        if tag.lower() != 'a' or not hasattr(self, '_current_href'):
            return

        href = self._current_href
        text = self._current_text.strip()

        # 筛选：URL 中包含 /archive/ 且以 .zip 结尾
        if '/archive/' in href and href.rstrip('/').endswith('.zip'):
            full_url = urljoin(self.page_url, href)
            version = _extract_version_from_url(full_url)
            self.archive_links.append({
                "url": full_url,
                "text": text or os.path.basename(full_url),
                "version": version,
            })

        del self._current_href
        del self._current_text


def _extract_version_from_url(url: str) -> str:
    """从归档下载 URL 中提取版本号

    示例:
        .../archive/v2.1.0.2.zip → 2.1.0.2
        .../archive/2.1.0.2.zip  → 2.1.0.2
        .../archive/master.zip   → master
    """
    basename = os.path.basename(url)
    # 去掉 .zip 后缀
    name = basename.rsplit('.', 1)[0] if '.' in basename else basename
    # 提取版本号部分
    match = re.search(r'((?:v|V)?\d+\.\d+\.\d+(?:\.\d+)?)', name)
    if match:
        return match.group(1).lstrip('v').lstrip('V')
    return name


# ── 远程版本检查（HTML Releases 页面）────────────────────

def fetch_releases(config: dict) -> list[dict] | None:
    """请求内网 Git 平台的 Releases 页面，从 HTML 中解析 .zip 下载链接

    Returns:
        成功返回 [{url, text, version}, ...]，失败返回 None
    """
    releases_url = config.get("releases_api_url", "")
    if not releases_url:
        return None

    cookie = config.get("cookie", "")
    if not cookie:
        print("[Releases] Cookie 未配置")
        return None

    resp = _http_get(releases_url, config, timeout=30, log=True)
    if resp is None:
        print("[Releases] HTTP 请求失败：无法连接到 " + releases_url)
        return None

    if resp.status_code == 401 or resp.status_code == 403:
        print(f"[Releases] 认证失败 (HTTP {resp.status_code})，Cookie 可能已过期")
        return None

    if resp.status_code in (301, 302):
        print(f"[Releases] 被重定向 (HTTP {resp.status_code})，可能需要登录")
        return None

    if resp.status_code != 200:
        print(f"[Releases] 服务器返回异常状态码: HTTP {resp.status_code}")
        return None

    releases = _parse_releases_html(resp.text, releases_url)
    if releases:
        print(f"[Releases] 找到 {len(releases)} 个版本: "
              f"{', '.join(r['version'] for r in releases[:5])}")
    else:
        print("[Releases] 页面中未找到 /archive/ 下载链接")

    return releases


def check_for_update(config: dict) -> dict:
    """从 Releases 页面 HTML 中解析最新版本并比较

    Returns:
        { update_available, current_version, latest_version,
          download_url, changelog, package_size, error }
    """
    if not config.get("enabled", False):
        return {
            "update_available": False,
            "current_version": "0.0.0.0",
            "latest_version": None,
            "download_url": None,
            "changelog": [],
            "package_size": 0,
            "error": "更新功能未启用",
        }

    _set_state("checking", 0, "正在连接更新服务器...")

    local = read_local_version()

    # 逐步诊断，返回精确的错误信息
    error_msg = _diagnose(config)
    releases = _fetch_releases_from_diagnosis(config)

    with _update_lock:
        _update_state["last_check_time"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if error_msg:
        _set_state("idle", 0, "",
                   error_code="NETWORK_UNREACHABLE",
                   error_message=error_msg)
        return {
            "update_available": False,
            "current_version": local.get("version", "0.0.0.0"),
            "latest_version": None,
            "download_url": None,
            "changelog": [],
            "package_size": 0,
            "error": error_msg,
        }

    if releases is None or len(releases) == 0:
        _set_state("idle", 0, "")
        return {
            "update_available": False,
            "current_version": local.get("version", "0.0.0.0"),
            "latest_version": None,
            "download_url": None,
            "changelog": [],
            "package_size": 0,
            "error": None,
        }

    latest = releases[0]
    remote_version = latest["version"]
    available = is_newer(remote_version, local.get("version", "0.0.0.0"))

    _set_state("idle", 0, "")

    return {
        "update_available": available,
        "current_version": local.get("version", "0.0.0.0"),
        "latest_version": remote_version,
        "download_url": latest["url"] if available else None,
        "changelog": [f"文件名: {latest['text']}"] if available else [],
        "package_size": 0,
        "error": None,
    }


def _diagnose(config: dict) -> str | None:
    """诊断版本检查链路，返回错误信息（None 表示链路正常）"""
    # 1. Cookie
    cookie = config.get("cookie", "")
    if not cookie:
        return "Cookie 未配置，请在 server.py 中设置 COOKIE 变量"

    # 2. HTTP 请求
    releases_url = config.get("releases_api_url", "")
    resp = _http_get(releases_url, config, timeout=30, log=True)
    if resp is None:
        return f"无法连接 {releases_url}，请检查网络或 releases_api_url 配置"
    if resp.status_code in (401, 403):
        return f"认证失败 (HTTP {resp.status_code})，Cookie 可能已过期，请重新获取"
    if resp.status_code in (301, 302):
        return f"请求被重定向 (HTTP {resp.status_code})，可能需要先登录获取有效 Cookie"
    if resp.status_code != 200:
        return f"服务器返回异常 (HTTP {resp.status_code})"

    # 3. 解析
    releases = _parse_releases_html(resp.text, releases_url)
    if releases is None or len(releases) == 0:
        return "Releases 页面中未找到 /archive/ 开头的 .zip 下载链接，请检查页面内容"

    return None  # 链路正常


def _parse_releases_html(html: str, page_url: str) -> list[dict] | None:
    """从 HTML 中解析 archive 下载链接（不发起网络请求）"""
    if not html:
        return None
    parser = _ArchiveLinkParser(page_url)
    try:
        parser.feed(html)
    except Exception as e:
        print(f"[Releases] HTML 解析失败: {e}")
        return None

    links = parser.archive_links
    if not links:
        return None

    def _sort_key(link: dict) -> tuple:
        try:
            return parse_version(link["version"])
        except (ValueError, IndexError):
            return (0,)

    links.sort(key=_sort_key, reverse=True)
    return links


def _fetch_releases_from_diagnosis(config: dict) -> list[dict] | None:
    """仅在诊断通过后调用，发起请求并解析 HTML"""
    releases_url = config.get("releases_api_url", "")
    resp = _http_get(releases_url, config, timeout=30, log=True)
    if resp is None or resp.status_code != 200:
        return None
    return _parse_releases_html(resp.text, releases_url)


# ── 文件校验 ──────────────────────────────────────────────

def compute_sha256(filepath: str) -> str:
    """计算文件的 SHA256 哈希值"""
    sha = hashlib.sha256()
    try:
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha.update(chunk)
        return sha.hexdigest()
    except IOError:
        return ""


def verify_checksum(filepath: str, expected_sha256: str) -> bool:
    """校验下载文件的 SHA256

    Args:
        filepath: 待校验文件路径
        expected_sha256: 期望的 SHA256 值（为空则跳过校验）

    Returns:
        True 如果校验通过或无需校验，False 如果校验失败
    """
    if not expected_sha256:
        return True  # 未配置校验则跳过

    actual = compute_sha256(filepath)
    if not actual:
        return False  # 读取文件失败

    return actual.lower() == expected_sha256.lower()


# ── 备份与恢复 ────────────────────────────────────────────

def _format_size(size_bytes: int) -> str:
    """格式化文件大小"""
    for unit in ("B", "KB", "MB", "GB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} GB"


def backup_frontend(config: dict) -> str | None:
    """备份当前前端文件

    Returns:
        备份目录路径，失败返回 None
    """
    frontend_dir = _resolve_frontend_dir(config)

    if not os.path.isdir(frontend_dir):
        print(f"[Backup] 前端目录不存在，无法备份")
        print(f"[Backup]   _get_base_dir() = {_get_base_dir()}")
        print(f"[Backup]   frontend_target_path = {config.get('frontend_target_path', '../frontend')}")
        print(f"[Backup]   解析后的路径 = {frontend_dir}")
        print(f"[Backup]   sys.frozen = {getattr(sys, 'frozen', False)}")
        if getattr(sys, 'frozen', False):
            print(f"[Backup]   sys.executable = {sys.executable}")
        _set_state("error", 0, "备份失败，更新已中止",
                   error_code="BACKUP_FAILED",
                   error_message=f"前端目录不存在: {frontend_dir}")
        return None

    backup_base = _get_backup_dir()
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(backup_base, f"frontend_backup_{timestamp}")

    try:
        shutil.copytree(frontend_dir, backup_path, ignore=shutil.ignore_patterns(
            'temp_updates', 'update_backups', '__pycache__', '.git'))
        return backup_path
    except (OSError, shutil.Error) as e:
        print(f"[Backup] 备份失败: {e}")
        print(f"[Backup]   源目录: {frontend_dir}")
        print(f"[Backup]   目标目录: {backup_path}")
        import traceback
        traceback.print_exc()
        _set_state("error", 0, "备份失败，更新已中止",
                   error_code="BACKUP_FAILED",
                   error_message=f"无法备份当前版本: {str(e)}")
        return None


def backup_backend_exe() -> str | None:
    """备份当前后端 exe"""
    base = _get_base_dir()
    exe_path = os.path.join(base, BACKEND_EXE_NAME)
    if not os.path.exists(exe_path):
        return None  # 非 exe 模式，无需备份

    backup_base = _get_backup_dir()
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(backup_base, f"{_EXE_BACKUP_PREFIX}{timestamp}.exe")

    try:
        shutil.copy2(exe_path, backup_path)
        return backup_path
    except OSError as e:
        return None


def cleanup_old_backups(keep_count: int = 3):
    """清理旧备份，只保留最近 N 个"""
    backup_dir = _get_backup_dir()
    if not os.path.isdir(backup_dir):
        return

    # 获取所有备份并按时间排序
    frontend_backups = []
    exe_backups = []
    for name in os.listdir(backup_dir):
        full = os.path.join(backup_dir, name)
        mtime = os.path.getmtime(full)
        if name.startswith("frontend_backup_"):
            frontend_backups.append((mtime, full))
        elif name.startswith(_EXE_BACKUP_PREFIX) or name.startswith(_LEGACY_EXE_BACKUP_PREFIX):
            exe_backups.append((mtime, full))

    # 分别清理
    for backups in (frontend_backups, exe_backups):
        backups.sort(key=lambda x: x[0], reverse=True)  # 按时间倒序
        for _, path in backups[keep_count:]:
            try:
                if os.path.isdir(path):
                    shutil.rmtree(path)
                else:
                    os.remove(path)
            except OSError:
                pass


def list_backups() -> list[dict]:
    """列出所有可用备份"""
    backup_dir = _get_backup_dir()
    if not os.path.isdir(backup_dir):
        return []

    backups = []
    for name in os.listdir(backup_dir):
        full = os.path.join(backup_dir, name)
        mtime = os.path.getmtime(full)
        size = 0
        if os.path.isdir(full):
            for root, _, files in os.walk(full):
                for f in files:
                    try:
                        size += os.path.getsize(os.path.join(root, f))
                    except OSError:
                        pass
        else:
            try:
                size = os.path.getsize(full)
            except OSError:
                pass

        backups.append({
            "id": name,
            "path": full,
            "date": datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S"),
            "size": size,
            "size_display": _format_size(size),
            "type": "frontend" if name.startswith("frontend_") else "backend",
        })

    backups.sort(key=lambda b: b["date"], reverse=True)
    return backups


def rollback_to_backup(backup_id: str) -> dict:
    """回滚到指定备份

    Args:
        backup_id: 备份目录名或文件名

    Returns:
        {"status": "rolled_back" | "error", "message": str}
    """
    backup_dir = _get_backup_dir()
    backup_path = os.path.join(backup_dir, backup_id)

    if not os.path.exists(backup_path):
        return {"status": "error", "message": f"备份不存在: {backup_id}"}

    base = _get_base_dir()

    try:
        if backup_id.startswith("frontend_"):
            # 恢复前端
            config = read_update_config()
            target = _resolve_frontend_dir(config)

            # 删除当前前端文件
            if os.path.isdir(target):
                for item in os.listdir(target):
                    item_path = os.path.join(target, item)
                    if 'backup' not in item.lower() and 'temp_update' not in item.lower():
                        if os.path.isdir(item_path):
                            shutil.rmtree(item_path)
                        else:
                            os.remove(item_path)

            # 从备份恢复
            for item in os.listdir(backup_path):
                src = os.path.join(backup_path, item)
                dst = os.path.join(target, item)
                if os.path.isdir(src):
                    if os.path.exists(dst):
                        shutil.rmtree(dst)
                    shutil.copytree(src, dst)
                else:
                    shutil.copy2(src, dst)

            return {"status": "rolled_back", "message": f"前端已回滚到备份: {backup_id}"}

        elif backup_id.startswith(_EXE_BACKUP_PREFIX) or backup_id.startswith(_LEGACY_EXE_BACKUP_PREFIX):
            # 恢复后端 exe
            exe_path = os.path.join(base, BACKEND_EXE_NAME)
            # 备份当前 exe
            if os.path.exists(exe_path):
                shutil.copy2(exe_path, exe_path + ".pre_rollback")
            shutil.copy2(backup_path, exe_path)
            return {"status": "rolled_back", "message": f"后端已回滚到备份: {backup_id}，请重启服务"}

        else:
            return {"status": "error", "message": f"未知备份类型: {backup_id}"}

    except (OSError, shutil.Error) as e:
        return {"status": "error", "message": f"回滚失败: {str(e)}"}


# ── 下载更新包 ────────────────────────────────────────────

def download_archive(download_url: str, config: dict) -> str | None:
    """下载更新包

    下载过程中实时更新全局状态，支持进度报告。

    Args:
        download_url: zip 下载链接
        config: 更新配置

    Returns:
        下载文件路径，失败返回 None
    """
    if not download_url:
        _set_state("error", 0, "更新包地址未配置",
                   error_code="CONFIG_ERROR",
                   error_message="更新包下载地址未配置，请联系管理员")
        return None

    temp_dir = _get_temp_dir()
    zip_path = os.path.join(temp_dir, "update_package.zip")

    resp = _http_get(download_url, config, timeout=120, stream=True)
    if resp is None:
        _set_state("error", 0, "下载失败",
                   error_code="NETWORK_UNREACHABLE",
                   error_message="无法连接更新服务器，请检查网络连接")
        return None

    if resp.status_code != 200:
        _set_state("error", 0, "下载失败",
                   error_code="SERVER_ERROR",
                   error_message=f"更新服务器返回异常 (HTTP {resp.status_code})")
        return None

    try:
        total_size = int(resp.headers.get('content-length', 0))
        downloaded = 0
        start_time = time.time()

        with open(zip_path, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)

                    if total_size > 0:
                        percent = int(downloaded * 100 / total_size)
                        elapsed = time.time() - start_time
                        speed = downloaded / elapsed if elapsed > 0 else 0

                        detail = (f"{_format_size(downloaded)} / {_format_size(total_size)}"
                                  f"  ({_format_size(int(speed))}/s)")

                        _set_state("downloading", percent, "正在下载更新包...", detail=detail)
                    else:
                        # 未知总大小，仍然报告已下载量
                        detail = f"已下载 {_format_size(downloaded)}"
                        _set_state("downloading", 0, "正在下载更新包...", detail=detail)

        if total_size > 0 and downloaded < total_size:
            _set_state("error", 0, "下载失败",
                       error_code="DOWNLOAD_INCOMPLETE",
                       error_message="下载不完整，请重试",
                       can_retry=True)
            return None

        return zip_path

    except Exception as e:
        _set_state("error", 0, "下载失败",
                   error_code="DOWNLOAD_FAILED",
                   error_message=f"下载过程中出错: {str(e)}")
        # 清理不完整的文件
        if os.path.exists(zip_path):
            try:
                os.remove(zip_path)
            except OSError:
                pass
        return None


# ── 安装更新 ──────────────────────────────────────────────

def _extract_and_replace_frontend(zip_ref: zipfile.ZipFile, config: dict):
    """从 zip 中解压 frontend/ 目录并覆盖到目标路径"""
    target_dir = _resolve_frontend_dir(config)

    # 确保目标目录存在
    os.makedirs(target_dir, exist_ok=True)

    # 收集 zip 中 frontend 下的所有文件，处理嵌套路径
    all_names = zip_ref.namelist()
    frontend_members = []
    strip_prefix = ""  # 需要从路径开头去掉的前缀

    # 尝试匹配: frontend/ 或 frontend2/
    direct = [m for m in all_names if m.startswith("frontend/") or m.startswith("frontend2/")]
    if direct:
        frontend_members = direct
        strip_prefix = "frontend/" if any(m.startswith("frontend/") for m in direct) else "frontend2/"
    else:
        # 尝试匹配: */frontend/ 或 */frontend2/ (如 filechecker/frontend/...)
        for prefix_candidate in ("frontend/", "frontend2/"):
            nested = [m for m in all_names if prefix_candidate in m and not m.startswith("backend/")]
            if nested:
                # 找到第一个匹配的路径，提取外层包装目录
                sample = nested[0]
                idx = sample.find(prefix_candidate)
                outer = sample[:idx]  # 外层目录，如 "filechecker/"
                frontend_members = nested
                strip_prefix = outer + prefix_candidate  # "filechecker/frontend/"
                print(f"[Extract] 检测到嵌套 zip 结构，外层: \"{outer}\", 前缀: \"{strip_prefix}\"")
                break

    if not frontend_members:
        # 最后兜底：排除 backend/ 和后端 exe 的所有文件
        frontend_members = [
            m for m in all_names
            if not m.startswith("backend/") and os.path.basename(m) != BACKEND_EXE_NAME
            and os.path.basename(m) != "wps_server.exe"
            and not m.endswith('/')
        ]
        strip_prefix = ""

    for member in frontend_members:
        # 跳过 zip 中的目录条目（如 vendor/），目录由 os.makedirs 自动创建
        if member.endswith('/') or member.endswith('\\'):
            continue

        # 计算相对路径（去除外层目录和 frontend/ 前缀）
        if strip_prefix and member.startswith(strip_prefix):
            rel_path = member[len(strip_prefix):]
        else:
            rel_path = member

        if not rel_path:
            continue

        target_path = os.path.join(target_dir, rel_path)

        # 确保父目录存在
        os.makedirs(os.path.dirname(target_path), exist_ok=True)

        # 解压文件
        with zip_ref.open(member) as src:
            with open(target_path, 'wb') as dst:
                shutil.copyfileobj(src, dst)


def _extract_and_replace_backend_exe(zip_ref: zipfile.ZipFile):
    """从 zip 中解压后端 exe（兼容旧包中的 wps_server.exe）"""
    # 查找后端 exe
    exe_member = None
    for name in zip_ref.namelist():
        if name.endswith(BACKEND_EXE_NAME) or name.endswith("wps_server.exe"):
            exe_member = name
            break

    if not exe_member:
        return  # zip 中不包含 exe，仅更新前端

    base = _get_base_dir()
    # 先保存为新文件名，等重启脚本替换
    new_exe_path = os.path.join(base, "backend_new.exe")

    with zip_ref.open(exe_member) as src:
        with open(new_exe_path, 'wb') as dst:
            shutil.copyfileobj(src, dst)

    return new_exe_path


def _generate_restart_script(exe_dir: str, new_exe_path: str):
    """生成 Windows 重启批处理脚本

    在进程退出后替换 exe 并启动新进程。
    macOS/Linux 下生成 shell 脚本。
    """
    if os.name == 'nt':
        script = f'''@echo off
chcp 65001 >nul
echo 项目管理工具 正在重启服务...
timeout /t 3 /nobreak >nul
taskkill /f /im {BACKEND_EXE_NAME} 2>nul
timeout /t 2 /nobreak >nul
move /y "{new_exe_path}" "{exe_dir}\\{BACKEND_EXE_NAME}"
if %errorlevel% neq 0 (
    echo 替换 exe 失败，请手动将 {new_exe_path} 替换为 {BACKEND_EXE_NAME}
    pause
    exit /b 1
)
echo 正在启动新版本...
start "" "{exe_dir}\\{BACKEND_EXE_NAME}"
timeout /t 2 /nobreak >nul
del "%~f0" 2>nul
'''
        bat_path = os.path.join(exe_dir, "restart.bat")
        with open(bat_path, 'w', encoding='utf-8') as f:
            f.write(script)
        # 启动批处理（新控制台窗口）
        subprocess.Popen(
            ['cmd', '/c', 'start', '项目管理工具 更新重启', 'cmd', '/c', bat_path],
            cwd=exe_dir,
            creationflags=subprocess.CREATE_NEW_CONSOLE if hasattr(subprocess, 'CREATE_NEW_CONSOLE') else 0,
        )
    else:
        # macOS / Linux
        script = f'''#!/bin/bash
sleep 3
if [ -f "{new_exe_path}" ]; then
    mv -f "{new_exe_path}" "{exe_dir}/backend"
    chmod +x "{exe_dir}/backend"
fi
echo "正在启动新版本..."
"{exe_dir}/backend" &
rm -f "$0"
'''
        sh_path = os.path.join(exe_dir, "restart.sh")
        with open(sh_path, 'w') as f:
            f.write(script)
        os.chmod(sh_path, 0o755)
        subprocess.Popen([sh_path], cwd=exe_dir)


def _has_backend_exe_in_zip(zip_ref: zipfile.ZipFile) -> bool:
    """检查 zip 中是否包含后端 exe（兼容旧包中的 wps_server.exe）"""
    for name in zip_ref.namelist():
        if name.endswith(BACKEND_EXE_NAME) or name.endswith("wps_server.exe"):
            return True
    return False


# ── 主更新流程 ────────────────────────────────────────────

def do_update(config: dict) -> dict:
    """执行完整的更新流程（在后台线程中调用）

    Returns:
        {"status": "started" | "error", "message": str}
    """
    if not config.get("enabled", False):
        return {"status": "error", "message": "更新功能未启用"}

    # 重置状态
    reset_update_state()

    # 在后台线程执行，主线程立即返回
    thread = threading.Thread(target=_do_update_async, args=(config,), daemon=True)
    thread.start()

    return {"status": "started", "message": "更新已开始"}


def _do_update_async(config: dict):
    """后台线程中执行的更新逻辑"""
    verify_enabled = config.get("verify_checksum", True)
    backup_enabled = config.get("backup_before_update", True)
    keep_count = config.get("backup_keep_count", 3)

    try:
        # ═══ Step 1: 获取远程版本信息（从 HTML 页面解析下载链接） ═══
        _set_state("checking", 5, "正在获取远程版本信息...")
        releases = fetch_releases(config)
        expected_hash = ""
        download_url = ""

        if releases and len(releases) > 0:
            latest = releases[0]
            download_url = latest.get("url", "")
            print(f"[Update] 最新版本: {latest['version']}, 下载链接: {download_url}")

        if not download_url:
            _set_state("error", 0, "未找到下载链接",
                       error_code="NO_DOWNLOAD_URL",
                       error_message="Releases 页面中未找到可下载的 zip 包")
            return

        # ═══ Step 2: 下载更新包 ═══
        _set_state("downloading", 10, "正在下载更新包...")
        zip_path = download_archive(download_url, config)
        if zip_path is None:
            return  # 错误已在 download_archive 中设置

        # ═══ Step 3: SHA256 校验 ═══
        if verify_enabled and expected_hash:
            _set_state("verifying", 50, "正在校验文件完整性...")
            if not verify_checksum(zip_path, expected_hash):
                _set_state("error", 0, "文件校验失败",
                           error_code="CHECKSUM_MISMATCH",
                           error_message="文件完整性校验未通过，文件可能已损坏。建议重新下载。")
                try:
                    os.remove(zip_path)
                except OSError:
                    pass
                return
        else:
            # Releases API 未提供 SHA256，跳过校验
            _set_state("verifying", 50, "跳过文件校验（release 未提供校验值）...")

        # ═══ Step 4: 备份当前文件 ═══
        if backup_enabled:
            _set_state("backing_up", 60, "正在备份当前版本...")
            frontend_backup = backup_frontend(config)
            backend_backup = backup_backend_exe()

            if frontend_backup is None:
                # 如果 backup_frontend 内部已设置了具体错误原因，不覆盖
                existing = get_update_state()
                if existing.get("error_code") != "BACKUP_FAILED":
                    _set_state("error", 0, "备份失败，更新已中止",
                               error_code="BACKUP_FAILED",
                               error_message="无法备份当前版本。当前版本文件未被修改，可安全重试。")
                # 清理已下载的 zip
                try:
                    os.remove(zip_path)
                except OSError:
                    pass
                return

        # ═══ Step 5: 解压并安装 ═══
        _set_state("installing", 75, "正在解压更新包...")
        try:
            with zipfile.ZipFile(zip_path, 'r') as zf:
                # 检查是否有后端 exe
                has_exe = _has_backend_exe_in_zip(zf)

                # 替换前端文件
                _set_state("installing", 80, "正在替换前端文件...")
                _extract_and_replace_frontend(zf, config)

                # 替换后端 exe（如果需要）
                new_exe_path = None
                if has_exe:
                    _set_state("installing", 90, "正在准备重启后端服务...")
                    new_exe_path = _extract_and_replace_backend_exe(zf)
        except (zipfile.BadZipFile, OSError) as e:
            _set_state("error", 0, "安装失败",
                       error_code="EXTRACT_FAILED",
                       error_message=f"更新包解压失败: {str(e)}。已自动恢复到更新前版本。")
            # 安装失败时从备份恢复
            _restore_from_latest_backup(config)
            # 清理已下载的 zip
            try:
                os.remove(zip_path)
            except OSError:
                pass
            return

        # Step 5 完成，解压安装成功，立即写入新版本号
        new_version = latest.get("version", "")
        if new_version:
            _write_local_version(new_version)
            print(f"[Update] 本地 version.json 已更新为 {new_version}")

        # ═══ Step 6: 清理临时目录 ═══
        _set_state("cleaning", 95, "正在清理临时文件...")
        # 删除下载临时目录
        temp_dir = _get_temp_dir()
        if os.path.isdir(temp_dir):
            try:
                shutil.rmtree(temp_dir)
                print(f"[Update] 已清理临时目录: {temp_dir}")
            except OSError:
                pass
        # 删除备份目录（更新成功后不再需要回滚备份）
        backup_dir = _get_backup_dir()
        if os.path.isdir(backup_dir):
            try:
                shutil.rmtree(backup_dir)
                print(f"[Update] 已清理备份目录: {backup_dir}")
            except OSError:
                pass

        # ═══ Step 7: 重启（如果有后端更新） ═══
        if new_exe_path and os.path.exists(new_exe_path):
            _set_state("restarting", 100, "后端服务正在重启，预计 5-10 秒...")
            base = _get_base_dir()
            _generate_restart_script(base, new_exe_path)
            # 注意：不在此处设置 success 状态，因为进程即将退出
            # 前端会通过轮询中断检测到 restarting 阶段
        else:
            _set_state("success", 100, "更新完成！",
                       detail="请使用 Ctrl+F5 强制刷新以应用最新版本")

    except Exception as e:
        _set_state("error", 0, "更新过程中发生未知错误",
                   error_code="UNKNOWN_ERROR",
                   error_message=str(e))


def _restore_from_latest_backup(config: dict):
    """从最新备份恢复（安装失败时的自动回滚）"""
    backups = list_backups()
    frontend_backups = [b for b in backups if b["type"] == "frontend"]
    if frontend_backups:
        result = rollback_to_backup(frontend_backups[0]["id"])
        if result["status"] != "rolled_back":
            _set_state("error", 0, "自动恢复失败",
                       error_code="ROLLBACK_FAILED",
                       error_message=f"安装失败后自动恢复也失败: {result['message']}")
    else:
        _set_state("error", 0, "安装失败且无可用备份",
                   error_code="NO_BACKUP",
                   error_message="安装失败，且没有可用的备份来恢复。请联系管理员手动修复。")


# ── 确保运行时配置文件存在（PyInstaller exe 兼容）─────────

def _register_custom_protocol(exe_dir: str):
    """注册 projecttool:// 自定义 URL 协议到 Windows 注册表

    插件页面在后端未启动时通过 projecttool://start 拉起 exe（与 安装后端.bat 一致）。
    协议注册后浏览器会弹出确认对话框，用户确认后启动。
    每次启动都执行覆盖写入，可修正机器上的旧注册（如指向已废弃的 wps_server.exe）。
    """
    if os.name != 'nt':
        return  # 仅 Windows 支持

    exe_path = os.path.join(exe_dir, BACKEND_EXE_NAME)
    if not os.path.exists(exe_path):
        return

    try:
        import winreg
        # 写入 HKEY_CURRENT_USER\Software\Classes，不需要管理员权限
        base = winreg.HKEY_CURRENT_USER
        proto_key = r"Software\Classes\projecttool"
        cmd_key = r"Software\Classes\projecttool\shell\open\command"

        # 检查是否已注册
        try:
            key = winreg.OpenKey(base, cmd_key)
            existing, _ = winreg.QueryValueEx(key, "")
            winreg.CloseKey(key)
            if existing == f'"{exe_path}"':
                return  # 已注册且路径一致，跳过
        except OSError:
            pass  # 未注册，继续

        # 注册协议名
        key = winreg.CreateKey(base, proto_key)
        winreg.SetValue(key, "", winreg.REG_SZ, "URL:ProjectTool Protocol")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
        winreg.CloseKey(key)

        # 注册启动命令
        key = winreg.CreateKey(base, cmd_key)
        winreg.SetValue(key, "", winreg.REG_SZ, f'"{exe_path}"')
        winreg.CloseKey(key)

        print(f"[Protocol] 已注册 projecttool:// → {exe_path}")
    except Exception as e:
        print(f"[Protocol] 注册失败: {e}")


def ensure_runtime_configs():
    """确保 exe 运行目录有可写的配置文件

    PyInstaller 打包后，sys._MEIPASS 是只读的临时解压目录。

    version.json 由 _do_update_async 在更新时写入，启动时不修改。
    update_config.json 首次运行时从 _MEIPASS 拷贝到 exe 目录。
    """
    if not getattr(sys, 'frozen', False):
        return  # 源码模式不需要

    exe_dir = os.path.dirname(sys.executable)

    # version.json: 启动时不修改，仅由 _do_update_async 在更新时写入

    # 注册 projecttool:// 自定义协议，插件可通过此协议拉起 exe
    _register_custom_protocol(exe_dir)

    # update_config.json: 仅当 exe 目录不存在时才从 _MEIPASS 拷贝
    meipass_config = os.path.join(sys._MEIPASS, "update_config.json")
    exe_config = os.path.join(exe_dir, "update_config.json")
    if os.path.exists(meipass_config) and not os.path.exists(exe_config):
        shutil.copy2(meipass_config, exe_config)
