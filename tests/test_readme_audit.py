from __future__ import annotations

from pathlib import Path
import re


README = Path(__file__).resolve().parents[1] / "README.md"


def test_readme_is_comprehensively_written_in_simplified_chinese():
    text = README.read_text(encoding="utf-8")
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", text))
    assert cjk_count > 3000
    for heading in (
        "# 安装",
        "# 六种生成模式",
        "# Previous Context（续接上一段）",
        "## Visual Previous Context",
        "## Audio Previous Context",
        "## 选择运行与过期缓存",
        "## pin_renorm（Experimental）",
        "# Color Re-anchor",
        "# Source Bridge",
        "# 当前限制",
        "# 项目关系与许可",
    ):
        assert heading in text


def test_readme_does_not_present_removed_or_misleading_behavior_as_current():
    text = README.read_text(encoding="utf-8")
    for stale in (
        "Bernini-style",
        "Source Overlap",
        "Best Cut",
        "RGB MAD",
        "yellow correction",
        "yellow drift",
        "Motion Context 22",
        "22 frames baseline",
        "### R2V 参考集合继承",
        "后续空组继承最近一个完整的显式参考集合",
        "16 像素仍可用",
        "动态 32 像素空间对齐",
    ):
        assert stale not in text

    assert "降低多段链式生成中的累积性色彩漂移" in text
    assert "Visual 与 Audio 已经分开" in text
    assert "Segment 1 没有上一段" in text
    assert "cache 缺失或 stale" in text
    assert "第一份 Visual handoff" in text
    assert "audio latent" in text
    assert "Source Bridge 只拥有视觉路径" in text
    assert "不会建立 recent generated memory bank" in text
