"""检查历史 API（模块归属：检查历史）。

IndexedDB 主存的 SQLite 备份通道，四个路由均为 storage_service 的薄封装。
前端契约：common/store.js（HistoryStore 读取后端优先，失败回退本地）。
"""
from flask import Blueprint, jsonify, request

import storage_service

bp = Blueprint("history_api", __name__)


@bp.route("/api/history/sync", methods=["POST"])
def history_sync():
    record = request.get_json(silent=True) or {}
    return jsonify(storage_service.history_sync(record))


@bp.route("/api/history/list", methods=["POST", "GET"])
def history_list():
    filter_ = request.get_json(silent=True) or {}
    return jsonify(storage_service.history_list(filter_))


@bp.route("/api/history/get", methods=["POST"])
def history_get():
    body = request.get_json(silent=True) or {}
    return jsonify(storage_service.history_get(body.get("id")))


@bp.route("/api/history/delete", methods=["POST"])
def history_delete():
    body = request.get_json(silent=True) or {}
    return jsonify(storage_service.history_delete(body.get("id")))
