"""Exercise the Excel Lab offline demo through real Chromium; never touch production."""
from contextlib import closing
from pathlib import Path
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
        sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1",
        "--directory", "dist",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as playwright:
            with closing(playwright.chromium.launch()) as browser:
                page = browser.new_page(accept_downloads=True)
                deadline = monotonic() + 15
                while True:
                    try:
                        page.goto(f"http://127.0.0.1:{port}/", timeout=2000)
                        if page.locator("#excel-lab-controls").is_visible():
                            break
                    except Exception:
                        pass
                    if monotonic() > deadline:
                        raise RuntimeError("Excel Lab demo did not start")
                    sleep(.15)
                expect(page.locator("#excel-lab-controls")).to_be_visible()
                expect(page.locator("#sign-in")).to_be_hidden()
                # The existing Pages demos use a different localStorage namespace.
                page.evaluate("localStorage.setItem('logistics-workspace:v1', 'sibling-untouched')")
                with page.expect_download() as download_info:
                    page.locator('[data-lab-sample="alternate"]').click()
                alternate = download_info.value
                assert alternate.suggested_filename == "excel-alt-columns.xlsx"
                page.locator("#lab-open-excel").click()
                page.locator("#ledger-file").set_input_files(str(alternate.path()))
                page.locator("#ledger-form [type=submit]").click()
                expect(page.locator("#ledger-preview")).to_contain_text("К импорту: 2")
                expect(page.locator("#ledger-preview .ledger-example-preview")).to_contain_text("ALT-2026-01")
                page.locator("#ledger-form [type=submit]").click()
                expect(page.locator("#ledger-dialog")).to_be_hidden()
                expect(page.locator("#table")).to_contain_text("ALT-2026-01")
                expect(page.locator("#table")).to_contain_text("ALT-2026-02")

                with page.expect_download() as download_info:
                    page.locator('[data-lab-sample="invalid"]').click()
                invalid = download_info.value
                page.locator("#lab-open-excel").click()
                page.locator("#ledger-file").set_input_files(str(invalid.path()))
                page.locator("#ledger-form [type=submit]").click()
                expect(page.locator("#ledger-error")).to_contain_text(
                    "нет листов с колонками реестра"
                )
                expect(page.locator("#ledger-preview")).not_to_contain_text("К импорту:")
                page.locator("#ledger-dialog [data-close]").click()
                assert page.evaluate("localStorage.getItem('logistics-workspace:v1')") == 'sibling-untouched'
                assert page.evaluate("localStorage.getItem('logistics-workspace:excel-lab:v1')")
                page.once("dialog", lambda dialog: dialog.accept())
                page.locator("#lab-reset-demo").click()
                expect(page.locator("#table")).not_to_contain_text("ALT-2026-01")
                assert page.evaluate("localStorage.getItem('logistics-workspace:v1')") == 'sibling-untouched'
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == "__main__":
    main()
