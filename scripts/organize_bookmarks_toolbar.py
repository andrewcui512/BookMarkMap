#!/usr/bin/env python3
"""Reorganize the exported Chrome bookmarks toolbar into a cleaner structure.

This script is intentionally conservative:
- It only restructures the `书签栏` folder.
- It preserves the rest of the exported bookmark file.
- It mainly regroups existing top-level folders into broader buckets, so the
  risk of misclassification stays low for large bookmark libraries.
"""

from __future__ import annotations

import argparse
import copy
import html
import re
import time
from collections import OrderedDict
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


GROUPS = [
    "工作台",
    "开发",
    "AI / Agent",
    "工具与设备",
    "阅读学习",
    "内容资源",
    "生活规划",
    "待整理",
]

TRACKING_QUERY_KEYS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "spm",
    "from",
    "scene",
    "share",
    "share_source",
    "share_medium",
    "share_plat",
    "share_session_id",
    "share_token",
    "timestamp",
}

LOW_VALUE_TITLE_RE = re.compile(r"激活码|注册码|破解版|重置试用", re.IGNORECASE)
LOW_VALUE_URL_RE = re.compile(
    r"lookdiv\.com|idea\.javatiku\.cn|key\.words\.run|zhile\.io|navicat.*破解|crack",
    re.IGNORECASE,
)


TOP_LEVEL_RULES = {
    "Program": {"group": "开发", "rename": "编程开发"},
    "编程在线工具": {"group": "开发"},
    "编程面试": {"group": "开发"},
    "Ai": {"group": "AI / Agent", "rename": "AI导航", "flatten": True},
    "Agent学习": {"group": "AI / Agent"},
    "工作": {"group": "工作台"},
    "HYT": {"group": "工作台"},
    "工具": {"group": "工具与设备", "rename": "工具箱"},
    "在线驱动": {"group": "工具与设备"},
    "Apple用": {"group": "工具与设备", "rename": "Apple生态"},
    "Blog": {"group": "阅读学习", "rename": "博客"},
    "Read": {"group": "阅读学习", "rename": "阅读"},
    "English": {"group": "阅读学习", "rename": "英语"},
    "各种资源": {"group": "内容资源", "rename": "资源合集"},
    "自留地": {"group": "内容资源", "rename": "个人兴趣"},
    "待办": {"group": "待整理", "flatten": True},
}


class BookmarkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.roots: list[dict] = []
        self.stack: list[dict] = []
        self.pending_folder: dict | None = None
        self.pending_bookmark: dict | None = None
        self.current_text: list[str] = []
        self.in_h3 = False
        self.in_a = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = OrderedDict((k, v or "") for k, v in attrs)

        if tag == "h3":
            self.in_h3 = True
            self.current_text = []
            self.pending_folder = {
                "type": "folder",
                "title": "",
                "attrs": attrs_dict,
                "children": [],
            }
            return

        if tag == "a":
            self.in_a = True
            self.current_text = []
            self.pending_bookmark = {
                "type": "bookmark",
                "title": "",
                "attrs": attrs_dict,
            }
            return

        if tag == "dl" and self.pending_folder is not None:
            folder = self.pending_folder
            self.pending_folder = None
            self._append_node(folder)
            self.stack.append(folder)

    def handle_endtag(self, tag: str) -> None:
        if tag == "h3" and self.in_h3 and self.pending_folder is not None:
            self.pending_folder["title"] = "".join(self.current_text).strip()
            self.in_h3 = False
            return

        if tag == "a" and self.in_a and self.pending_bookmark is not None:
            self.pending_bookmark["title"] = "".join(self.current_text).strip()
            self._append_node(self.pending_bookmark)
            self.pending_bookmark = None
            self.in_a = False
            return

        if tag == "dl" and self.stack:
            self.stack.pop()

    def handle_data(self, data: str) -> None:
        if self.in_h3 or self.in_a:
            self.current_text.append(data)

    def _append_node(self, node: dict) -> None:
        if self.stack:
            self.stack[-1]["children"].append(node)
        else:
            self.roots.append(node)


def clone_node(node: dict, rename: str | None = None) -> dict:
    new_node = copy.deepcopy(node)
    if rename:
        new_node["title"] = rename
    return new_node


def find_toolbar(roots: list[dict]) -> dict:
    for node in roots:
        if node["type"] == "folder" and node["title"] == "书签栏":
            return node
    raise ValueError("未找到 `书签栏` 文件夹")


def new_folder(title: str, personal_toolbar: bool = False) -> dict:
    now = str(int(time.time()))
    attrs = OrderedDict(
        [
            ("ADD_DATE", now),
            ("LAST_MODIFIED", now),
        ]
    )
    if personal_toolbar:
        attrs["PERSONAL_TOOLBAR_FOLDER"] = "true"

    return {
        "type": "folder",
        "title": title,
        "attrs": attrs,
        "children": [],
    }


def guess_group_for_loose_bookmark(node: dict) -> str:
    title = node["title"].lower()
    href = node["attrs"].get("href", "")
    host = urlsplit(href).netloc.lower()

    if "timegrid" in title or "lifeweeks" in host or "周数" in node["title"] or "giffgaff" in title:
        return "生活规划"

    if (
        "canirun.ai" in host
        or "inkwellai" in host
        or "agent" in title
        or host == "github.com" and "/agent" in href.lower()
    ):
        return "AI / Agent"

    if "zeronote" in title or "chrome.google.com" in host:
        return "工具与设备"

    if "投资" in node["title"] or "fiflynote" in host:
        return "阅读学习"

    if "linux.do" in host or "linuxdo" in node["title"].lower():
        return "内容资源"

    return "工具与设备"


def move_into_group(groups: dict[str, dict], group_name: str, node: dict) -> None:
    groups[group_name]["children"].append(node)


def normalize_title(title: str) -> str:
    title = title.strip().lower()
    title = re.sub(r"https?://", "", title)
    title = re.sub(r"[|｜\\-–—_:：]+", " ", title)
    title = re.sub(r"\s+", " ", title)
    return title.strip()


def canonical_url(url: str) -> str:
    if not url:
        return ""

    parts = urlsplit(url.strip())
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]

    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() not in TRACKING_QUERY_KEYS
    ]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), host, path, urlencode(query), ""))


def bookmark_key(node: dict) -> tuple[str, str]:
    return canonical_url(node["attrs"].get("href", "")), normalize_title(node["title"])


def is_low_value_bookmark(node: dict, path: list[str]) -> bool:
    title = node["title"]
    href = node["attrs"].get("href", "")
    path_text = "/".join(path)

    # Narrow low-value deletion to obvious activation / crack collections.
    if "Jetbrain" in path_text and (LOW_VALUE_TITLE_RE.search(title) or LOW_VALUE_URL_RE.search(href)):
        return True

    if "Navicat Premium" in title and "破解版" in title:
        return True

    return False


def merge_child_folders(folder: dict, source_titles: list[str], merged_title: str) -> None:
    merged_children: list[dict] = []
    keep_children: list[dict] = []

    for child in folder["children"]:
        if child["type"] == "folder" and child["title"] in source_titles:
            merged_children.extend(child["children"])
        else:
            keep_children.append(child)

    if not merged_children:
        folder["children"] = keep_children
        return

    merged_folder = new_folder(merged_title)
    merged_folder["children"] = merged_children
    keep_children.append(merged_folder)
    folder["children"] = keep_children


def apply_theme_merges(toolbar: dict) -> None:
    for group in toolbar["children"]:
        if group["title"] == "工具与设备":
            for child in group["children"]:
                if child["type"] == "folder" and child["title"] == "Apple生态":
                    merge_child_folders(child, ["Mac软件下载网站", "Mac 用的软件"], "Mac软件")

        if group["title"] == "内容资源":
            for child in group["children"]:
                if child["type"] == "folder" and child["title"] == "个人兴趣":
                    merge_child_folders(child, ["笔记", "笔记相关知识"], "笔记系统")

        if group["title"] == "开发":
            for child in group["children"]:
                if child["type"] == "folder" and child["title"] == "编程开发":
                    merge_child_folders(child, ["编程知识网站", "编程课程网站"], "编程学习")


def cleanup_tree(node: dict, path: list[str], stats: dict[str, int]) -> dict | None:
    if node["type"] == "bookmark":
        if is_low_value_bookmark(node, path):
            stats["removed_low_value"] += 1
            return None
        return node

    new_children: list[dict] = []
    seen_bookmark_keys: set[tuple[str, str]] = set()
    seen_same_title_in_folder: set[str] = set()

    for child in node["children"]:
        cleaned = cleanup_tree(child, path + [node["title"]], stats)
        if cleaned is None:
            continue

        if cleaned["type"] == "bookmark":
            key = bookmark_key(cleaned)
            same_title_key = normalize_title(cleaned["title"])

            if key in seen_bookmark_keys:
                stats["removed_duplicates"] += 1
                continue

            if same_title_key in seen_same_title_in_folder:
                stats["removed_duplicates"] += 1
                continue

            seen_bookmark_keys.add(key)
            seen_same_title_in_folder.add(same_title_key)

        new_children.append(cleaned)

    node["children"] = new_children
    if not node["children"]:
        return None
    return node


def refine_toolbar(toolbar: dict) -> tuple[dict, dict[str, int]]:
    refined = clone_node(toolbar)
    apply_theme_merges(refined)

    cleanup_stats = {
        "removed_low_value": 0,
        "removed_duplicates": 0,
    }
    cleaned = cleanup_tree(refined, [], cleanup_stats)
    if cleaned is None:
        raise ValueError("清理后 `书签栏` 为空，规则过于激进")
    return cleaned, cleanup_stats


def reorganize_toolbar(toolbar: dict) -> tuple[dict, dict[str, int]]:
    groups = {name: new_folder(name) for name in GROUPS}

    for child in toolbar["children"]:
        if child["type"] == "folder" and child["title"] in TOP_LEVEL_RULES:
            rule = TOP_LEVEL_RULES[child["title"]]
            group_name = rule["group"]
            rename = rule.get("rename")
            flatten = bool(rule.get("flatten"))

            if flatten:
                for grandchild in child["children"]:
                    move_into_group(groups, group_name, clone_node(grandchild))
            else:
                move_into_group(groups, group_name, clone_node(child, rename=rename))
            continue

        if child["type"] == "bookmark":
            group_name = guess_group_for_loose_bookmark(child)
            move_into_group(groups, group_name, clone_node(child))
            continue

        # Fallback for any unexpected top-level folder.
        move_into_group(groups, "待整理", clone_node(child))

    new_toolbar = clone_node(toolbar)
    new_toolbar["children"] = [groups[name] for name in GROUPS if groups[name]["children"]]
    return new_toolbar, summarize_group_counts(new_toolbar)


def serialize_attrs(attrs: OrderedDict[str, str]) -> str:
    if not attrs:
        return ""
    parts = [f'{key}="{html.escape(value, quote=True)}"' for key, value in attrs.items()]
    return " " + " ".join(parts)


def serialize_node(node: dict, level: int = 0) -> list[str]:
    indent = "    " * level

    if node["type"] == "folder":
        lines = [
            f"{indent}<DT><H3{serialize_attrs(node['attrs'])}>{html.escape(node['title'])}</H3>",
            f"{indent}<DL><p>",
        ]
        for child in node["children"]:
            lines.extend(serialize_node(child, level + 1))
        lines.append(f"{indent}</DL><p>")
        return lines

    return [
        f"{indent}<DT><A{serialize_attrs(node['attrs'])}>{html.escape(node['title'])}</A>",
    ]


def serialize_document(roots: list[dict]) -> str:
    lines = [
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
        "<!-- This is an automatically generated file.",
        "     It will be read and overwritten.",
        "     DO NOT EDIT! -->",
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        "<TITLE>Bookmarks</TITLE>",
        "<H1>Bookmarks</H1>",
        "<DL><p>",
    ]
    for node in roots:
        lines.extend(serialize_node(node, 1))
    lines.append("</DL><p>")
    lines.append("")
    return "\n".join(lines)


def iter_bookmarks(node: dict) -> Iterable[dict]:
    if node["type"] == "bookmark":
        yield node
        return

    for child in node["children"]:
        yield from iter_bookmarks(child)


def summarize_group_counts(toolbar: dict) -> dict[str, int]:
    summary: dict[str, int] = {}
    for child in toolbar["children"]:
        summary[child["title"]] = sum(1 for _ in iter_bookmarks(child))
    return summary


def render_report(
    source_name: str,
    output_name: str,
    counts: dict[str, int],
    refine_stats: dict[str, int] | None = None,
) -> str:
    lines = [
        "# 书签栏整理说明",
        "",
        f"- 源文件：`{source_name}`",
        f"- 输出文件：`{output_name}`",
        "- 整理范围：仅重组 `书签栏` 顶层结构，其余根目录保持不动。",
        "- 整理原则：优先按用途分组，尽量保留原有子文件夹，降低误分风险。",
        "",
        "## 新的顶层结构",
        "",
    ]

    for group, count in counts.items():
        lines.append(f"- `{group}`：{count} 个书签")

    lines.extend(
        [
            "",
            "## 归类策略",
            "",
            "- `工作台`：承接原 `工作`、`HYT`。",
            "- `开发`：承接原 `Program`、`编程在线工具`、`编程面试`。",
            "- `AI / Agent`：承接原 `Ai`、`Agent学习`，以及散落在根部的 AI/Agent 相关链接。",
            "- `工具与设备`：承接原 `工具`、`在线驱动`、`Apple用`，以及 Chrome/ZeroNote 等工具型链接。",
            "- `阅读学习`：承接原 `Blog`、`Read`、`English`，以及投资笔记这类阅读型内容。",
            "- `内容资源`：承接原 `各种资源`、`自留地`，以及 LinuxDo 商家评价平台这类社区/资源链接。",
            "- `生活规划`：收纳时间规划、生命周数、giffgaff 教程等个人生活向链接。",
            "- `待整理`：保留原 `待办` 内容，方便你后续二次精修。",
            "",
            "## 说明",
            "",
            "- 第一轮只重组结构，尽量保留原有子文件夹。",
            "",
        ]
    )

    if refine_stats is not None:
        lines.extend(
            [
                "## 第二轮精修",
                "",
                f"- 删除明显低价值收藏：{refine_stats['removed_low_value']} 个",
                f"- 删除重复/镜像收藏：{refine_stats['removed_duplicates']} 个",
                "- 合并主题：`Mac软件下载网站 + Mac 用的软件 -> Mac软件`",
                "- 合并主题：`笔记 + 笔记相关知识 -> 笔记系统`",
                "- 合并主题：`编程知识网站 + 编程课程网站 -> 编程学习`",
                "",
                "## 说明",
                "",
                "- 低价值删除规则目前只覆盖最明显的激活/破解版/试用重置收藏，没有大面积清洗你可能仍然需要的技术资料。",
                "- 重复删除主要针对同文件夹中的同标题镜像和同链接变体。",
                "",
            ]
        )
    else:
        lines.extend(
            [
                "- 如果你认可这版结构，下一步适合再做一轮“精细化整理”：处理命名不统一、失效链接、收藏价值较低的旧文章。",
                "",
            ]
        )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reorganize the Chrome bookmarks toolbar export.")
    parser.add_argument("input", help="Input exported bookmark HTML")
    parser.add_argument(
        "--output",
        help="Output HTML path",
        default=None,
    )
    parser.add_argument(
        "--report",
        help="Markdown report path",
        default=None,
    )
    parser.add_argument(
        "--refine",
        action="store_true",
        help="Apply second-round cleanup: remove low-value bookmarks and merge duplicate themes.",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    default_suffix = "_refined" if args.refine else "_reorganized"
    output_path = Path(args.output) if args.output else input_path.with_name(f"{input_path.stem}{default_suffix}.html")
    report_path = Path(args.report) if args.report else input_path.with_name(f"{input_path.stem}{default_suffix}_report.md")

    parser_obj = BookmarkParser()
    parser_obj.feed(input_path.read_text(encoding="utf-8"))

    toolbar = find_toolbar(parser_obj.roots)
    new_toolbar, counts = reorganize_toolbar(toolbar)
    refine_stats = None
    if args.refine:
        new_toolbar, refine_stats = refine_toolbar(new_toolbar)
        counts = summarize_group_counts(new_toolbar)

    new_roots = []
    for node in parser_obj.roots:
        if node is toolbar:
            new_roots.append(new_toolbar)
        else:
            new_roots.append(node)

    output_path.write_text(serialize_document(new_roots), encoding="utf-8")
    report_path.write_text(
        render_report(input_path.name, output_path.name, counts, refine_stats=refine_stats),
        encoding="utf-8",
    )

    print(f"wrote html: {output_path}")
    print(f"wrote report: {report_path}")
    for group, count in counts.items():
        print(f"{group}: {count}")
    if refine_stats is not None:
        print(f"removed_low_value: {refine_stats['removed_low_value']}")
        print(f"removed_duplicates: {refine_stats['removed_duplicates']}")


if __name__ == "__main__":
    main()
