"""Run a release smoke test against the built frontend and a disposable API."""

from contextlib import closing
from html import escape
from io import BytesIO
import os
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
    received = set()

    def sheet_preview(email, row):
        actor = {"first@example.test": "Герман", "second@example.test": "Марина"}[email]
        if row is None:
            return {"actor": actor}
        key = (email, tuple(sorted(row.items())))
        duplicate = key in received
        received.add(key)
        return {"actor": actor, "duplicate": duplicate}

    app = create_app(database, f"https://localhost:{port}", sheet_preview)
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
    expect(page.locator("#sync-status")).to_have_text("Сохранено")


def create_order(page, number):
    page.locator("#new").click()
    page.locator('#editor-form [name="number"]').fill(number)
    page.locator('#editor-form [name="customer"]').fill("Synthetic shipper")
    page.locator('#editor-form [type="submit"]').click()
    expect(page.locator("#editor")).to_be_hidden()
    expect(page.locator("#table")).to_contain_text(number)


def calculators(page, mobile):
    click_workspace_action(page, "#calculator", mobile)
    dialog = page.locator("#calculator-dialog")
    dialog.locator('[name="income"]').fill("90000")
    dialog.locator('[name="cost"]').fill("65000")
    expect(dialog.locator('[data-margin="grossMargin"]')).to_have_text(re.compile(r"25\s*000"))
    dialog.get_by_text("Сумма с НДС", exact=True).click()
    dialog.locator('[name="base"]').fill("35000")
    expect(dialog.locator('[data-vat="22"]')).to_have_text(re.compile(r"43\s*000"))
    dialog.locator("[data-close]").click()
    click_workspace_action(page, "#cargo-open", mobile)
    cargo = page.locator("#cargo-dialog")
    expect(cargo.locator("#vol")).not_to_have_text("0")
    cargo.locator("#add").click()
    cargo.locator("#auto").click()
    expect(cargo.locator("#autoinfo")).not_to_have_text("")
    expect(cargo.locator("#pdf")).to_be_enabled()
    cargo.locator("[data-close]").click()


def sheet_preview(page, actor, number):
    if os.environ.get("WORKSPACE_TEST_SHEET") != "1":
        return
    page.locator("#new").click()
    page.locator("#sheet-open").click()
    dialog = page.locator("#sheet-dialog")
    expect(dialog.locator("#sheet-actor")).to_have_value(actor)
    text = f"Заявка {number}, перевозка оборудования, 35000 рублей, обратились 13 ноября 2026, обещали 18 ноября 2026"
    dialog.locator("#sheet-paste").fill(text)
    dialog.locator("#sheet-parse").click()
    expect(dialog.locator('[name="requested"]')).to_have_value("2026-11-13")
    dialog.locator("[type=submit]").click()
    expect(dialog.locator("#sheet-status")).to_have_text("Тестовая строка принята.")
    page.reload()
    page.locator("#new").click()
    page.locator("#sheet-open").click()
    dialog.locator("#sheet-paste").fill(text)
    dialog.locator("#sheet-parse").click()
    dialog.locator("[type=submit]").click()
    expect(dialog.locator("#sheet-status")).to_have_text("Эта строка уже принята тестовым получателем.")
    dialog.locator("[data-close]").click()
    page.locator("#editor .dialog-head [data-close]").click()


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
        if index == 2:
            cells = cells.replace('r="B2"', 'r="B2" s="1"')
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
        xlsx.writestr("xl/styles.xml", f'<styleSheet xmlns="{main}"><fills><fill/><fill><patternFill patternType="solid"><fgColor rgb="FFA2C4C9"/></patternFill></fill></fills><cellXfs><xf fillId="0"/><xf fillId="1"/></cellXfs></styleSheet>')
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
    expect(page.locator("#ledger-preview")).to_contain_text("К импорту: 1")
    expect(page.locator("#ledger-preview")).to_contain_text("Выгрузился (1)")
    page.locator('#ledger-form [type="submit"]').click()
    expect(page.locator("#ledger-dialog")).to_be_hidden()
    excel_row = page.locator("#table .order").filter(has_text=f"EXCEL-{number}")
    expect(excel_row.locator(".trip-status")).to_have_value("unloaded")
    excel_row.locator(".trip-status").select_option("new")
    expect(page.locator("#notice")).to_have_text("Статус рейса сохранён.")
    expect(page.locator("#table")).to_contain_text(f"EXCEL-{number}")

    registry_views(page, number, order_a, mobile)

    row = page.locator("#table .order").filter(has=page.get_by_role("button", name=f"№ {number}", exact=True))
    row.locator(".etrn-link").click()
    dialog = page.locator("#etrn-dialog")
    required = dialog.get_by_role("checkbox", name="Требуется ЭТРН")
    required.uncheck()
    expect(dialog.locator("#etrn-status")).to_have_text("Не требуется")
    expect(dialog.locator("#etrn-fields")).to_be_hidden()
    required.check()
    expect(dialog.locator(".etrn-stages strong")).to_have_text(
        ["Создана заказ-заявка", "Создана ЭТРН", "Подписана всеми"])
    dialog.locator('[name="etrnNumber"]').fill(f"ETRN-{number}")
    for name in ("orderForm", "created", "allSigned"):
        dialog.locator(f'[name="{name}"]').check()
    expect(dialog.locator("#etrn-status")).to_have_text("Подписана")
    dialog.get_by_role("button", name="Отмена").click()
    row.locator(".etrn-link").click()
    expect(dialog.locator('[name="etrnNumber"]')).not_to_have_value(f"ETRN-{number}")
    dialog.locator('[name="manualComplete"]').check()
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
        if value == "sand":
            expect(settings.locator("#violet-palette")).to_be_hidden()
            expect(page.locator("html")).to_have_css("background-color", "rgb(255, 255, 255)")
        settings.locator("[data-close]").click()

    expect(page.locator("html")).to_have_attribute("data-theme", "sputnik")
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
    expect(page.get_by_role("group", name="Виды реестра")).to_have_count(0)

    theme("violet")
    click_workspace_action(page, "#settings", mobile)
    palette = settings.locator("#violet-palette")
    expect(palette.locator("option")).to_have_count(7)
    root = page.locator("html")
    original = root.evaluate("(element) => getComputedStyle(element).backgroundColor")
    palette.select_option("blue")
    expect(root).to_have_attribute("data-violet-palette", "blue")
    assert root.evaluate("(element) => getComputedStyle(element).backgroundColor") != original
    settings.locator("#status-palette summary").click()
    settings.locator("#status-color-signed").fill("#ee9911")
    settings.locator("[data-close]").click()
    page.reload()
    expect(registry).to_contain_text(order)
    expect(root).to_have_attribute("data-violet-palette", "blue")
    assert root.evaluate("(root) => root.style.getPropertyValue('--status-signed')") == "#ee9911"

    expect(page.locator(".registry-tabs button")).to_have_count(2)
    page.locator('[data-view="not-unloaded"]').click()
    for appearance in ("sputnik", "violet", "sand"):
        theme(appearance)
        filters = page.get_by_role("button", name="Фильтры", exact=True)
        filters.click()
        page.locator("#filter").select_option("pending")
        page.locator("#filters-dialog [data-close]").click()
        expect(page.locator("#filters-count")).to_have_text("1")
        expect(page.locator("#filters-count")).to_be_visible()
        expect(page.get_by_role("button", name="Фильтры: 1")).to_be_visible()
        page.locator("#filters-open").click()
        page.locator("#filter-view").select_option("loaded")
        page.locator("#filters-dialog [data-close]").click()
        expect(page.locator("#filters-count")).to_have_text("2")
        expect(page.locator("#active-filters")).to_have_text("Загрузились · ЭТРН требуют внимания")
        expect(registry).not_to_contain_text(order)
        page.locator('[data-view="not-unloaded"]').click()
        expect(page.locator("#filters-count")).to_have_text("1")
        expect(page.locator("#filter-view")).to_have_value("not-unloaded")

        period = page.locator("#period-open")
        period.click()
        page.locator("#period-from").fill("2026-11-09")
        page.locator("#period-to").fill("2026-11-13")
        page.get_by_role("button", name="Применить").click()
        expect(period).to_have_text("09.11–13.11")
        expect(period).to_have_accessible_name("Период: 2026-11-09 — 2026-11-13")
        if mobile:
            assert page.evaluate("""() => ['#search', '#filters-open', '#period-open', '#new', '#import'].every(selector => {
                const rect = document.querySelector(selector).getBoundingClientRect();
                return rect.left >= 0 && rect.right <= innerWidth && rect.height >= 44;
            })""")
        period.click()
        page.locator("#period-reset").click()
        expect(period).to_have_text("Период")
        page.locator("#filters-open").click()
        page.locator("#filter").select_option("")
        page.locator("#filters-dialog [data-close]").click()
        expect(page.locator("#filters-count")).to_be_hidden()
        screenshot_folder = os.environ.get("WORKSPACE_SMOKE_SCREENSHOTS")
        if screenshot_folder:
            picture = Path(screenshot_folder)
            picture.mkdir(parents=True, exist_ok=True)
            profile = "mobile" if mobile else "desktop"
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
            if screenshot_folder and view == "table":
                page.screenshot(path=picture / f"{appearance}-{profile}-table.png")
            if view == "split":
                entry = registry.locator(".order-summary").filter(has_text=order).first
                entry.click()
                panel = registry.locator(".split-detail")
                expect(panel).to_be_visible()
                expect(panel.locator("h2")).to_have_text(f"Заявка {order}")
                expect(panel.locator(".trip-overview-route")).to_be_visible()
                expect(panel.locator(".trip-progress li")).to_have_count(4)
                expect(panel.locator(".trip-progress [aria-current=step]")).to_have_count(1)
                expect(panel.locator(".split-points li")).to_have_count(2)
                expect(panel.locator(":scope > .etrn-link")).to_be_visible()
                assert panel.locator(".split-windows").evaluate(
                    "element => element.nextElementSibling.querySelector('dt').textContent === 'Заказчик'"
                )
                if screenshot_folder:
                    panel.scroll_into_view_if_needed()
                    page.screenshot(path=picture / f"{appearance}-{profile}-details.png")
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
    expect(page.locator("#sync-status")).to_have_text("Ошибка сохранения")
    expect(trip).to_have_value(original)
    page.unroute("**/api/records", conflict)

    page.once("dialog", lambda dialog: dialog.accept())
    trip.select_option("unloaded")
    expect(page.locator("#notice")).to_have_text("Статус рейса сохранён.")
    expect(page.locator("#sync-status")).to_have_text("Сохранено")
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


def contacts_viewport(page, number):
    prefix = f"CONTACT-{number}-"
    page.evaluate("""async prefix => {
        const {csrf} = await (await fetch('/api/me')).json();
        const headers = {'X-CSRF-Token': csrf, 'Content-Type': 'application/json'};
        const {revision, orders} = await (await fetch('/api/records', {headers})).json();
        const fixtures = Array.from({length: 34}, (_, index) => ({
            number: prefix + String(index + 1).padStart(2, '0'),
            date: '2026-11-10', points: [], differences: [], trip: {}, payment: {}, etrn: {},
            contacts: [{role: 'Водитель', values: ['Учебный водитель +70000000001']}],
        }));
        const response = await fetch('/api/records', {
            method: 'PUT', headers, body: JSON.stringify({revision, orders: [...orders, ...fixtures]}),
        });
        if (!response.ok) throw new Error('Could not prepare contact fixtures');
    }""", prefix)
    page.reload()
    page.locator("#search").fill(prefix)
    rows = page.locator("#table .order")
    expect(rows).to_have_count(34)
    panel = page.locator("#contact-popover")

    def check_placement(number, edge):
        row = rows.filter(has=page.get_by_role("button", name=f"№ {prefix}{number}", exact=True))
        trigger = row.locator(".row-contacts")
        trigger.evaluate("""(node, edge) => {
            node.scrollIntoView({block:'center'});
            const rect = node.getBoundingClientRect();
            const target = edge === 'top' ? 40 : window.innerHeight - 80;
            window.scrollBy(0, rect.top - target);
        }""", edge)
        trigger.click()
        expect(panel).to_be_visible()
        expect(trigger).to_have_attribute("aria-expanded", "true")
        expect(panel.get_by_role("link")).to_have_attribute("href", "tel:+70000000001")
        popup, button = panel.bounding_box(), trigger.bounding_box()
        viewport = page.evaluate("({width: innerWidth, height: innerHeight})")
        assert popup["x"] >= 0 and popup["x"] + popup["width"] <= viewport["width"]
        assert popup["y"] >= 0 and popup["y"] + popup["height"] <= viewport["height"]
        if edge == "top":
            assert popup["y"] >= button["y"] + button["height"]
        else:
            assert popup["y"] + popup["height"] <= button["y"]
        return trigger

    trigger = check_placement("20", "top")
    page.keyboard.press("Escape")
    expect(panel).to_be_hidden()
    expect(trigger).to_be_focused()
    trigger = check_placement("20", "top")
    driver = trigger.locator("..").get_by_role("button", name="Данные водителя")
    expect(panel.get_by_role("link")).to_be_focused()
    page.keyboard.press("Tab")
    expect(panel.get_by_role("button", name="Закрыть")).to_be_focused()
    page.keyboard.press("Tab")
    expect(panel).to_be_hidden()
    expect(driver).to_be_focused()

    trigger = check_placement("20", "top")
    page.keyboard.press("Shift+Tab")
    expect(panel).to_be_hidden()
    expect(trigger).to_be_focused()

    check_placement("02", "bottom")
    page.evaluate("window.scrollTo(0, 0)")
    expect(panel).to_be_hidden()
    page.locator("#search").clear()


def smoke(browser_type, origin, chromium, number, report_total, device=None):
    order_a = f"A-{browser_type.name}"
    order_b = f"B-{browser_type.name}"
    with closing(browser_type.launch()) as browser:
        first = browser.new_context(ignore_https_errors=True, **(device or {}))
        independent = browser.new_context(ignore_https_errors=True, **(device or {}))
        a = first.new_page()
        a.goto(origin)
        sign_in(a, "first")
        sheet_preview(a, "Герман", number)
        calculators(a, device is not None)
        create_order(a, order_a)

        peer = first.new_page()
        peer.goto(origin)
        expect(peer.locator("#table")).to_contain_text(order_a)
        order_lifecycle(a, chromium, number, order_a, report_total, device is not None)
        contacts_viewport(a, number)
        a.get_by_role("button", name=f"№ {order_a}", exact=True).click()
        expect(a.locator("#editor")).to_be_visible()

        b = independent.new_page()
        b.goto(origin)
        sign_in(b, "second")
        sheet_preview(b, "Марина", number)
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
    print(f"{browser_type.name}: 3 themes × 4 registry views, pickup/delivery sorting, PDF, Excel, ETRN, archive, margin and account isolation passed", flush=True)


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
