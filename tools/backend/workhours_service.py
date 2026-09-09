# -*- coding: utf-8 -*-
"""工时填报检查服务（ITA rptWkld）

V3.1 并入统一后端：原 WorkingHoursTool（app.exe, 端口 5002）逻辑重写至此，
淘汰独立 exe，仍只有一个「项目管理工具后端.exe」。

统计口径（源自原工具反编译还原，保持结果一致）：
- ITA 返回行带 typWkld（"计划"/"填报"）与 amtWkld1..amtWkld12（全年 12 个月列），month 参数固定传 1
- typWkld="计划" 的 amtWkld 直接累加 = 目标工时（人天）
- typWkld="填报" 的 amtWkld ÷ 8 累加 = 已填报（小时 → 人天）
- 跨年：项目列表只合并「今年仍存在」的去年项目；成员明细两年全量合并
- 成员级 planned=0 → 完成率按 100%（无计划视为达标），与原工具一致
- 成员表按完成率升序、再按 id 排序
"""
import datetime

import requests

ITA_BASE = "http://ita.abc"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36")
_TIMEOUT = 60


def _headers(cookie):
    """伪装页面 XHR 请求头（与原工具一致，Cookie 为用户会话）"""
    return {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "zh,en-US;q=0.9,en;q=0.8",
        "Connection": "keep-alive",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Cookie": cookie,
        "Origin": ITA_BASE,
        "Referer": ITA_BASE + "/ita/index.action",
        "User-Agent": _UA,
        "X-Requested-With": "XMLHttpRequest",
    }


def _grid_by_month(cookie, year):
    """当月工时汇总（全年 12 列）；原工具 form 传参"""
    resp = requests.post(
        ITA_BASE + "/ita/rptWkld/bindWgldGridByMonth",
        headers=_headers(cookie),
        data={"year": str(year), "month": "1"},
        timeout=_TIMEOUT,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"ITA 工时汇总接口返回 HTTP {resp.status_code}")
    return resp.json()


def _grid_dtl_by_month(cookie, prjid, year):
    """当月成员明细（全年 12 列）；原工具走 query 传参，此处保持一致"""
    resp = requests.post(
        ITA_BASE + "/ita/rptWkld/bindWgldGridDtlByMonth",
        headers=_headers(cookie),
        params={"prjid": prjid, "year": str(year), "month": "1"},
        timeout=_TIMEOUT,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"ITA 工时明细接口返回 HTTP {resp.status_code}")
    return resp.json()


# ── 统计（忠实移植原工具算法） ──────────────────────────

def calculate_project_last_date(rows, year):
    """各项目计划中最后一个有工时的月份 → {prjid: "year-maxMonth"}（计划截止月）"""
    stats = {}
    for item in rows:
        prjid = item.get("prjid")
        max_month = 1
        if item.get("typWkld") == "计划":
            for key in item:
                if key.startswith("amtWkld") and isinstance(item[key], (int, float)) and item[key] > 0:
                    month = int(str(key).replace("amtWkld", ""))
                    max_month = month if month > max_month else max_month
            stats[prjid] = f"{year}-{max_month}"
    return stats


def calculate_project_stats(rows):
    """项目级汇总：target=计划直加；completed=填报÷8；完成率=completed/target*100"""
    stats = {}
    for item in rows:
        prjid = item.get("prjid")
        if prjid not in stats:
            stats[prjid] = {
                "projname": item.get("projname", ""),
                "projectno": item.get("projectno", ""),
                "target_amt": 0.0,
                "completed_amt": 0.0,
            }
        for key in item:
            if key.startswith("amtWkld") and isinstance(item[key], (int, float)):
                if item.get("typWkld") == "计划":
                    stats[prjid]["target_amt"] += item[key]
                elif item.get("typWkld") == "填报":
                    stats[prjid]["completed_amt"] += item[key] / 8

    result = []
    for prjid, info in stats.items():
        target, completed = info["target_amt"], info["completed_amt"]
        rate = 0 if target == 0 else completed / target * 100
        result.append({
            "id": prjid,
            "projname": info["projname"],
            "projectno": info["projectno"],
            "target_amt": round(target, 2),
            "completed_amt": round(completed, 2),
            "achievement_rate": round(rate, 2),
        })
    return result


def calculate_completion_rate(dtl):
    """成员级汇总：planned=计划直加；actual=填报÷8；planned=0 → 100%；按完成率升序"""
    user_stats = {}
    for item in dtl:
        user_id = item.get("idUser")
        typ = item.get("typWkld")
        if user_id not in user_stats:
            user_stats[user_id] = {"target_amt": 0.0, "completed_amt": 0.0, "name": item.get("namUser", "")}
        for i in range(1, 13):
            key = f"amtWkld{i}"
            if key in item and item[key] is not None:
                if typ == "计划":
                    user_stats[user_id]["target_amt"] += item[key]
                elif typ == "填报":
                    user_stats[user_id]["completed_amt"] += item[key] / 8

    for user_id, info in user_stats.items():
        planned, actual = info["target_amt"], info["completed_amt"]
        rate = 100.0 if planned == 0 else actual / planned * 100
        info["achievement_rate"] = round(rate, 2)

    sorted_users = sorted(user_stats.items(), key=lambda x: (x[1]["achievement_rate"], x[0]))
    return [{
        "id": user_id,
        "name": info["name"],
        "target_amt": round(info["target_amt"], 2),
        "completed_amt": round(info["completed_amt"], 2),
        "achievement_rate": info["achievement_rate"],
    } for user_id, info in sorted_users]


# ── 对外入口（跨年合并） ────────────────────────────────

def get_projects_two_year(cookie):
    """项目列表：今年 + 去年（只保留今年仍存在的项目），附计划截止月"""
    today = datetime.datetime.today()
    year = today.year
    cur = _grid_by_month(cookie, year)
    date_info = calculate_project_last_date(cur, year)
    last = _grid_by_month(cookie, year - 1)
    cur_ids = {item.get("prjid") for item in cur}
    merge = cur + [item for item in last if item.get("prjid") in cur_ids]
    result = calculate_project_stats(merge)
    for info in result:
        info["last_date"] = date_info.get(info["id"], "")
    return {"year": year, "projects": result}


def get_target_two_year(cookie, prjid):
    """成员明细：今年 + 去年全量合并后按成员聚合"""
    today = datetime.datetime.today()
    year = today.year
    cur = _grid_dtl_by_month(cookie, prjid, year)
    last = _grid_dtl_by_month(cookie, prjid, year - 1)
    return {"year": year, "members": calculate_completion_rate(cur + last)}
