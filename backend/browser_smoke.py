"""Run a release smoke test against the built frontend and a disposable API."""

from contextlib import closing
from html import escape
from io import BytesIO
from pathlib import Path
import re
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
from time import monotonic, sleep
from zipfile import ZIP_DEFLATED, ZipFile

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


def import_fixtures(chromium, number):
    with closing(chromium.launch()) as browser:
        page = browser.new_page()
        pdfs = []
        for index, (customer, carrier, amount) in enumerate(
            [("Заказчик Тест", "Экспедитор Тест", 90000), ("Экспедитор Тест", "Перевозчик Тест", 70000)]
        ):
            text = (
                f"Заявка № {number} от 09.11.2026\nЗаказчик: {customer}\n"
                f"Исполнитель: {carrier}\n"
                "ПОГРУЗКА: Тестовый склад\nДата и время: 12.11.2026 09:00\n"
                "ВЫГРУЗКА: Тестовый терминал\nДата и время: 13.11.2026 09:00\n"
                f"ОПЛАТА: {amount} руб без НДС"
            )
            page.set_content(f'<meta charset="utf-8"><pre>{escape(text)}</pre>')
            pdfs.append({"name": f"order-{index}.pdf", "mimeType": "application/pdf", "buffer": page.pdf()})

    headers = ("Дата", "Номер заявки", "Заказчик", "Перевозчик", "Направление",
               "Ставка с Заказчиком", "Ставка с Перевозчиком", "Маржа", "Загрузка",
               "Выгрузка", "Заказ-заявка", "ЭТРН")
    rows = [headers, ("2026-11-09", f"EXCEL-{number}", "Тестовый заказчик", "", "", "", "", "5000",
                      "11.11.2026 08:00", "13.11.2026 15:00")]
    xml_rows = []
    for index, row in enumerate(rows, 1):
        cells = "".join(f'<c r="{chr(65 + col)}{index}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
                        for col, value in enumerate(row))
        xml_rows.append(f'<row r="{index}">{cells}</row>')
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    package_rel = "http://schemas.openxmlformats.org/package/2006/relationships"
    data = BytesIO()
    with ZipFile(data, "w", ZIP_DEFLATED) as xlsx:
        xlsx.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        xlsx.writestr("_rels/.rels", f'<Relationships xmlns="{package_rel}"><Relationship Id="rId1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        xlsx.writestr("xl/workbook.xml", f'<workbook xmlns="{main}" xmlns:r="{rel}"><sheets><sheet name="Ноябрь" sheetId="1" r:id="rId1"/></sheets></workbook>')
        xlsx.writestr("xl/_rels/workbook.xml.rels", f'<Relationships xmlns="{package_rel}"><Relationship Id="rId1" Type="{rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        xlsx.writestr("xl/worksheets/sheet1.xml", f'<worksheet xmlns="{main}"><sheetData>{"".join(xml_rows)}</sheetData></worksheet>')
    return pdfs, {"name": "orders.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "buffer": data.getvalue()}


def click_workspace_action(page, button, mobile):
    menu = page.locator("#workspace-menu")
    if mobile and menu.get_attribute("open") is None:
        menu.locator("summary").click()
    page.locator(button).click()


def order_lifecycle(page, chromium, number, order_a, report_total, mobile):
    pdfs, workbook = import_fixtures(chromium, number)
    page.locator("#import").click()
    page.locator("#customer-pdf").set_input_files(pdfs[0])
    page.locator("#carrier-pdf").set_input_files(pdfs[1])
    page.locator('#import-form [type="submit"]').click()
    expect(page.locator("#review-dialog")).to_be_visible()
    expect(page.locator("#review-title")).to_contain_text(str(number))
    page.locator("#review-save").click()
    expect(page.locator("#review-dialog")).to_be_hidden()

    click_workspace_action(page, "#ledger", mobile)
    page.locator("#ledger-file").set_input_files(workbook)
    page.locator('#ledger-form [type="submit"]').click()
    expect(page.locator("#ledger-dialog")).to_be_hidden()
    expect(page.locator("#table")).to_contain_text(f"EXCEL-{number}")

    registry_views(page, number, order_a, mobile)

    row = page.locator("#table .order").filter(has=page.get_by_role("button", name=f"№ {number}", exact=True))
    row.locator(".etrn-link").click()
    page.locator('#etrn-form [name="manualComplete"]').check()
    page.locator("#etrn-save").click()
    expect(page.locator("#etrn-dialog")).to_be_hidden()
    expect(row.locator(".etrn-link")).to_have_text("Закрыта вручную")
    row.locator(".trip-status").select_option("unloaded")
    expect(page.locator("#archive")).to_be_visible()
    page.locator("#archive-title").click()
    expect(page.locator("#archive-table")).to_contain_text(str(number))

    click_workspace_action(page, "#report", mobile)
    page.locator("#report-month").fill("2026-11")
    expect(page.locator("#report-preview h3")).to_have_text(re.compile(report_total))
    page.locator("#report-dialog [data-close]").click()


def registry_views(page, number, order_a, mobile):
    layout = page.locator("#layout")
    registry = page.locator("#table")
    search = page.locator("#search")
    settings = page.locator("#settings-dialog")
    order = f"№ {number}"
    excel = f"№ EXCEL-{number}"
    undated = f"№ {order_a}"
    sort = page.locator("#sort")
    direction = page.locator("#sort-direction")
    fixture_numbers = re.compile(r"^(?:" + "|".join(map(re.escape, (order, excel, undated))) + r")$")
    marker = {
        "table": ".order-table", "compact": ".compact-list",
        "kanban": ".kanban", "split": ".split-view",
    }

    def theme(value):
        click_workspace_action(page, "#settings", mobile)
        expect(settings.locator("#settings-account")).to_have_text("first@example.test")
        settings.locator("#theme").select_option(value)
        expect(page.locator("html")).to_have_attribute("data-theme", value)
        settings.locator("[data-close]").click()

    expect(page.locator("html")).to_have_attribute("data-theme", "violet")
    expect(layout).to_have_value("table")
    expect(sort).to_have_value("delivery")
    expect(registry.locator(".order-link").filter(has_text=fixture_numbers)).to_have_text([order, excel, undated])
    expect(page.locator('#table [data-sort="delivery"]')).to_have_attribute("aria-current", "true")
    if mobile:
        page.locator("#sort").select_option("pickup")
    else:
        page.locator('#table [data-sort="pickup"]').click()
    expect(page.locator("#sort")).to_have_value("pickup")
    row_without_contacts = registry.locator(".order").filter(has=page.get_by_text(undated, exact=True))
    expect(row_without_contacts.get_by_text("Нет контактов")).to_be_visible()
    expect(row_without_contacts.locator(".row-contacts")).to_have_count(0)
    expect(layout.locator("option")).to_have_count(4)

    click_workspace_action(page, "#settings", mobile)
    settings.locator("#status-color-signed").fill("#ee9911")
    settings.locator("[data-close]").click()
    page.reload()
    expect(registry).to_contain_text(order)
    assert page.locator("html").evaluate("(root) => root.style.getPropertyValue('--status-signed')") == "#ee9911"

    page.locator('[data-view="not-unloaded"]').click()
    for appearance in ("violet", "sand"):
        theme(appearance)
        for view, selector in marker.items():
            layout.select_option(view)
            expect(registry.locator(selector)).to_be_visible()
            expect(registry).to_contain_text(order)
            expect(registry).to_contain_text("EXCEL-")
            # All three fixture orders share a trip stage, so this also checks ordering inside a kanban column.
            numbers = registry.locator(".order-link" if view == "table" else ".order-summary > strong")
            numbers = numbers.filter(has_text=fixture_numbers)
            for column, ascending in (("delivery", [order, excel]), ("pickup", [excel, order])):
                sort.select_option(column)
                expect(numbers).to_have_text([*ascending, undated])
                direction.click()
                expect(numbers).to_have_text([*reversed(ascending), undated])
            search.fill("no such synthetic order")
            expect(registry).to_contain_text("Заявки не найдены")
            search.clear()
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            if view == "split":
                entry = registry.locator(".order-summary").filter(has_text=order).first
                entry.click()
                panel = registry.locator(".split-detail")
                expect(panel).to_be_visible()
                expect(panel.locator("h2")).to_have_text(f"Заявка {order}")
                panel.get_by_role("button", name="Открыть заявку").click()
                expect(page.locator("#editor")).to_be_visible()
                page.locator("#editor .dialog-head [data-close]").click()
                if mobile:
                    if appearance == "sand":
                        expect(registry.locator(".split-list")).to_be_visible()
                        expect(registry.locator(".split-list li .split-detail")).to_be_visible()
                    else:
                        expect(registry.locator(".split-list")).to_be_hidden()
                    panel.locator(".split-back").click()
                    expect(registry.locator(".split-list")).to_be_visible()

    click_workspace_action(page, "#settings", mobile)
    settings.locator("#accent-color").fill("#226650")
    expect(page.locator("html")).to_have_attribute("style", re.compile("--custom-accent: #226650"))
    settings.locator("#settings-layout").select_option("kanban")
    settings.locator("[data-close]").click()
    expect(layout).to_have_value("kanban")
    page.reload()
    expect(layout).to_have_value("kanban")
    expect(page.locator("html")).to_have_attribute("data-theme", "sand")
    expect(page.locator("html")).to_have_attribute("style", re.compile("--custom-accent: #226650"))
    expect(registry).to_contain_text(order)
    page.locator('[data-view="not-unloaded"]').click()

    card = registry.locator(".kanban-card").filter(has_text=f"№ EXCEL-{number}")
    trip = card.locator(".trip-status")
    original = trip.input_value()
    page.once("dialog", lambda dialog: dialog.dismiss())
    trip.select_option("unloaded")
    expect(trip).to_have_value(original)

    def conflict(route):
        if route.request.method == "PUT":
            route.fulfill(status=409)
        else:
            route.continue_()

    page.route("**/api/records", conflict)
    page.once("dialog", lambda dialog: dialog.accept())
    trip.select_option("unloaded")
    expect(page.locator("#notice")).to_contain_text("другом устройстве")
    expect(trip).to_have_value(original)
    page.unroute("**/api/records", conflict)

    page.once("dialog", lambda dialog: dialog.accept())
    trip.select_option("unloaded")
    expect(page.locator("#notice")).to_have_text("Статус рейса сохранён.")
    expect(card).to_have_count(0)
    page.locator('[data-view="all"]').click()
    expect(card.locator(".trip-status")).to_have_value("unloaded")
    expect(card.locator(".etrn-link")).to_have_text("К созданию")
    page.once("dialog", lambda dialog: dialog.accept())
    card.locator(".trip-status").select_option(original)
    expect(card.locator(".trip-status")).to_have_value(original)
    expect(page.locator("#notice")).to_have_text("Статус рейса сохранён.")
    layout.select_option("table")
    theme("violet")
    assert page.locator("html").evaluate("(root) => root.style.getPropertyValue('--custom-accent')") == ""
    theme("sand")
    click_workspace_action(page, "#settings", mobile)
    settings.locator("#reset-accent").click()
    expect(settings.locator("#accent-color")).to_have_value("#252525")
    settings.locator("[data-close]").click()
    theme("violet")
    layout.select_option("table")


def smoke(browser_type, origin, chromium, number, report_total, device=None):
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
        order_lifecycle(a, chromium, number, order_a, report_total, device is not None)
        a.get_by_role("button", name=f"№ {order_a}", exact=True).click()
        expect(a.locator("#editor")).to_be_visible()

        b = independent.new_page()
        b.goto(origin)
        sign_in(b, "second")
        expect(b.locator("#table")).not_to_contain_text(order_a)
        create_order(b, order_b)

        click_workspace_action(peer, "#sign-out", device is not None)
        expect(peer.locator("#sign-in")).to_be_visible()
        expect(a.locator("#sign-in")).to_be_visible()
        expect(a.locator("#editor")).to_be_hidden()
        expect(a.locator("#table")).not_to_contain_text(order_a)
        sign_in(peer, "second")
        expect(peer.locator("#table")).to_contain_text(order_b)
        expect(peer.locator("#table")).not_to_contain_text(order_a)
        expect(a.locator("#workspace")).to_be_hidden()
        expect(b.locator("#table")).to_contain_text(order_b)
    print(f"{browser_type.name}: 2 themes × 4 registry views, pickup/delivery sorting, PDF, Excel, ETRN, archive, margin and account isolation passed", flush=True)


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
                smoke(playwright.chromium, origin, playwright.chromium, 41001, r"22\s*000")
                smoke(playwright.webkit, origin, playwright.chromium, 41002, r"44\s*000", playwright.devices["iPhone 13"])
        finally:
            server.terminate()
            server.wait(timeout=10)


if __name__ == "__main__":
    if len(sys.argv) == 3:
        serve(Path(sys.argv[1]), int(sys.argv[2]))
    else:
        main()
