"""Read-only remote UI verification; synthetic records stay in disposable browser storage."""
from contextlib import closing
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from backend.browser_smoke import click_workspace_action

URL='https://eeissn.github.io/logistics-workspace/ux-preview/'


def main():
    folder=os.environ.get('WORKSPACE_SMOKE_SCREENSHOTS')
    root=Path(folder) if folder else None
    if root: root.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        for engine,mobile in ((p.chromium,False),(p.webkit,True)):
            with closing(engine.launch()) as browser:
                profile={**p.devices['iPhone 13'],'viewport':{'width':393,'height':852}} if mobile else {'viewport':{'width':1280,'height':900}}
                context=browser.new_context(**profile)
                page=context.new_page()
                api=[]
                page.on('request',lambda req:api.append(req.url) if '/api/' in req.url else None)
                page.goto(URL,wait_until='networkidle')
                expect(page.locator('#demo-note')).to_be_visible()
                expect(page.locator('#sign-in')).to_be_hidden()
                page.locator('#new').click()
                page.locator('#editor-form [name=number]').fill('QA-PREVIEW-LONG-20261119-0000123456789')
                page.locator('#editor-form [name=customer]').fill('ООО «Синтетический заказчик с длинным учебным наименованием»')
                page.locator('#editor-form [name=route]').fill('Учебный склад в Московской области → Синтетический распределительный терминал с длинным названием в Нижегородской области')
                page.locator('#editor-form [name=carrier]').fill('ООО «Учебный перевозчик для проверки узкого экрана»')
                page.locator('#editor-form [type=submit]').click()
                expect(page.locator('#editor')).to_be_hidden()
                page.locator('#search').fill('QA-PREVIEW-LONG')
                for theme in ('sputnik','violet','sand','graphite'):
                    click_workspace_action(page,'#settings',mobile)
                    page.locator('#theme').select_option(theme)
                    page.locator('#settings-dialog [data-close]').first.click()
                    for layout in ('table','compact','kanban','split'):
                        page.locator('#layout').select_option(layout)
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),(theme,layout)
                        if root:
                            device='mobile' if mobile else 'desktop'
                            page.screenshot(path=root/f'public-{theme}-{device}-{layout}.png')
                assert not api,api
                print(f'{engine.name}: public preview 4 themes x 4 layouts; long labels, no authentication, no API requests passed',flush=True)
                context.close()


if __name__=='__main__':
    main()
