const KEY = 'logistics-workspace:v1';
export const demo = import.meta.env?.VITE_DEMO === 'true';

export function localOrders() {
  const data = localStorage.getItem(KEY);
  if (!data) return [];
  const decoded = JSON.parse(data);
  if (decoded.version !== 1 || !Array.isArray(decoded.orders)) throw new Error('Неизвестный формат сохранённых заявок.');
  return decoded.orders;
}

const messages = {
  401: 'Проверьте почту и пароль или войдите снова.',
  403: 'Сеанс изменился. Обновите страницу и войдите снова.',
  409: 'Заявки изменились на другом устройстве. Обновите реестр, откройте заявку заново и повторите правку.',
  413: 'Превышен допустимый размер реестра.',
  422: 'Сервер отклонил формат данных.',
  429: 'Слишком много попыток входа. Попробуйте позже.',
};

async function request(path, method = 'GET', data, csrf) {
  let response;
  try {
    response = await fetch('/api/' + path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: {...(data === undefined ? {} : {'Content-Type': 'application/json'}),
        ...(csrf ? {'X-CSRF-Token': csrf} : {})},
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new Error('Нет связи с сервером. Проверьте подключение и повторите действие.');
  }
  if (!response.ok) {
    const error = new Error(messages[response.status] || 'Сервер временно недоступен.');
    error.status = response.status;
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw new Error('Сервер синхронизации недоступен.');
  }
}

let account;
let generation = 0;
let newest;
let revisions = new WeakMap();
const offlineStore = {
  list: async () => localOrders(),
  async save(orders) {
    localStorage.setItem(KEY, JSON.stringify({version: 1, orders}));
    return orders;
  },
};

async function inSession(send, accept) {
  const started = generation;
  try {
    const result = await send();
    if (started === generation) return accept(result);
  } catch (error) {
    if (started === generation) throw error;
  }
  throw new Error('Сеанс завершён.');
}

function acceptSnapshot(snapshot) {
  revisions.set(snapshot.orders, snapshot.revision);
  if (!newest || snapshot.revision > newest.revision) newest = snapshot;
  return newest.orders;
}

export const auth = {
  restore() {
    this.clear();
    return inSession(() => request('me'), result => account = result);
  },
  login(email, password) {
    this.clear();
    return inSession(() => request('login', 'POST', {email, password}), result => account = result);
  },
  logout() {
    return inSession(() => request('logout', 'POST', undefined, account?.csrf), () => this.clear());
  },
  clear() {
    generation++;
    account = undefined;
    newest = undefined;
    revisions = new WeakMap();
  },
};

export const store = demo ? offlineStore : {
  async list() {
    if (!account) throw new Error('Сеанс завершён.');
    return inSession(() => request('records', 'GET', undefined, account.csrf), acceptSnapshot);
  },
  async save(orders, base) {
    const revision = revisions.get(base);
    if (revision === undefined || !account) throw new Error('Обновите реестр перед сохранением.');
    return inSession(() => request('records', 'PUT', {revision, orders}, account.csrf), acceptSnapshot);
  },
};
