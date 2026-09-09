import json
import random
import re
from datetime import datetime


class MockAIProvider:

    _call_count = 0

    @staticmethod
    def check_health(url: str) -> bool:
        return True

    @staticmethod
    def init_session(url: str) -> str:
        ts = datetime.now().strftime("%H%M%S")
        return f"mock_session_{ts}_{random.randint(100, 999)}"

    @staticmethod
    def chat(url: str, session_id: str, prompt: str) -> str:
        rule_type = MockAIProvider._detect_rule_type(prompt)
        if rule_type == '8':
            return MockAIProvider._mock_rule8(prompt)
        elif rule_type == '14':
            return MockAIProvider._mock_rule14(prompt)
        else:
            # 规则2（默认，向后兼容）
            items = MockAIProvider._parse_prompt(prompt)
            results = []
            for item in items:
                has_content = item.get("wpsDesc", "") and "(无内容)" not in item.get("wpsDesc", "")
                if has_content:
                    is_in_wps = random.random() < 0.7
                else:
                    is_in_wps = False

                if is_in_wps:
                    reason = (
                        f'需求文档第{item["pointIndex"]}节中明确描述了"'
                        f'{item["pointName"]}"的相关业务流程和功能要求，'
                        f"与功能名称匹配。"
                    )
                else:
                    reason = (
                        f'需求文档第{item["pointIndex"]}节中未找到与"'
                        f'{item["pointName"]}"直接对应的功能描述，'
                        f"建议补充或确认该功能的需求依据。"
                    )
                results.append({
                    "batch": item["batch"],
                    "pointIndex": item["pointIndex"],
                    "pointName": item["pointName"],
                    "isInWPS": is_in_wps,
                    "reason": reason,
                })

            return json.dumps(results, ensure_ascii=False)

    @staticmethod
    def _detect_rule_type(prompt: str) -> str:
        """从 prompt 头部提取 [RULE_TYPE:X] 标记，默认返回 '2'（向后兼容）"""
        m = re.search(r'\[RULE_TYPE:(\d+)\]', prompt)
        return m.group(1) if m else '2'

    @staticmethod
    def _mock_rule8(prompt: str) -> str:
        """模拟规则8 AI 校验：引擎判定为 'dup' 确认率 85%，'near' 确认率 35%"""
        items = MockAIProvider._parse_rule8_prompt(prompt)
        results = []
        for item in items:
            is_dup = item.get('rule8Kind') == 'dup'
            # dup: 85% 确认, near: 35% 确认
            confirmed = random.random() < (0.85 if is_dup else 0.35)
            if confirmed and is_dup:
                reason = (
                    f"AI确认：'{item.get('nameI', '')}'与'{item.get('nameJ', '')}'"
                    f"描述的是同一业务操作，建议合并为一个功能点。"
                )
            elif confirmed:
                reason = (
                    f"AI确认：'{item.get('nameI', '')}'与'{item.get('nameJ', '')}'"
                    f"虽然用词不完全相同但核心语义相近，应视为重复功能。"
                )
            else:
                reason = (
                    f"AI认为：'{item.get('nameI', '')}'与'{item.get('nameJ', '')}'"
                    f"虽有相似之处但指代不同的业务对象或操作，不构成重复。"
                )
            results.append({
                "nameI": item.get("nameI", ""),
                "nameJ": item.get("nameJ", ""),
                "aiConfirmed": confirmed,
                "reason": reason,
            })
        return json.dumps(results, ensure_ascii=False)

    @staticmethod
    def _mock_rule14(prompt: str) -> str:
        """模拟规则14 AI 校验：约 40% 概率确认需要复核"""
        items = MockAIProvider._parse_rule14_prompt(prompt)
        results = []
        for item in items:
            confirmed = random.random() < 0.4
            if confirmed:
                reason = (
                    f"AI建议复核：'{item.get('nameI', '')}'与'{item.get('nameJ', '')}'"
                    f"中不同的名词在业务语境下可能存在含义重叠，建议重点检查是否为重复估算。"
                )
            else:
                reason = (
                    f"AI认为：'{item.get('nameI', '')}'与'{item.get('nameJ', '')}'"
                    f"虽然结构相似但不同的名词代表不同的业务实体，可视为独立功能点。"
                )
            results.append({
                "nameI": item.get("nameI", ""),
                "nameJ": item.get("nameJ", ""),
                "aiConfirmed": confirmed,
                "reason": reason,
            })
        return json.dumps(results, ensure_ascii=False)

    @staticmethod
    def _parse_prompt(prompt: str) -> list[dict]:
        """解析规则2的 prompt，提取 {batch, pointIndex, pointName, wpsDesc} 列表"""
        items = []
        pattern = re.compile(
            r"(\d+)\.\s*批次:\s*(\S+?)\s*\n"
            r"\s*章节:\s*(\S+?)\s*\n"
            r"\s*功能名称:\s*(.+?)\s*\n"
            r"\s*需求文档内容:\s*(.*?)(?=\n\s*\d+\.|\n*$)",
            re.DOTALL,
        )
        for match in pattern.finditer(prompt):
            items.append({
                "batch": match.group(2).strip(),
                "pointIndex": match.group(3).strip(),
                "pointName": match.group(4).strip(),
                "wpsDesc": match.group(5).strip(),
            })
        return items

    @staticmethod
    def _parse_rule8_prompt(prompt: str) -> list[dict]:
        """解析规则8的 prompt，提取 {nameI, nameJ, rule8Kind} 列表"""
        items = []
        pattern = re.compile(
            r"(\d+)\.\s*功能名称A:\s*(.+?)\s*\n"
            r"\s*功能名称B:\s*(.+?)\s*\n"
            r"\s*引擎判定:\s*(.+?)\s*\n"
            r"\s*所在Sheet:\s*(.*?)\s*\n"
            r"\s*分组键\(A-E列\):\s*(.*?)(?=\n\s*\d+\.|\n*$)",
            re.DOTALL,
        )
        for match in pattern.finditer(prompt):
            items.append({
                "nameI": match.group(2).strip(),
                "nameJ": match.group(3).strip(),
                "rule8Kind": "dup" if "完全重复" in match.group(4) else "near",
            })
        return items

    @staticmethod
    def _parse_rule14_prompt(prompt: str) -> list[dict]:
        """解析规则14的 prompt，提取 {nameI, nameJ} 列表"""
        items = []
        pattern = re.compile(
            r"(\d+)\.\s*功能名称A:\s*(.+?)\s*\n"
            r"\s*功能名称B:\s*(.+?)\s*\n"
            r"\s*所在Sheet:\s*(.*?)\s*\n"
            r"\s*分组键\(A-E列\):\s*(.*?)(?=\n\s*\d+\.|\n*$)",
            re.DOTALL,
        )
        for match in pattern.finditer(prompt):
            items.append({
                "nameI": match.group(2).strip(),
                "nameJ": match.group(3).strip(),
            })
        return items

    @staticmethod
    def mock_checklist_result(count: int) -> list[dict]:
        """生成规则2（需求依据校验）的 mock 结果列表"""
        results = []
        for i in range(count):
            is_in_wps = random.random() < 0.7
            if is_in_wps:
                reason = f"需求文档中明确描述了该功能的相关业务流程和功能要求（Mock #{i + 1}）"
            else:
                reason = f"需求文档中未找到与该功能直接对应的描述，建议补充或确认（Mock #{i + 1}）"
            results.append({
                "isInWPS": is_in_wps,
                "descDetail": f"Mock 描述信息 #{i + 1}",
                "reason": reason,
            })
        return results

    @staticmethod
    def mock_rule8_result(count: int, items: list = None) -> list[dict]:
        """生成规则8（重复功能名称校验）的 mock 结果列表，使用实际功能名称"""
        results = []
        for i in range(count):
            # 从实际 items 中获取真实的功能名称
            if items and i < len(items):
                name_i = items[i].get("nameI", f"功能A_{i + 1}")
                name_j = items[i].get("nameJ", f"功能B_{i + 1}")
            else:
                name_i = f"功能A_{i + 1}"
                name_j = f"功能B_{i + 1}"
            # 约 60% 概率 AI 确认构成重复/相近
            confirmed = random.random() < 0.6
            if confirmed:
                reason = (
                    f"AI确认：'{name_i}'与'{name_j}'"
                    f"描述的是同一业务操作或核心语义相近，建议合并为一个功能点。"
                )
            else:
                reason = (
                    f"AI认为：'{name_i}'与'{name_j}'"
                    f"虽有相似之处但指代不同的业务对象或操作，不构成重复。"
                )
            results.append({
                "nameI": name_i,
                "nameJ": name_j,
                "aiConfirmed": confirmed,
                "reason": reason,
            })
        return results

    @staticmethod
    def mock_rule14_result(count: int, items: list = None) -> list[dict]:
        """生成规则14（单名词差异提示）的 mock 结果列表，使用实际功能名称"""
        results = []
        for i in range(count):
            # 从实际 items 中获取真实的功能名称
            if items and i < len(items):
                name_i = items[i].get("nameI", f"功能C_{i + 1}")
                name_j = items[i].get("nameJ", f"功能D_{i + 1}")
            else:
                name_i = f"功能C_{i + 1}"
                name_j = f"功能D_{i + 1}"
            # 约 40% 概率 AI 建议复核
            confirmed = random.random() < 0.4
            if confirmed:
                reason = (
                    f"AI建议复核：'{name_i}'与'{name_j}'"
                    f"中不同的名词在业务语境下可能存在含义重叠，建议重点检查是否为重复估算。"
                )
            else:
                reason = (
                    f"AI认为：'{name_i}'与'{name_j}'"
                    f"虽然结构相似但不同的名词代表不同的业务实体，可视为独立功能点。"
                )
            results.append({
                "nameI": name_i,
                "nameJ": name_j,
                "aiConfirmed": confirmed,
                "reason": reason,
            })
        return results
