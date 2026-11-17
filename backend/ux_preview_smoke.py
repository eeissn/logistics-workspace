"""Smoke-test the isolated UX preview build in Chromium, without a production API."""
from contextlib import closing
import socket
import subprocess
import sys
from time import monotonic, sleep

from playwright.sync_api import expect, sync_playwright


def main():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = subprocess.Popen([
        sys.executable, "-m", "http.server", str(port),
        "--bind", "127.0.0.1", "--directory", "dist",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as playwright:
            with closing(playwright.chromium.launch()) as browser:
                page = browser.new_page()
                deadline = monotonic() + 20
                while True:
                    try:
                        page.goto(f"http://127.0.0.1:{port}/", timeout=2500)
                        expect(page.locator("#workspace")).to_be_visible(timeout=2000)
                        break
                    except Exception:
                        if monotonic() >= deadline or server.poll() is not None:
                            raise RuntimeError("UX preview did not start")
                        sleep(.2)
                expect(page.locator("#month-metrics .metric-chip")).to_have_count(3)
                page.locator("#command-launch").click()
                expect(page.locator("#command-dialog")).to_be_visible()
                page.locator("#command-search").fill("история")
                page.locator("#command-search").press("Enter")
                expect(page.locator("#view-title")).to_have_text("История заявок")
                page.keyboard.press("Control+k")
                page.locator("#command-search").fill("список детали")
                page.locator("#command-search").press("Enter")
                expect(page.locator("#layout")).to_have_value("split")
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")

                context = browser.new_context(
                    **{**playwright.devices["iPhone 13"],
                       "viewport": {"width": 393, "height": 852}}
                )
                mobile = context.new_page()
                mobile.goto(f"http://127.0.0.1:{port}/")
                expect(mobile.locator("#mobile-dock")).to_be_visible()
                mobile.locator("#dock-history").click()
                expect(mobile.locator("#view-title")).to_have_text("История заявок")
                mobile.locator("#dock-active").click()
                expect(mobile.locator("#view-title")).to_have_text("Актуальные заявки")
                mobile.locator("#dock-search").click()
                expect(mobile.locator("#search")).to_be_focused()
                assert mobile.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                context.close()
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == "__main__":
    main()
