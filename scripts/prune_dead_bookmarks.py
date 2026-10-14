#!/usr/bin/env python3
"""Prune clearly-dead bookmarks from an exported bookmarks HTML file.

Conservative rules:
- Delete only when the link is clearly dead:
  - DNS resolution failure / connection refused / invalid URL
  - HTTP 404 / 410 after HEAD/GET fallback
- Keep links that are ambiguous:
  - 401 / 403 / 429 / 5xx
  - timeouts
  - login walls / geo restrictions / SSL issues

This is intended for personal bookmark cleanup, not for perfect uptime checking.
"""

from __future__ import annotations

import argparse
import copy
import html
import http.client
import json
import socket
import ssl
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


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

SKIP_GROUPS = {"工作台"}
SKIP_HOST_SUFFIXES = {
    "feishu.cn",
    "kdocs.cn",
    "dingtalk.com",
    "qq.com",
    "weixin.qq.com",
    "cluerich.com",
    "dsxuetan.com",
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


def find_folder(nodes: list[dict], title: str) -> dict:
    for node in nodes:
        if node["type"] == "folder" and node["title"] == title:
            return node
    raise ValueError(f"未找到文件夹: {title}")


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


def should_skip_check(path: list[str], url: str) -> bool:
    if any(group in path for group in SKIP_GROUPS):
        return True

    host = urlsplit(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]

    return any(host == suffix or host.endswith("." + suffix) for suffix in SKIP_HOST_SUFFIXES)


def fetch_status(url: str, timeout: float = 12.0) -> tuple[str, int | None, str]:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ("dead", None, "invalid_url")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        )
    }

    def do_request(method: str) -> tuple[int, str]:
        request = urllib.request.Request(url, headers=headers, method=method)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.getcode(), response.reason

    try:
        status_code, reason = do_request("HEAD")
    except urllib.error.HTTPError as e:
        status_code, reason = e.code, e.reason
    except urllib.error.URLError as e:
        err = e.reason
        if isinstance(err, socket.gaierror):
            return ("dead", None, "dns_error")
        if isinstance(err, ConnectionRefusedError):
            return ("dead", None, "connection_refused")
        if isinstance(err, TimeoutError):
            return ("keep", None, "timeout")
        if isinstance(err, ssl.SSLError):
            return ("keep", None, "ssl_error")
        return ("keep", None, f"url_error:{type(err).__name__}")
    except http.client.RemoteDisconnected:
        return ("keep", None, "remote_disconnected")
    except (socket.timeout, TimeoutError):
        return ("keep", None, "timeout")
    except ssl.SSLError:
        return ("keep", None, "ssl_error")
    except Exception as e:  # noqa: BLE001
        return ("keep", None, f"error:{type(e).__name__}")

    if status_code in {404, 410}:
        return ("dead", status_code, str(reason))
    if 200 <= status_code < 400:
        return ("alive", status_code, str(reason))
    if status_code in {401, 403, 405, 429}:
        if status_code == 405:
            # Some servers reject HEAD. Retry with GET.
            pass
        else:
            return ("keep", status_code, str(reason))
    if 500 <= status_code < 600:
        return ("keep", status_code, str(reason))

    try:
        status_code, reason = do_request("GET")
    except urllib.error.HTTPError as e:
        status_code, reason = e.code, e.reason
    except urllib.error.URLError as e:
        err = e.reason
        if isinstance(err, socket.gaierror):
            return ("dead", None, "dns_error")
        if isinstance(err, ConnectionRefusedError):
            return ("dead", None, "connection_refused")
        if isinstance(err, TimeoutError):
            return ("keep", None, "timeout")
        if isinstance(err, ssl.SSLError):
            return ("keep", None, "ssl_error")
        return ("keep", None, f"url_error:{type(err).__name__}")
    except http.client.RemoteDisconnected:
        return ("keep", None, "remote_disconnected")
    except (socket.timeout, TimeoutError):
        return ("keep", None, "timeout")
    except ssl.SSLError:
        return ("keep", None, "ssl_error")
    except Exception as e:  # noqa: BLE001
        return ("keep", None, f"error:{type(e).__name__}")

    if status_code in {404, 410}:
        return ("dead", status_code, str(reason))
    if 200 <= status_code < 400:
        return ("alive", status_code, str(reason))
    return ("keep", status_code, str(reason))


def collect_bookmarks(node: dict, path: list[str], rows: list[dict]) -> None:
    if node["type"] == "bookmark":
        url = node["attrs"].get("href", "")
        rows.append(
            {
                "path": path.copy(),
                "title": node["title"],
                "url": url,
                "canonical_url": canonical_url(url),
                "skip": should_skip_check(path, url),
            }
        )
        return

    for child in node["children"]:
        collect_bookmarks(child, path + [node["title"]], rows)


def remove_dead_bookmarks(node: dict, path: list[str], dead_map: dict[str, dict], stats: dict[str, int]) -> dict | None:
    if node["type"] == "bookmark":
        key = canonical_url(node["attrs"].get("href", ""))
        if key in dead_map:
            stats["removed_dead"] += 1
            return None
        return node

    new_children: list[dict] = []
    for child in node["children"]:
        cleaned = remove_dead_bookmarks(child, path + [node["title"]], dead_map, stats)
        if cleaned is not None:
            new_children.append(cleaned)

    node["children"] = new_children
    if not node["children"]:
        return None
    return node


def render_report(
    source_name: str,
    output_name: str,
    checked: int,
    skipped: int,
    dead_items: list[dict],
) -> str:
    lines = [
        "# 第三轮失效链接清理说明",
        "",
        f"- 源文件：`{source_name}`",
        f"- 输出文件：`{output_name}`",
        f"- 实际联网检测：{checked} 个书签",
        f"- 跳过检测：{skipped} 个书签",
        f"- 明确删除：{len(dead_items)} 个书签",
        "",
        "## 删除规则",
        "",
        "- 仅删除明确失效的链接：`404`、`410`、域名解析失败、连接拒绝、非法 URL。",
        "- 保留不确定状态的链接：`401/403/429/5xx`、超时、SSL 错误、疑似登录墙或地区限制。",
        "",
        "## 已删除书签",
        "",
    ]

    if dead_items:
        for item in dead_items[:300]:
            lines.append(
                f"- `{' / '.join(item['path'])}` | `{item['status_label']}` | {item['title']} | {item['url']}"
            )
    else:
        lines.append("- 本轮没有检测到可安全删除的明确失效链接。")

    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Prune clearly-dead bookmarks from exported HTML.")
    parser.add_argument("input", help="Input exported bookmark HTML")
    parser.add_argument("--output", default=None, help="Output HTML path")
    parser.add_argument("--report", default=None, help="Markdown report path")
    parser.add_argument("--json", default=None, help="JSON result path")
    parser.add_argument("--concurrency", type=int, default=12, help="Concurrent requests")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output) if args.output else input_path.with_name(f"{input_path.stem}_dead_pruned.html")
    report_path = Path(args.report) if args.report else input_path.with_name(f"{input_path.stem}_dead_pruned_report.md")
    json_path = Path(args.json) if args.json else input_path.with_name(f"{input_path.stem}_dead_pruned_results.json")

    parser_obj = BookmarkParser()
    parser_obj.feed(input_path.read_text(encoding="utf-8"))
    toolbar = find_folder(parser_obj.roots, "书签栏")

    rows: list[dict] = []
    collect_bookmarks(toolbar, [], rows)

    to_check = [row for row in rows if not row["skip"]]
    skipped = len(rows) - len(to_check)

    unique_rows: dict[str, dict] = {}
    for row in to_check:
        unique_rows.setdefault(row["canonical_url"], row)

    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as executor:
        future_map = {
            executor.submit(fetch_status, row["url"]): key for key, row in unique_rows.items()
        }
        for future in as_completed(future_map):
            key = future_map[future]
            action, status_code, reason = future.result()
            results[key] = {
                "action": action,
                "status_code": status_code,
                "reason": reason,
            }

    dead_items: list[dict] = []
    dead_map: dict[str, dict] = {}
    for row in rows:
        key = row["canonical_url"]
        result = results.get(key)
        if not result or result["action"] != "dead":
            continue
        item = {
            "path": row["path"],
            "title": row["title"],
            "url": row["url"],
            "canonical_url": key,
            "status_code": result["status_code"],
            "reason": result["reason"],
            "status_label": str(result["status_code"] or result["reason"]),
        }
        dead_items.append(item)
        dead_map[key] = item

    stats = {"removed_dead": 0}
    new_toolbar = clone_node(toolbar)
    cleaned_toolbar = remove_dead_bookmarks(new_toolbar, [], dead_map, stats)
    if cleaned_toolbar is None:
        raise ValueError("删除后书签栏为空，结果异常")

    new_roots = []
    for node in parser_obj.roots:
        if node is toolbar:
            new_roots.append(cleaned_toolbar)
        else:
            new_roots.append(node)

    output_path.write_text(serialize_document(new_roots), encoding="utf-8")
    report_path.write_text(
        render_report(input_path.name, output_path.name, len(unique_rows), skipped, dead_items),
        encoding="utf-8",
    )
    json_path.write_text(
        json.dumps(
            {
                "checked": len(unique_rows),
                "skipped": skipped,
                "removed_dead": stats["removed_dead"],
                "dead_items": dead_items,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"wrote html: {output_path}")
    print(f"wrote report: {report_path}")
    print(f"wrote json: {json_path}")
    print(f"checked_unique_urls: {len(unique_rows)}")
    print(f"skipped_bookmarks: {skipped}")
    print(f"removed_dead: {stats['removed_dead']}")


if __name__ == "__main__":
    main()
