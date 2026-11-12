"""Run a release smoke test against the built frontend and a disposable API."""

from contextlib import closing
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import monotonic, sleep

import httpx
from fastapi.staticfiles import StaticFiles
from playwright.sync_api import expect, sync_playwright
import uvicorn

from backend.app import add_user, create_app


PASSWORD = "synthetic-browser-test-password"


def serve(root, port):
    database = root / "workspace.sqlite3"
    app = create_app(database, f"https://localhost:{port}")
    for user in ("first", "second"):
        add_user(database, f"{user}@example.test", PASSWORD)
    app.mount("/", StaticFiles(directory="dist", html=True))
    uvicorn.run(
        app, host="127.0.0.1", port=port, access_log=False,
        ssl_certfile=str(root / "test.crt"), ssl_keyfile=str(root / "test.key"),
    )


def sign_in(page, user):
    page.locator('#sign-in-form [name="email"]').fill(f"{user}@example.test")
    page.locator('#sign-in-form [name="password"]').fill(PASSWORD)
    page.locator('#sign-in-form [type="submit"]').click()
    expect(page.locator("#account-email")).to_have_text(f"{user}@example.test")
    expect(page.locator("#sync-status")).to_have_text("")


def create_order(page, number):
    page.locator("#new").click()
    page.locator('#editor-form [name="number"]').fill(number)
    page.locator('#editor-form [name="customer"]').fill("Synthetic shipper")
    page.locator('#editor-form [type="submit"]').click()
    expect(page.locator("#editor")).to_be_hidden()
    expect(page.locator("#table")).to_contain_text(number)


def smoke(browser_type, origin, device=None):
    order_a = f"A-{browser_type.name}"
    order_b = f"B-{browser_type.name}"
    with closing(browser_type.launch()) as browser:
        first = browser.new_context(ignore_https_errors=True, **(device or {}))
        independent = browser.new_context(ignore_https_errors=True, **(device or {}))
        a = first.new_page()
        a.goto(origin)
        sign_in(a, "first")
        create_order(a, order_a)

        peer = first.new_page()
        peer.goto(origin)
        expect(peer.locator("#table")).to_contain_text(order_a)
        a.get_by_role("button", name=f"№ {order_a}", exact=True).click()
        expect(a.locator("#editor")).to_be_visible()

        b = independent.new_page()
        b.goto(origin)
        sign_in(b, "second")
        expect(b.locator("#table")).not_to_contain_text(order_a)
        create_order(b, order_b)

        peer.locator("#sign-out").click()
        expect(peer.locator("#sign-in")).to_be_visible()
        expect(a.locator("#sign-in")).to_be_visible()
        expect(a.locator("#editor")).to_be_hidden()
        expect(a.locator("#table")).not_to_contain_text(order_a)
        sign_in(peer, "second")
        expect(peer.locator("#table")).to_contain_text(order_b)
        expect(peer.locator("#table")).not_to_contain_text(order_a)
        expect(a.locator("#workspace")).to_be_hidden()
        expect(b.locator("#table")).to_contain_text(order_b)
    print(f"{browser_type.name}: registry, shared-tab logout and account isolation passed", flush=True)


def main():
    with TemporaryDirectory() as directory:
        root = Path(directory)
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
             "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost",
             "-keyout", str(root / "test.key"), "-out", str(root / "test.crt")],
            check=True, capture_output=True,
        )
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"https://localhost:{port}"
        server = subprocess.Popen([sys.executable, "-m", "backend.browser_smoke", str(root), str(port)])
        try:
            with httpx.Client(verify=False, timeout=1, trust_env=False) as client:
                deadline = monotonic() + 20
                while True:
                    try:
                        if client.get(origin + "/api/me").status_code == 401:
                            break
                    except httpx.TransportError:
                        pass
                    if server.poll() is not None or monotonic() >= deadline:
                        raise RuntimeError("The disposable HTTPS server did not start.")
                    sleep(0.2)
            with sync_playwright() as playwright:
                smoke(playwright.chromium, origin)
                smoke(playwright.webkit, origin, playwright.devices["iPhone 13"])
        finally:
            server.terminate()
            server.wait(timeout=10)


if __name__ == "__main__":
    if len(sys.argv) == 3:
        serve(Path(sys.argv[1]), int(sys.argv[2]))
    else:
        main()
