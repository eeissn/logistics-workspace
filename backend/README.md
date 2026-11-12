# Logistics Workspace с синхронизацией

Два вручную созданных аккаунта входят по почте и паролю. У них общий реестр и одинаковые права, включая редактирование. PDF читаются в браузере, а на сервер отправляются поля заявок. Реестр сохраняется целиком с номером ревизии. Если реестр успел измениться, сервер возвращает 409. Вкладка запрашивает изменения каждые 15 секунд, при возвращении на неё и после восстановления связи. Открытая форма проверяет, что конкретная заявка сохранила прежнюю версию.

## Локальная проверка

Из корня репозитория в Bash с Python 3.12+ и Node 22.12+ выполните команды. Для Windows можно использовать WSL.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements-test.txt
python -m unittest backend.test_app -v
npm ci
npm test
npm run build

export DATABASE_PATH="$(mktemp -d)/workspace.sqlite3"
export APP_ORIGIN=http://localhost:5173
python -m backend.app add-user first@example.test
python -m backend.app add-user second@example.test
python -m uvicorn backend.app:from_env --factory --host 127.0.0.1 --no-access-log
```

Введите для каждого тестовый пароль из 12–256 символов. Во втором терминале выполните `npm run dev -- --host localhost --port 5173 --strictPort` и откройте [localhost:5173](http://localhost:5173). Используйте два профиля браузера либо обычное и приватное окна. Зайдите под разными аккаунтами. В первом сохраните вымышленную заявку, во втором нажмите «Обновить». Затем откройте её одновременно в обоих окнах, сохраните изменение в первом и попробуйте сохранить второе. Реестр должен сохранить первую правку и показать сообщение о конфликте во втором окне.

Чтобы перенести старый реестр, откройте приложение на прежнем адресе в браузере, в котором хранились заявки. После входа выберите «Перенести заявки с устройства» и подтвердите действие. Совпадающие номера пропускаются, исходная копия остаётся в браузере. Хранилище браузера привязано к схеме, домену и порту сайта, поэтому при их смене кнопка увидит только данные нового адреса. Для переноса между разными origin нужен отдельный экспорт или исходный Excel. В публичном демо `VITE_DEMO=true` используется прежнее локальное хранилище.

## Подготовка VPS после проверки ветки

1. Создайте системного пользователя и группу `logistics`. Дайте им доступ на чтение к коду и venv и владение каталогами `/opt/logistics-workspace/data` и `/opt/logistics-workspace/backups` с правами `0700`. Nginx должен иметь доступ на чтение только к сборке и возможность пройти родительские каталоги. Установите зависимости из `backend/requirements.txt` в серверный venv и соберите фронтенд через `npm ci` и `npm run build` с выключенным деморежимом.
2. Создайте `/etc/logistics-workspace.env` с владельцем root и правами `0600`. Укажите фактическое доменное имя в `APP_ORIGIN` без завершающего слеша.
   ```ini
   DATABASE_PATH=/opt/logistics-workspace/data/workspace.sqlite3
   APP_ORIGIN=https://workspace.example.com
   ```
3. Из каталога репозитория создайте два аккаунта командой ниже, подставляя каждую почту. Пароль вводится в терминале без отображения.
   ```bash
   sudo -u logistics env DATABASE_PATH=/opt/logistics-workspace/data/workspace.sqlite3 \
     /opt/logistics-workspace/backend-venv/bin/python -m backend.app add-user first@example.test
   ```
4. Установите юнит из `deploy/logistics-workspace.service` в `/etc/systemd/system/`, выполните `sudo systemctl daemon-reload` и `sudo systemctl enable --now logistics-workspace`. Проверьте, что API слушает только loopback через `ss -ltn`. Запрос `curl -i http://127.0.0.1:8000/api/records` должен вернуть 401.
5. Выпустите сертификат через DNS-01 при закрытых публичных портах 80 и 443. Установите конфигурацию `deploy/nginx.conf`, подставив домен и пути сертификата. Проверьте через `sudo nginx -t` и перезагрузите Nginx. Через SSH-туннель либо локальную проверку с `curl --resolve workspace.example.com:443:127.0.0.1 https://workspace.example.com/api/records` проверьте TLS и 401. Проверьте вход и выход тестового пользователя через HTTPS до открытия 443. Оставьте 80 закрытым, если используете DNS-01 для обновления сертификата. После открытия 443 отдельно проверьте доступ без VPN с устройства коллеги.

## Резервные копии

Запускайте ежедневно с уникальным именем файла. Команда создаёт согласованную копию SQLite и отказывается перезаписывать существующий файл.

```bash
sudo -u logistics env DATABASE_PATH=/opt/logistics-workspace/data/workspace.sqlite3 \
  /opt/logistics-workspace/backend-venv/bin/python -m backend.app backup \
  "/opt/logistics-workspace/backups/workspace-$(date -u +%Y%m%dT%H%M%SZ).sqlite3"
```

Храните зашифрованную копию вне VPS. В базе есть паспортные данные, хеши паролей и данные сессий. Перед восстановлением проверьте копию через `sqlite3 /path/to/backup.sqlite3 'PRAGMA integrity_check;'`. Остановите сервис, перенесите старую базу и её файлы `-wal` и `-shm` в защищённый каталог, затем установите копию на путь `DATABASE_PATH` с владельцем `logistics:logistics` и правами `0600`. Удалите восстановленные сессии командой `DELETE FROM sessions;` через SQLite от пользователя `logistics`. Запустите сервис и проверьте вход и содержимое реестра. После восстановления пользователям нужно заново открыть приложение.

[Документация SQLite по онлайн-копированию](https://www.sqlite.org/backup.html)
