"""Local synthetic UI regression: failed-order result, deletion and default sorting.

Called by browser_smoke against its disposable HTTPS server. Refuses production
origins and uses two separate synthetic account contexts; never reads real data.
"""
from contextlib import closing
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

from playwright.sync_api import expect

from backend.browser_smoke import click_scope, click_workspace_action, sign_in
from backend.test_app import order

FAILED = '41050'


def _snapshot(context, origin, headers):
    response = context.request.get(origin + '/api/records', headers=headers)
    assert response.status == 200, response.status
    return response.json()


def _seed(context, origin, records):
    me = context.request.get(origin + '/api/me')
    assert me.status == 200
    headers = {'Origin': origin, 'X-CSRF-Token': me.json()['csrf']}
    current = _snapshot(context, origin, headers)
    response = context.request.put(origin + '/api/records', headers=headers,
                                   data={'revision': current['revision'], 'orders': records})
    assert response.status == 200, (response.status, response.text())
    return headers


def _record(number, date, failed=False, margin=0, owner='first'):
    value = order(number)
    value.update(date=date, customer=f'Synthetic actions {owner}', ledgerMargin=margin,
                 trip={'stage': 'failed' if failed else 'new'})
    return value


def _link(page, number):
    return page.locator('#table .order-link').filter(has_text=re.compile(r'^№\s*' + re.escape(number) + r'$'))


def _open(page, number=FAILED):
    _link(page, number).click()
    expect(page.locator('#editor')).to_be_visible()
    page.locator('#order-management > summary').click()


def _close(page):
    page.locator('#editor [data-close]').first.click()
    expect(page.locator('#editor')).to_be_hidden()


def _confirm(page, selector, accept=True):
    page.once('dialog', lambda dialog: dialog.accept() if accept else dialog.dismiss())
    page.locator(selector).click()


def _default_sort(page, numbers):
    expect(page.locator('#sort')).to_have_value('date')
    expect(page.locator('#sort-direction')).to_have_text('↓')
    expect(page.locator('#table .order-link')).to_have_text(['№ ' + number for number in numbers])


def _reject_write(page, context, origin, headers, status, selector):
    before = _snapshot(context, origin, headers)
    writes = []

    def reject(route):
        if route.request.method == 'PUT':
            writes.append(route.request.post_data_json)
            route.fulfill(status=status, content_type='application/json', body='{}')
        else:
            route.continue_()

    page.route('**/api/records', reject)
    try:
        _confirm(page, selector)
        expect(page.locator('#editor-error')).not_to_have_text('')
        expect(page.locator('#editor')).to_be_visible()
        expect(page.locator(selector)).to_be_enabled()
        assert len(writes) == 1
        assert _snapshot(context, origin, headers) == before
    finally:
        page.unroute('**/api/records', reject)


def _pending_reopen_guard(page, context, origin, headers, method):
    """Closing an in-flight editor must not permit a replacement editor instance."""
    before = _snapshot(context, origin, headers)
    held = []
    intercepted = False

    def delay(route):
        nonlocal intercepted
        if route.request.method == method and not intercepted:
            intercepted = True
            held.append(route)
        else:
            route.continue_()

    _open(page)
    page.route('**/api/records', delay)
    try:
        _confirm(page, '#order-zero-result')
        expect(page.locator('#editor-form [type="submit"]')).to_be_disabled()
        # A browser expectation pumps the event loop until the intercepted request arrives.
        page.wait_for_function("() => document.querySelector('#editor-form [type=submit]').disabled")
        for _ in range(250):
            if held:
                break
            page.wait_for_timeout(20)
        assert held, f'{method} was not intercepted'
        _close(page)
        _link(page, FAILED).click()
        expect(page.locator('#editor')).to_be_hidden()
        expect(page.locator('#notice')).to_contain_text(re.compile('сохран', re.I))
        held.pop().fulfill(status=503, content_type='application/json', body='{}')
        expect(page.locator('#notice')).to_contain_text(re.compile('сервер|связ', re.I))
        assert _snapshot(context, origin, headers) == before
    finally:
        for route in held:
            route.abort()
        page.unroute('**/api/records', delay)
    _open(page)
    expect(page.locator('#order-zero-result')).to_be_enabled()
    expect(page.locator('#editor-form [type="submit"]')).to_be_enabled()
    _close(page)


def run(engine, origin, mobile=False):
    parsed = urlsplit(origin)
    assert parsed.scheme == 'https' and parsed.hostname in ('localhost', '127.0.0.1') and parsed.port, \
        'Synthetic order actions must run only against the disposable local HTTPS server'
    with closing(engine.launch()) as browser:
        profile = {'viewport': {'width': 393, 'height': 852}, 'is_mobile': True, 'has_touch': True} if mobile else {
            'viewport': {'width': 1280, 'height': 900}}
        contexts = [browser.new_context(ignore_https_errors=True, **profile) for _ in range(2)]
        try:
            pages = [context.new_page() for context in contexts]
            for page, user in zip(pages, ('first', 'second')):
                page.goto(origin, wait_until='domcontentloaded')
                sign_in(page, user)
            records = [
                _record(FAILED, '2026-11-19', failed=True, margin=321.25),
                _record('40999', '2026-11-19'),
                _record('41002', '2026-11-20'),
                _record('41010', '2026-11-20'),
            ]
            first = _seed(contexts[0], origin, records)
            second = _seed(contexts[1], origin, [_record(FAILED, '2026-11-19', failed=True,
                                                       margin=777, owner='second')])
            other_before = _snapshot(contexts[1], origin, second)
            page = pages[0]
            page.reload(wait_until='domcontentloaded')
            expect(page.locator('#sync-status')).to_have_text('Сохранено')
            page.locator('#layout').select_option('table')
            _default_sort(page, ['41010', '41002', '40999'])
            page.locator('#sort').select_option('number')
            click_scope(page, 'history', mobile)
            _default_sort(page, ['41010', '41002', '41050', '40999'])
            page.locator('#sort').select_option('customer')
            click_scope(page, 'active', mobile)
            _default_sort(page, ['41010', '41002', '40999'])
            click_scope(page, 'history', mobile)

            # Only failed trips expose neutral-result management.
            _open(page, '41010')
            expect(page.locator('#order-zero-result')).to_have_count(0)
            _close(page)
            _open(page)
            if os.environ.get('WORKSPACE_SMOKE_SCREENSHOTS'):
                folder = Path(os.environ['WORKSPACE_SMOKE_SCREENSHOTS'])
                folder.mkdir(parents=True, exist_ok=True)
                page.locator('#order-management').scroll_into_view_if_needed()
                page.screenshot(path=folder / f'order-management-{engine.name}-{"mobile" if mobile else "desktop"}.png')
            original = next(item for item in _snapshot(contexts[0], origin, first)['orders'] if item['number'] == FAILED)
            _reject_write(page, contexts[0], origin, first, 503, '#order-zero-result')
            _close(page)
            for method in ('GET', 'PUT'):
                _pending_reopen_guard(page, contexts[0], origin, first, method)

            _open(page)
            _confirm(page, '#order-zero-result')
            expect(page.locator('#editor')).to_be_hidden()
            zeroed = next(item for item in _snapshot(contexts[0], origin, first)['orders'] if item['number'] == FAILED)
            assert zeroed['ledgerMargin'] == 0
            assert {key: value for key, value in zeroed.items() if key not in ('ledgerMargin', 'updatedAt')} == {
                key: value for key, value in original.items() if key not in ('ledgerMargin', 'updatedAt')}
            assert _snapshot(contexts[1], origin, second) == other_before
            page.reload(wait_until='domcontentloaded')
            expect(page.locator('#sync-status')).to_have_text('Сохранено')
            click_workspace_action(page, '#report', mobile)
            page.locator('#report-month').fill('2026-11')
            expect(page.locator('#report-preview h3')).to_have_text(re.compile(r'^0(?:[,.]00)?\s*₽$'))
            page.locator('#report-dialog [data-close]').click()
            click_scope(page, 'history', mobile)
            _open(page)
            expect(page.locator('#editor-form [name="ledgerMargin"]')).to_have_value('0')
            before_cancel = _snapshot(contexts[0], origin, first)
            _confirm(page, '#order-delete', accept=False)
            expect(page.locator('#editor')).to_be_visible()
            assert _snapshot(contexts[0], origin, first) == before_cancel
            _reject_write(page, contexts[0], origin, first, 503, '#order-delete')
            _reject_write(page, contexts[0], origin, first, 409, '#order-delete')
            _confirm(page, '#order-delete')
            expect(page.locator('#editor')).to_be_hidden()
            assert FAILED not in {item['number'] for item in _snapshot(contexts[0], origin, first)['orders']}
            assert _snapshot(contexts[1], origin, second) == other_before
            page.reload(wait_until='domcontentloaded')
            expect(page.locator('#sync-status')).to_have_text('Сохранено')
            click_scope(page, 'history', mobile)
            expect(_link(page, FAILED)).to_have_count(0)
            pages[1].reload(wait_until='domcontentloaded')
            click_scope(pages[1], 'history', mobile)
            expect(_link(pages[1], FAILED)).to_be_visible()
            if os.environ.get('WORKSPACE_SMOKE_SCREENSHOTS'):
                folder = Path(os.environ['WORKSPACE_SMOKE_SCREENSHOTS'])
                folder.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=folder / f'order-actions-{engine.name}-{"mobile" if mobile else "desktop"}.png')
            print(f'{engine.name}: order neutral result/delete/isolation/conflict/reopen guard/date-desc passed', flush=True)
        finally:
            for context in contexts:
                context.close()
