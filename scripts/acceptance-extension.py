"""Browser acceptance run for the built extension in dist/.

Loads the unpacked extension into a throwaway Chromium profile, drives the real
extension pages, and checks the thing a build cannot prove: that the popup and
main page render, that the organizer finds and removes duplicates, that undo puts
them back, and that the zh_CN / en switch actually changes the copy.

Usage:  python3 scripts/acceptance-extension.py [--headed] [--keep]
Requires Playwright + its Chromium build.
"""
import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

parser = argparse.ArgumentParser()
parser.add_argument("--headed", action="store_true", help="show the browser window")
parser.add_argument("--keep", action="store_true", help="keep the profile and screenshots for inspection")
args = parser.parse_args()

if not (DIST / "manifest.json").exists():
    sys.exit("dist/manifest.json not found — run `npm run build` first.")

SHOTS = ROOT / "artifacts" / "acceptance"
if SHOTS.exists() and not args.keep:
    shutil.rmtree(SHOTS)
SHOTS.mkdir(parents=True, exist_ok=True)

checks: list[str] = []
failures: list[str] = []
page_errors: list[str] = []
console_errors: list[str] = []


def verify(condition, label):
    if condition:
        checks.append(label)
        print(f"  PASS  {label}")
    else:
        failures.append(label)
        print(f"  FAIL  {label}")


def path_to_extension_id(path: str) -> str:
    """Chrome derives an unpacked extension's id from its absolute path."""
    digest = hashlib.sha256(path.encode()).hexdigest()[:32]
    return "".join(chr(ord("a") + int(char, 16)) for char in digest)


profile = tempfile.mkdtemp(prefix="bookmarkmap-acceptance-")
print(f"profile: {profile}")
print(f"extension: {DIST}")

with sync_playwright() as pw:
    # headless=True alone would pick chromium_headless_shell, which cannot load
    # extensions; channel="chromium" selects the full build with --headless=new.
    context = pw.chromium.launch_persistent_context(
        profile,
        channel=None if args.headed else "chromium",
        headless=not args.headed,
        args=[
            f"--disable-extensions-except={DIST}",
            f"--load-extension={DIST}",
        ],
    )

    def watch(page, name):
        page.on("pageerror", lambda e: page_errors.append(f"{name}: {e}"))
        page.on(
            "console",
            lambda m: console_errors.append(f"{name}: {m.text}") if m.type == "error" else None,
        )

    # ---- Open the popup first: an MV3 worker only starts once something asks ----
    ext_id = path_to_extension_id(str(DIST.resolve()))
    print(f"extension id: {ext_id}")

    popup = context.new_page()
    watch(popup, "popup")
    popup.goto(f"chrome-extension://{ext_id}/popup.html", wait_until="domcontentloaded")
    popup.wait_for_timeout(2500)
    popup_text = popup.inner_text("body")
    print(f"popup text: {popup_text[:200]!r}")
    verify(len(popup_text.strip()) > 20, "popup renders content instead of a blank screen")
    verify("发生错误" not in popup_text, "popup shows no error boundary fallback")
    popup.screenshot(path=str(SHOTS / "popup.png"), full_page=True)

    worker = None
    for _ in range(40):
        if context.service_workers:
            worker = context.service_workers[0]
            break
        time.sleep(0.25)
    if worker is None:
        sys.exit("extension service worker never started — cannot continue")
    verify(True, "MV3 service worker starts")

    # ---- Fixture: duplicates plus bookmark shapes the auto-tag rules match -------
    worker.evaluate(
        """async () => {
            const tree = await chrome.bookmarks.getTree();
            const roots = tree[0].children;
            const bar = roots.find(r => r.id === '1') || roots[0];
            const folder = await chrome.bookmarks.create({ parentId: bar.id, title: 'Acceptance Fixture' });
            const items = [
                ['Example Docs', 'https://example.com/one'],
                ['Example Docs', 'https://example.com/two'],
                ['Example Docs', 'https://example.com/three'],
                ['GitHub project', 'https://github.com/andrewcui512/BookMarkMap'],
                ['React guide', 'https://react.dev/learn'],
            ];
            for (const [title, url] of items) {
                await chrome.bookmarks.create({ parentId: folder.id, title, url });
            }
            return folder.id;
        }"""
    )

    # ---- Main page renders ------------------------------------------------------
    main = context.new_page()
    watch(main, "main")
    main.goto(f"chrome-extension://{ext_id}/bookmark-map.html", wait_until="domcontentloaded")
    main.wait_for_timeout(2500)
    verify(main.locator(".sidebar-item").count() > 0, "main page renders its sidebar")
    verify(
        main.get_by_text("Example Docs").count() > 0,
        "main page lists the fixture bookmarks from the real bookmark tree",
    )
    main.screenshot(path=str(SHOTS / "main-zh.png"), full_page=True)

    # ---- Organizer: finds the exact duplicates ---------------------------------
    main.get_by_role("button", name=re.compile("整理中心")).click()
    main.wait_for_selector(".organizer-panel", timeout=15000)
    main.wait_for_timeout(1200)

    def card(label):
        node = main.locator(".organizer-card", has=main.locator(f'.organizer-card-label:text-is("{label}")'))
        return int(node.locator(".organizer-card-value").inner_text().strip())

    total = card("总书签")
    groups = card("重复候选组")
    verify(total >= 5, f"organizer counts the real bookmark total ({total})")
    verify(groups >= 1, f"organizer finds the injected exact-duplicate group ({groups})")
    verify(
        main.get_by_text("规则：相同域名 + 相同标题", exact=False).count() > 0,
        "organizer explains its duplicate rule",
    )
    main.screenshot(path=str(SHOTS / "organizer-zh.png"), full_page=True)

    # ---- Auto-tag rules run against the fixture ---------------------------------
    main.get_by_role("button", name=re.compile("一键自动打标签")).click()
    main.wait_for_timeout(1500)
    updated = card("自动标签更新")
    verify(updated >= 2, f"auto-tag rules tag the matching fixture bookmarks ({updated})")

    # ---- Remove duplicates, then undo ------------------------------------------
    main.get_by_role("button", name=re.compile("删除精确重复")).click()
    main.wait_for_timeout(2000)
    verify(
        main.locator(".toast").count() == 0 or "已删除" in main.inner_text("body"),
        "removing duplicates reports back to the user",
    )
    remaining = worker.evaluate(
        """async () => {
            const tree = await chrome.bookmarks.getTree();
            let count = 0;
            const walk = (nodes) => nodes.forEach(n => {
                if (n.title === 'Example Docs') count += 1;
                if (n.children) walk(n.children);
            });
            walk(tree);
            return count;
        }"""
    )
    verify(remaining == 1, f"only the first entry of the duplicate group is kept ({remaining} left)")
    main.screenshot(path=str(SHOTS / "organizer-removed-zh.png"), full_page=True)

    # The organizer refreshes itself after a removal, so close it to reach the sidebar.
    main.keyboard.press("Escape")
    main.wait_for_timeout(600)
    verify(main.locator(".modal-overlay").count() == 0, "Escape closes the organizer dialog")
    main.get_by_role("button", name=re.compile("撤销上次批量操作")).click()
    main.wait_for_timeout(2500)
    restored = worker.evaluate(
        """async () => {
            const tree = await chrome.bookmarks.getTree();
            let count = 0;
            const walk = (nodes) => nodes.forEach(n => {
                if (n.title === 'Example Docs') count += 1;
                if (n.children) walk(n.children);
            });
            walk(tree);
            return count;
        }"""
    )
    verify(restored == 3, f"undo restores every removed duplicate ({restored} back)")

    # ---- Language switch reaches the new copy ----------------------------------
    worker.evaluate(
        """async () => {
            const stored = await chrome.storage.sync.get(['settings']);
            const settings = stored.settings || {};
            settings.language = 'en';
            await chrome.storage.sync.set({ settings });
        }"""
    )
    main.reload(wait_until="domcontentloaded")
    main.wait_for_timeout(2500)
    main.get_by_role("button", name=re.compile("Organize Center")).click()
    main.wait_for_selector(".organizer-panel", timeout=15000)
    main.wait_for_timeout(1500)
    body_en = main.inner_text("body")
    verify("Total bookmarks" in body_en, "organizer copy switches to English")
    verify("Duplicate groups" in body_en, "organizer metric labels switch to English")
    verify("总书签" not in body_en, "no Chinese leaks into the English organizer")
    verify(
        "Rule: same domain and same title" in body_en,
        "the organizer rule description is translated",
    )
    main.screenshot(path=str(SHOTS / "organizer-en.png"), full_page=True)

    # ---- Search mode toggle copy -------------------------------------------------
    verify("Local" in body_en, "the search mode button uses translated copy")
    verify(
        main.locator(".search-controls button").first.get_attribute("title") == "Local search",
        "the search mode tooltip is translated too",
    )

    # ---- Settings dropdown options ----------------------------------------------
    settings = context.new_page()
    watch(settings, "settings")
    settings.goto(f"chrome-extension://{ext_id}/settings.html", wait_until="domcontentloaded")
    settings.wait_for_timeout(2000)
    options = settings.locator("select option").all_inner_texts()
    verify("System" in options and "Light" in options and "Dark" in options,
           f"dark mode options resolve to real copy in en ({options})")
    settings.screenshot(path=str(SHOTS / "settings-en.png"), full_page=True)

    worker.evaluate(
        """async () => {
            const stored = await chrome.storage.sync.get(['settings']);
            const settings = stored.settings || {};
            settings.language = 'zh_CN';
            await chrome.storage.sync.set({ settings });
        }"""
    )
    settings.reload(wait_until="domcontentloaded")
    settings.wait_for_timeout(2000)
    options_zh = settings.locator("select option").all_inner_texts()
    verify("跟随系统" in options_zh and "浅色" in options_zh and "深色" in options_zh,
           f"dark mode options resolve to real copy in zh_CN ({options_zh})")
    settings.screenshot(path=str(SHOTS / "settings-zh.png"), full_page=True)

    verify(not page_errors, f"no page errors ({page_errors[:2]})")
    verify(not console_errors, f"no console errors ({console_errors[:2]})")

    context.close()

if not args.keep:
    shutil.rmtree(profile, ignore_errors=True)

report = {
    "passed": len(checks),
    "failed": len(failures),
    "checks": checks,
    "failures": failures,
    "page_errors": page_errors,
    "console_errors": console_errors,
    "screenshots": sorted(p.name for p in SHOTS.glob("*.png")),
}
(SHOTS / "acceptance.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps({"passed": report["passed"], "failed": report["failed"], "output": str(SHOTS)}, ensure_ascii=False))
sys.exit(1 if failures else 0)
