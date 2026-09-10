"""工时填报检查 API（模块归属：工时填报后端）。

V3.1 并入，原 WorkingHoursTool app.exe 逻辑，统计口径由 workhours_service 保证：
计划直加=目标；填报÷8=已填；完成率升序；无计划成员视为 100%。
对 ITA 只读；前端（工时面板）按 body {cookie} / {cookie, prjid} 消费。
"""
from flask import Blueprint, jsonify, request

import workhours_service

bp = Blueprint("workhours_api", __name__)


@bp.route("/api/workhours/projects", methods=["POST"])
def workhours_projects():
    """有工时计划的项目列表（今年+去年合并）。body: {cookie}"""
    body = request.get_json(silent=True) or {}
    cookie = (body.get("cookie") or "").strip()
    if not cookie:
        return jsonify({"ok": False, "error": "缺少 ITA Cookie，请先登录 ita.abc"}), 400
    try:
        return jsonify(workhours_service.get_projects_two_year(cookie))
    except Exception as e:
        return jsonify({"ok": False, "error": f"获取工时项目失败：{e}"}), 502


@bp.route("/api/workhours/target", methods=["POST"])
def workhours_target():
    """项目成员工时填报统计（今年+去年合并）。body: {cookie, prjid}"""
    body = request.get_json(silent=True) or {}
    cookie = (body.get("cookie") or "").strip()
    prjid = (body.get("prjid") or "").strip()
    if not cookie or not prjid:
        return jsonify({"ok": False, "error": "缺少 cookie 或 prjid"}), 400
    try:
        return jsonify(workhours_service.get_target_two_year(cookie, prjid))
    except Exception as e:
        return jsonify({"ok": False, "error": f"获取成员工时失败：{e}"}), 502
