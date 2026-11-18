# Backup freshness P0, based on released 2d84332 · 18.11.2026

Владелец подтвердил P0: маржа по заявкам со статусом «Срыв заявки» учитывается в рабочих отчётах. Выпущен `2d84332` на VPS, SSH-проверка HTTPS/служб успешно пройдена. Повторного развёртывания ради этого исправления не требуется.

Следующий P0: read-only проверка свежести локального зашифрованного CMS-архива (`deploy/check_backup_freshness.py`), перенесена на базу актуального релиза в `feature/p0-backup-freshness-current-release-20261118`. Протокол SHA-256/size квитанций соответствует существующей доставке. Независимое оповещение, фактический Windows-каталог и проверка после перезагрузки остаются открыты; никакие данные/учётные записи/VPS не изменяются. Перед выпуском проверить CI последнего SHA.

# P0 · Failed trip margin must count · 18.11.2026

Владелец сообщил критическое правило: статус «Срыв заявки» **не** исключает финансовые поступления и расходы (компенсация за срыв может давать прибыль). Реализуем в `fix/p0-failed-trip-margin-in-financial-reports-20261118` на основе выпущенного `feature/two-user-sync` @ 2ed311a. Исправлены `monthReport`/сводка, `monthlyComparison` и тексты отчётов. Маржа по срыву берётся из `ledgerMargin` при наличии, иначе из ставок/НДС; неизвестная сумма остаётся неизвестной. Статусы рейса, «Актуальные» и архив, авторизация, SQLite схема и рабочие данные не меняются. Новая ветка не установлена на VPS; CI последнего SHA и реальная приёмка отдельно.

# User-requested manual margin editor · 18.11.2026

Новый приоритет владельца: вручную изменять сумму маржи внутри существующей заявки с любого вида и темы на Windows и iPhone. Ветка `feature/manual-margin-in-order-editor-20261118` от `feature/two-user-sync`. Единая форма `#editor` дополнена необязательным вводом `ledgerMargin`, сохраняемым через действующий авторизованный API с защитой версии; пустое значение возвращает формулу без изменения ставок. Excel-импорт с уже заданной маржей сохраняется. Регрессии JS + Chromium/WebKit; проверить CI последнего SHA. PR №34 (ЭТРН), №35 (backup freshness), №36 (PDF storage design) — параллельные незакрытые задачи, не потерять при объединении. Реальный VPS не изменён.

# Desktop simplification & active-ETRN ownership rule · 17.11.2026

Owner's post-release feedback: the desktop page shows too many equally weighted controls and monthly cards; the saved/connection status should appear **after** the refresh button. More critical: an unloaded truck must remain in «Актуальные» until ETRN is signed by everyone. Treat an explicit «Срыв заявки» as terminal, separate from the unsigned delivery scenario.

Implementation in `fix/active-etrn-desktop-focus-20261117`:
- `src/order-history.mjs` active predicate and `src/domain.mjs` archival predicate now agree: active if not canceled and not (unloaded AND ETRN «Подписана»). Manual closure / «Не требуется» are **not** equivalent to signing for the active queue. This deliberately leaves such unloaded cases visible for document follow-up until explicitly resolved. **No** auto-mutating ETRN or order status, no cross-user data access.
- Desktop header: refresh button comes before the saved-state indicator; compact month+margin disclosure replaces three always-visible KPI cards. Month, order count and margin remain available in one click; on iPhone existing full KPI chips remain. Duplicate «Актуальные/История» tabs are hidden **on desktop only**, because persistent sidebar links already navigate. Desktop view/sort and bulk action share one quiet row.
- Regression gate: delivered-but-unsigned order remains active through save/reload and remains in active count; full ETRN signing moves it out; canceled trips remain terminal; 515-row fixtures retain expected proportions using explicit fully signed synthetic ETRN.
- Non-goals: re-architecting API, deleting records, changing SQLite schema/owners, replacing iPhone navigation, or modifying production VPS directly. History continues to be an **all-records** cross-month browser; it is not made exclusive to archived records in this patch.
- Desktop design principle (Apple HIG progressive disclosure / Attio): one primary action per page, controls at point of use, hide duplicate navigation, keep documentary exceptions conspicuous. Future pass should inspect operator flow and screenshot visual results rather than adding more permanent buttons.

# Post-release QA · 17.11.2026 (owner's five screenshots)

- Owner verified production symptoms after release: ETRN agreement-created checkbox is saved but badge remains «К созданию»; page toolbar has poor visual hierarchy; tiny «◫» quick-inspection action is not legible; sidebar is cluttered, duplicated navigation; applying quick filters or saved views collapses the entire desktop sidebar. Their separate account and colleague's account are isolated, so **do not equate combined backup order count (527) with either individual user's visible registry count**.
- Root cause ETRN: `etrnStatus` did not consider `orderForm` when `created=false`. Add «Заказ-заявка создана» as intermediate display stage. Keep this stage in pending ETRN filters and timelines. Persistence API is already covered by release/2026-11-17-etrn-ux; do not weaken account isolation or change stored schema.
- Root cause disappearing sidebar: `applyPersonalView` and `data-preset` handlers set `workspace-menu.open=false` unconditionally, hiding the entire `<details>`-backed desktop navigation. Close only in mobile layout. Add one-click reset to active/all.
- UX corrections: reorganize grouped tools/quick filters/saved views, remove duplicates; replace glyph-only detail trigger with visible readable label; improve typography/contacts/drawer width and a primary new-order action beside the title. Keep iPhone bottom dock.
- Quality gate: inspect desktop 1440px, intermediate 850px, iPhone narrow width, modal and quick-view, filter actions and navigation return, real ETRN badge transitions in fresh synthetic browser tests. Run GitHub Actions fully green on final SHA and physical Safari/Zen acceptance **before** deployment. Production 527 records and 2 accounts must remain untouched by code changes. No automatic release to VPS.

# P1 · утверждены все 10 UX-идей · 17.11.2026

- Пользователь дал явное согласие реализовать **все 10** идей из `UX_IDEAS_FOR_APPROVAL.md` и продолжать другие реальные P1. Создана ветка `feature/p1-ten-ideas-workspace` на базе `feature/p1-feedback-etrn-ux` (PR #22 с зелёным CI).
- Реализован UI/UX: быстрый просмотр заявки с тремя областями (данные, точки/оригиналы, ЭТРН), отдельные этапы рейса и ЭТРН, контекстные действия на desktop/iPhone, временный PDF только в текущем браузере без сервера, финансовые предупреждения и фильтры, сравнение маржи двух месяцев, более информативные настройки, новая Graphite, персональные виды и порядок столбцов.
- Платёжный вид «Не оплачено» **не включён:** достоверного поля факта оплаты нет; условия оплаты и сроки не равны поступлению денег. Автоматическое сохранение оригиналов PDF в реестре **не реализовано**: для него нужна серверная схема файлов, авторизация, резервирование и миграция; ссылки на несуществующие PDF не создавать. Оба подпункта отмечены открытыми.
- Тесты: JS `test/workspace-insights.test.mjs`, `test/saved-views.test.mjs`, проверки `test/registry.test.mjs`; браузерные `backend/ux_preview_smoke.py` (desktop/mobile) и штатный `backend/browser_smoke.py`, скорректированный для вкладок Settings → Updates/Registry. Статус **последнего** CI проверить по GitHub перед заявлением о готовности.
- `UX_IDEAS_FOR_APPROVAL.md`, `ROADMAP.md`, `src/updates.mjs` с регрессией документируют выполняемые задачи и фактические ограничения.
- Нет изменений main, рабочего VPS, реальной SQLite с 515 заявками, ключей и резервного расписания. Публикация отдельного UX-превью допускается через успешный CI; рабочий релиз только после отдельного согласования владельца.

## Завершение CI для PR #22 · 17.11.2026

- [x] Полный прогон коммита `0af5be2de685f2485fd04e5d7500836075593ee4`: API/SQLite, JS, build, Chromium и мобильный WebKit — **success**: https://github.com/eeissn/logistics-workspace/actions/runs/44051680108.
- [x] Публикация UX-превью после браузерной проверки — **success**: https://github.com/eeissn/logistics-workspace/actions/runs/44051679961. Изменения доступны только в автономной сборке `/ux-preview/`; массовое ЭТРН проверяется на API и временном тестовом сервере, не на Pages (там нет серверной авторизации).
- [ ] После завершающей документации повторно проверить последний SHA PR; физическая приёмка iPhone/Windows и согласованный выпуск рабочего VPS остаются открытыми.

# P1 по замечаниям владельца · 17.11.2026

- Скриншоты: 1 — демодиалог быстрых действий, 2 — три KPI, 3 — рабочая история с 71 выбранной заявкой (ЭТРН «Подписана»: готово 0, пропущено 71), плюс текст о поиске на iPhone.
- Ветка `feature/p1-feedback-etrn-ux` от `feature/p1-workspace-design-system`, без изменений main/production/VPS/SQLite. Сохранить понравившуюся нижнюю панель iPhone. Перенести «Действия» в боковое меню, улучшить типографику; вернуть кнопку «↻ Обновить» в авторизованную сводку; выровнять число заявок; исправить фокус поля поиска на iPhone.
- Причина 71 пропуска: `backend/bulk_etrn.py` требовал одновременно `etrn.created` и непустой `etrn.number`; теперь явно подтверждённый массовый `signed` заполняет по `order.number`, если номер отсутствует, сохраняет существующие номера и индивидуальные подписи. Перед записью можно редактировать каждый номер через `#bulk-numbers`; API строго валидирует возможный `etrnNumber` на каждый выбранный объект, предварительный просмотр не записывает, после изменения ввода сбрасывается и повторяется. Системные полномочия, CSRF и ревизии не ослаблены.
- Регрессии: backend 71 synthetic records with both accounts, browser Chromium 2 records with edited ETRN number, WebKit search containment and sync button. Полный CI последнего SHA проверить отдельно. Запись о новых функциях в `src/updates.mjs`, этапы в `ROADMAP.md`.
- Идеи на согласование **не кодить без решения владельца**, отдельный документ `UX_IDEAS_FOR_APPROVAL.md` со всеми 10 референсами.
- При обнаружении проблем с мобильной версткой или старым тестом не выдавать CI за зелёный: исправить дефекты в этой ветке и повторить полный прогон. Рабочая версия продолжает содержать старую ошибку массовой ЭТРН до отдельного согласованного релиза.

# Контрольная точка · 17.11.2026 — утверждённая UX 2.0 на основе шести продуктов

- Новое явное поручение владельца: внедрить по утверждённой таблице Attio, Linear, Steep, Raycast + Linear, Rill Browser, Kombai Gallery. Сначала сверены AGENTS, актуальный ROADMAP, src/app.mjs, src/style.css, мобильная разметка и браузерные тесты. P0 по прежнему перенесён на вечер; VPS, main и реальные 515 заявок не менять.
- Создана feature-ветка `feature/p1-workspace-design-system` от `feature/p1-excel-lab`. Реализованы безопасная командная палитра (только вызов существующих UI-действий; Ctrl/⌘+K и «/»), пять мобильных действий, сводка из трёх показателей прежнего `monthSnapshot`, стиль таблицы и боковых деталей, фокус, motion.
- `UX_2026_REFERENCES.md` документирует точное соответствие шести источников задачам без заимствования чужих материалов и без изменения финансовой/серверной логики.
- JavaScript и браузерные тесты расширены. `ux-preview-pages.yml` публикует автономную `/ux-preview/` на GitHub Pages с `VITE_DEMO=true`, отдельными ключами localStorage и синтетическими данными. Нельзя заявлять, что новый код установлен на VPS.
- `ROADMAP.md` и `src/updates.mjs` обновлены. Полный последний CI, реальная Pages-публикация и физическая приёмка устройств требуют отдельной проверки; не отмечать выполненными по одному коммиту.
- Следующие шаги: изучить конкретные падения CI, исправить только воспроизводимые дефекты; собрать отзыв владельца и коллеги о визуале; согласовывать release SHA отдельно.

# Контрольная точка P1 · 17.11.2026 — Excel Lab

- Владелец находится на рабочем ПК и разрешил сфокусироваться на P1, перенёс P0 на вечер. Никаких изменений рабочей SQLite/VPS.
- Проверены `ROADMAP.md`, `PROJECT_SPEC.md`, исходники `src/ledger.mjs` и вход Excel, действующий Pages `gh-pages`. Реальные 515 заявок уже импортированы владельцем — не повторять.
- Новая ветка `feature/p1-excel-lab`: поддержка безопасного сопоставления ограниченного набора альтернативных заголовков Excel с исходной моделью, регрессионные JS-тесты и 3 синтетических файла, генерируемых непосредственно в демобраузере. Демо изолировано `VITE_DEMO=true`, `VITE_EXCEL_LAB=true`, сохраняет данные только в localStorage, не обращается к production.
- Workflow `excel-lab-pages.yml` публикует только `/excel-lab/` в уже существующем gh-pages; не меняет прежние демо. Фактическую HTTP-доступность ссылки и результат CI проверять отдельно перед заявлением об успешной публичной приёмке.
- Ошибка браузерного регрессионного теста PR #18 локализована по реальному логу: новый набор 515 синтетических строк отклонён HTTP 422, существующие Chromium и WebKit сценарии прошли. Тестовый набор изменён на основе известной валидной заявки и добавлен вывод тела ошибки. Требуется зелёный повторный CI.
- Запись о Excel Lab добавлена в раздел «Обновления» только в коде ветки. На рабочем сайте нет нового релиза.

# Сверка чата «Сравнение ИИ агентов» и GitHub · 17.11.2026

**Источник:** доступные извлечённые реплики чата «Сравнение ИИ агентов» (11–16.11), дополнительные явные подтверждения владельца в этом разговоре (включая 515 рабочих заявок), текущие GitHub issues, ветки, PR #1–18 и их CI. Полный непрерывный построчный экспорт исходного чата в текущей среде недоступен; нельзя писать «прочитан весь чат целиком». Детальная актуальная карта помещена в начало `ROADMAP.md`; все прежние записи ниже исторические.

## Исправленные прежние допущения

- **515 настоящих заявок:** пользователь сообщил, что они уже импортированы и работают в выпущенной подсистеме. Синтетические 515-строчные тесты PR #17 и #18 не являются повторной загрузкой рабочих данных. Не заставлять пользователя повторять импорт.
- **Релиз/UI:** `c09c8fb` считается установленным по подтверждению владельца после сценария выпуска; iPhone Safari и Home Screen после полного закрытия повторно проверены владельцем. Независимая проверка фактического HEAD VPS и полная матрица интерфейса всё ещё открыты.
- **Резервирование:** реальная Windows-задача уже включена; архив 16.11 восстановлен побайтово, SHA-256 идентичен VPS, SQLite integrity ok, опция `openssl cms -decrypt -binary` обязательна. Контроль циклов после перезагрузки остаётся открытым, но первоначальная настройка завершена.
- **Реализованное vs открытое:** «Актуальные», «История», Excel, массовые статусы ЭТРН, PDF-дубликат, три показателя финансов, калькуляторы, информация водителя и раздел обновлений имеют существующий код/подтверждённые релизы; не планировать заново. Остались тонкая UI/UX-полировка, отдельные рабочие сценарии, справочник компаний ЭТРН только владельцу, Google Sheets авторизация, безопасная смена пароля, полноценная приёмка и мониторинг.
- **CI PR #18:** `ae25f73` — **failure** в браузерном шаге, как подтверждено GitHub Actions https://github.com/eeissn/logistics-workspace/actions/runs/44028928015. PR #17 `cd0a017` — success. Все PR #11–18 на момент сверки открыты и не слиты; нельзя выдавать их функции за новые опубликованные релизы.
- **Приоритет и метод:** начинать с актуальной карты, избегать повторов уже сделанного; выбирать конкретные пользовательские проблемы; каждую реально готовую функцию/исправление отражать в коде, ROADMAP, PR, тестах и понятном разделе «Обновления». Не писать в клиентский журнал внутреннюю диагностическую статистику и факты, которые ещё не выпущены.
- **Границы:** main, VPS, рабочая SQLite, секреты и реальные документы не менять без отдельного разрешения. «Capi» и старый «пункт №3» без уверенной расшифровки не реализовывать наугад.

# Контрольная точка · 17.11.2026 — P1 браузерная регрессия 515 заявок

- Сверены актуальные `AGENTS.md`, `PROJECT_SPEC.md`, `ROADMAP.md`, `AGENT_STATE.md` и полный CI PR #17 (`cd0a017`, success: https://github.com/eeissn/logistics-workspace/actions/runs/43960837844).
- Создан PR #18 `feature/large-year-browser-smoke` поверх PR #17: временный HTTPS API, 515 синтетических заявок в Chromium, «Актуальные» 74 / «История» 515, помесячный выбор, глобальный поиск в истории, проверка 4 вариантов отображения и переполнения экрана.
- В `src/updates.mjs` добавлена понятная запись, в `test/updates.test.mjs` — регрессия; в `ROADMAP.md` отмечен проверенный CI PR #17 и реализация сценария, но не закрыты физическая приёмка и измерения UI. CI PR #18 проверить по итогам последнего коммита.
- Важная граница: нет изменений рабочего VPS, реальной SQLite, SSH или планировщика Windows; UI ещё не обновлён.

# Контрольная точка · 17.11.2026 — P1 серверная регрессия 515 заявок

- Сверены `AGENTS.md`, `PROJECT_SPEC.md`, `ROADMAP.md`, `AGENT_STATE.md` и CI предыдущей ветки. Последний прогон PR #16 `5ad0606` успешно завершён: https://github.com/eeissn/logistics-workspace/actions/runs/43959934766. Отметка о результате внесена в ROADMAP.
- PR #17 (`feature/large-year-server-regression` от `feature/iso-schedule-today-filter`): 515 синтетических заявок с серверной записью/чтением, изменением записи, проверкой `updatedAt`, HTTP 409, изоляцией двух аккаунтов с одинаковым номером, SQLite backup/restore; JS-регрессия месячной истории за два года.
- Добавлена запись за 17.11 в `src/updates.mjs` и тест записи; `ROADMAP.md` выделяет и отмечает только реализованное и оставляет открытыми CI последнего SHA, тесты реальных данных/браузеров и измерение производительности.
- VPS, SQLite production, ключи и Task Scheduler не менялись. Изменения в GitHub ещё не означают выпуск сайта.

# Контрольная точка · 17.11.2026 — P1 фильтр рейсов по ISO-датам

- По согласованному циклу прочитаны `AGENTS.md`, `ROADMAP.md`, `PROJECT_SPEC.md`, `AGENT_STATE.md`, проверены коммит и CI предшествующего PR #15. Выявлена рассинхронизация: сортировка погрузки/выгрузки распознаёт ISO `YYYY-MM-DDTHH:MM`, фильтр `scheduledToday` не распознавал ISO.
- Исправлено в `src/domain.mjs` (общий разбор дат с ISO и привычным PDF форматом), добавлены регрессии в `test/workspace.test.mjs` и `test/registry.test.mjs`. В `ROADMAP.md` отмечена реализация, в `src/updates.mjs` добавлено описание для пользователей, дополнен тест истории.
- PR #16: https://github.com/eeissn/logistics-workspace/pull/16, база `feature/backup-restored-account-isolation`. Проверить CI последнего SHA перед утверждением блока; полная проверка на реальных устройствах и выпуск по-прежнему открыты.
- Производственный сайт и SQLite не изменялись. Не путать наличие коммита и историю обновлений с выпуском на VPS.

# Контрольная точка · 17.11.2026 — сверка ROADMAP и PR #15

- Сначала сверены `AGENTS.md`, `PROJECT_SPEC.md`, актуальный `ROADMAP.md`, `AGENT_STATE.md`, GitHub PR и CI. Выбран проверяемый P0-подпункт: защита разделения двух аккаунтов и целостности SQLite после восстановления.
- Создан PR #15 (`feature/backup-restored-account-isolation` → `feature/backup-acceptance-changelog`): тест побайтового CMS restore с `-binary`, проверка доступа двух пользователей к восстановленной SQLite и невозможности межпользовательской записи, новая запись от 17.11 в `src/updates.mjs` и проверки раздела «Обновления».
- В `ROADMAP.md` отмечены **только конкретные тестовые подпункты**. Физическая приёмка 4 видов × темы, сверка SHA/MIME работающего VPS, перезапуск домашнего Windows и будущие ночные копии остаются открытыми.
- Производственные VPS/SQLite/Windows Task не изменялись. Новые UI-изменения ещё не выпущены и не видны на сайте. Проверить CI PR #15 по окончании и не объявлять тесты производственной приёмкой.

# Контрольная точка · 16.11.2026

## Подтверждение релиза от владельца
- Владелец ответил `+` после запуска релизного скрипта для `e0b6b1fe1ea5f1771d71dff1d935a72860a032d7`; считать это **подтверждением выполнения шага**, но не независимой проверкой фактического HEAD или ответа сайта.
- Предыдущая установленная версия по выводу владельца: `69fa4eb20da3e3cbe336713fd8c6be26e0820359`. Скрипт включает предварительную проверку базы, откат, рестарт API и HTTP 200/401; итоговый терминальный вывод после последнего обновления не приложен.
- Последний CI релиз-кандидата: https://github.com/eeissn/logistics-workspace/actions/runs/43840676042 — success.
- Исправлено чтение даты паспорта из следующей строки PDF и устранён преждевременный откат при кратком HTTP 502.
- До полной приёмки: проверить новый PDF № 7374 из браузера после обновления страницы; сверить реальный HEAD VPS; проверить две темы и четыре вида на реальных Windows/iPhone. Не изменять рабочую SQLite или повторно импортировать действующую заявку без проверки предпросмотра.

# Контрольная точка · 14.11.2026

## Sputnik Workspace

- Исправление годового импорта выпущено 14.11.2026. VPS отдаёт сборку `4eb666d20bfe69dc5c123884c0464a4e2503b74a`; хеш публичного JS совпадает с установленным, службы активны, HTTPS 200 и API 401 без входа. При запуске был краткий 502, повторный запрос успешен. Предрелизный снимок `workspace-pre-4eb666d-20261114T065144Z.sqlite3` прошёл проверку, схема 2. Откат к `e82ea4d` из `/opt/logistics-workspace/releases/sputnik-4eb666d.SosYCx`. Фактический импорт под рабочим аккаунтом остаётся для владельца.

- Исправлен предпросмотр годового XLSX: читаются все листы с заголовками реестра, формульные строки шаблона без заявки не считаются ошибками, дубли сверяются между листами и с реестром. Локальная проверка только агрегатов исходной книги и имитация 31 уже импортированной заявки дали 11 листов, 515 строк, 484 новых, 31 дубль, 0 ошибок. Рабочий реестр не использован. Локально прошли 56 JS, 13 Python и сборка. Браузеры Playwright отсутствовали в локальном окружении, повторная проверка через CI.

- Выпуск 14.11.2026 подтверждён на VPS. Установлен `e82ea4dc170dff043c59d7047e3d7c9cfe09631f`. После запуска API один раз вернул 502, повторная и независимая проверки подтвердили HTTPS 200 и API 401 без сессии. Обе службы активны. Предрелизная копия `workspace-pre-e82ea4d-20261114T063611Z.sqlite3` прошла integrity check (схема 2). Откат к `4c735837bfa54d91283b2c6fa91ab11210d8337b`, файлы в `/opt/logistics-workspace/releases/sputnik-e82ea4d.asVj2B`. Авторизованный рабочий сценарий остаётся для приёмки владельцем.

- Резервная копия `workspace-2026-11-14_03-00-01.sqlite3` (136 КБ, 06:00 МСК) подтверждена выводом владельца. `PRAGMA integrity_check` при открытии снимка с `mode=ro&immutable=1` вернул `ok`. Следующий этап — отдельное согласование ограниченного SFTP и тестовой доставки.
- Ссылка на учебный Google Sheets получена. Чтение по ссылке из текущего окружения недоступно, серверная авторизация Google локально не настроена. Учебная и рабочая таблицы остаются без тестовых записей.
- Владелец подтвердил [рабочий файл Google Sheets](https://docs.google.com/spreadsheets/d/1iBpfwbrGFiToOmAe2UwwFsAXEsUbNZhy_M3WFlKt0os/edit?gid=977001198). Ранее указана вкладка `gid=977001198`. Перед подключением сверить её название и заголовки через авторизованный доступ на чтение. [Учебный файл](https://docs.google.com/spreadsheets/d/1VqmjA3hOEB_9BSn0s4Hdy4DYqAvDKJ8FD1pHK-alq-o/edit) используется для испытаний записи после настройки авторизации.

- Дополнительный проход от `4a624a360e5216d38530de92013326bcff0019d8`. Экспорт XLSX в `src/ledger-export.mjs` выбирает фильтр, активные или архив и группы колонок. Проверка чтением и браузерное скачивание на синтетике. Паспорт и контакты не экспортируются. Адаптер `backend/sheets.py` выключен по умолчанию, сверяет A1:F1, сохраняет отпечаток отправки в SQLite и блокирует повтор при неопределённом ответе. Контракт проверен на имитации API. В `deploy/README.md` уточнены UTC, права и откат. Для запуска нужны физический Safari, фактическая схема Google-листа/учебный доступ и отдельное согласование VPS.

- Завершающий мобильный проход в `codex/sputnik-mobile-review`. Заголовок строки раскрывает и сворачивает карточку, маршрут и номер в теле больше не повторяются. Поиск, фильтры, создание и меню собраны в один ряд, период и PDF перенесены в меню на телефоне. На ПК обе команды доступны напрямую. Визуально проверены новые кадры WebKit 393 × 852 и Chromium 1440 × 900. 54 JS, 11 API, тест CMS, сборка и полные Chromium/WebKit прошли. [Демо](https://eeissn.github.io/logistics-workspace/sputnik-mobile-final/), публикация Pages `5b27fcf`. Проверка физической клавиатуры и нижней панели Safari остаётся открытой.

- Мобильная ветка `codex/sputnik-mobile-review` от `bb3af8010c73e18e81ffc8ae1cfd5a1a0d359167`. Компактный список открывает редактор, режим деталей раскрывает строку в каждой теме, таблица оставляет маршрут, окна и быстрые действия. Даты периода в одной колонке, высота модалей следует visual viewport. Chromium и WebKit 393 × 852 прошли, включая длинные значения. Публичное демо с синтетикой — https://eeissn.github.io/logistics-workspace/sputnik-mobile/. Физический Safari с клавиатурой остаётся для приёмки.

- Excel — предпросмотр с числом найденных, импортируемых, повторных и ошибочных строк, списком неполных полей и распределением статусов. Подтверждение повторно сверяет номера и ревизию. В исходном «Заявки 2026.xlsx» для ноября проверены обычные заливки без условного форматирования. Владелец подтвердил `A2C4C9` → «Выгрузился». Синтетический XLSX подтвердил статус в предпросмотре и после импорта в Chromium и WebKit. Также прошли 54 JS-теста, 11 тестов API, один тест CMS и сборка. Остальные цвета `FFE599`, `B4A7D6`, `EA9999` сохранены.
- Диагностика VPS в режиме чтения разрешена владельцем. Сервер распознал существующий ключ `logistics_vps_ed25519`, но не завершил аутентификацию в BatchMode. Ожидается локальная разблокировка ключа. Состояние рабочей среды пока не сверено.

- Google Sheets — защищённый тестовый предпросмотр `backend/app.py`, `src/sheet-preview.mjs`, `src/app.mjs`, `src/storage.mjs`, `index.html`. Флаг `VITE_SHEET_PREVIEW=true` работает только с тестовым сервером. Проверяются подпись сессии, источник имени, предпросмотр, повтор после reload и отдельный учёт для двух пользователей. Рабочая таблица не подтвердила доступ, порядок полей и служебные строки неизвестны. Следующий шаг — доступ чтения к нужной вкладке и отдельная учебная таблица, затем персистентная идемпотентность и проверка ответа Google.

- Ветка `codex/sputnik-workspace` от подтверждённого локально и на GitHub `98f7b976e464b83fcd047e0a90b64cabd60eb170`. Дерево было чистым.
- Первый блок — DESIGN_SYSTEM, графитовая тема по умолчанию в новых профилях, меню и выход после настроек, компактные детали и индикация подтверждения API. Изменены `index.html`, `src/style.css`, `src/app.mjs`, `src/registry.mjs`, `src/storage.mjs`, тесты реестра и браузерный сценарий.
- Проверены 52 JS, 11 API, тест CMS, сборка, Chromium и WebKit (iPhone 13), три темы и четыре вида. Скриншоты в локальном каталоге визуализаций `sputnik`.
- Дизайн и синхронизация — `df4f25c4faddfb296f9ddd5b46306cfd861544aa`.
- Калькуляторы в `src/calculator.mjs` и `src/cargo/`. Сверены исходники `e69a79bd354874e88d71cccd3dee13048ae77c54`, `2c5160c60cf98d7a3e89755083a1791c3fa5a9a0`. Маржа использует общий доменный расчёт, НДС сохраняет исходное округление, груз использует исходный движок. Ввод и план очищаются при смене аккаунта, план хранится в памяти до выхода или перезагрузки. Для Google Sheets фактические заголовки и доступ пока не подтверждены. Исходный цветной XLSX предстоит получить. Выпуск, SFTP и производственные данные требуют отдельного согласия.

- Кандидат интерфейса и локальной автоматизации резервирования подготовлен в `codex/release-candidate`.
- Исходный проверенный коммит `ee15e4e396837114be4c26f2a90a72f098055eb3`. Рабочее дерево при старте было чистым. [Контрольная точка PR №4](https://github.com/eeissn/logistics-workspace/pull/4#issuecomment-6866991607), [CI исходного SHA](https://github.com/eeissn/logistics-workspace/actions/runs/43454985232).
- Сверены PR №1 и №4, задачи №2 и №3. Рабочее резервирование на VPS по состоянию контрольной точки создаёт SQLite в 03:00. Проверен ручной перенос CMS. Доступ `logistics-backup` к SFTP и автоматическая доставка открыты.
- Базовый `npm test` — 52 теста, сборка Vite прошла. Для API используется проектная `.venv` с FastAPI и httpx. Системный Python этих зависимостей не содержит.
- Блок резервирования — `deploy/backup_delivery.py`, `deploy/pull-backup.ps1`, `deploy/install-backup-task.ps1`, `deploy/test_backup_delivery.py`, `deploy/README.md`; добавлена проверка CI. Тесты SQLite/CMS и Windows OpenSSH с локальным SFTP прошли. Проверены повреждение, просрочка, часы в будущем, ротация и отказ неизвестному ключу сервера. Настройка рабочего VPS и запуск Планировщика после перезагрузки открыты.
- Последний SHA сборки и сквозного прогона — `ac0b0a39fe169444273b39a5058cfb5eaf0d4a9d`. Блок интерфейса в `index.html`, `src/app.mjs`, `src/style.css`, `backend/browser_smoke.py`. Убран реально воспроизведённый дубль переключателя Violet на ПК. По ориентиру из видео Widget Messages 2D текущий этап и маршрут стоят перед окнами, участниками и документами. Настройки и иконка B сохранены.
- Итоговые проверки — 52 теста JS, 11 API, один тест CMS, сборка Vite, Chromium и WebKit (эмуляция iPhone 13). Покрытие включает изоляцию, смену сессии между вкладками, конкурирующие правки, импорт PDF/XLSX, ЭТРН, архив и маржу. Синтетические скриншоты получены через `WORKSPACE_SMOKE_SCREENSHOTS`; Windows asyncio выдал сообщения о сбросе тестового HTTPS-соединения, обе браузерные проверки завершились с кодом 0.
- Следующие действия — проверить CI ветки, после согласия выполнить план ограниченного SFTP и проверить задачу Windows после перезагрузки. Пройти приёмку на физическом iPhone. Калькулятор, справочник ЭТРН, цвета Excel и Telegram остаются в ROADMAP.
- Отдельные решения владельца — включение на VPS ограниченного SFTP и публикации CMS, развёртывание согласованного SHA, приёмка на физическом iPhone.
