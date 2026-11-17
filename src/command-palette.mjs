// UI-only command registry. A command never reads or writes server data directly.
export const commandDefinitions = Object.freeze([
  {id:'search', label:'Найти заявку', detail:'Быстрый поиск по номеру, компании или маршруту', group:'Навигация'},
  {id:'active', label:'Актуальные заявки', detail:'Вернуться к рабочим рейсам', group:'Навигация'},
  {id:'history', label:'История заявок', detail:'Все месяцы и завершённые рейсы', group:'Навигация'},
  {id:'new', label:'Новая заявка', detail:'Открыть форму создания', group:'Заявки'},
  {id:'pdf', label:'Импорт двух PDF', detail:'Заказчик и перевозчик', group:'Заявки'},
  {id:'excel', label:'Импорт Excel', detail:'Предпросмотр таблицы до сохранения', group:'Заявки'},
  {id:'report', label:'Маржа за месяц', detail:'Сводка и печать отчёта', group:'Аналитика'},
  {id:'table', label:'Вид: таблица', detail:'Плотный реестр', group:'Отображение'},
  {id:'split', label:'Вид: список и детали', detail:'Карточка заявки рядом с реестром', group:'Отображение'},
  {id:'settings', label:'Настройки', detail:'Темы, цвета и отображение', group:'Приложение'},
]);

const normalized = text => String(text || '').toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е').trim().replace(/\s+/g, ' ');

export function matchCommands(query, commands = commandDefinitions) {
  const words = normalized(query).split(' ').filter(Boolean);
  return commands.filter(command => {
    const haystack = normalized([command.label, command.detail, command.group].join(' '));
    return words.every(word => haystack.includes(word));
  });
}

export function mountCommandPalette({dialog, input, results, opener, actions, available, contextCommands = () => []}) {
  const closeThenRun = id => {
    if (!available() || typeof actions[id] !== 'function') return;
    dialog.close();
    actions[id]();
  };
  const draw = () => {
    results.replaceChildren();
    const matches = matchCommands(input.value,[...contextCommands(), ...commandDefinitions]);
    if (!matches.length) {
      const empty = document.createElement('p');
      empty.className = 'command-empty';
      empty.textContent = 'Ничего не найдено. Попробуйте другое слово.';
      results.append(empty);
      return;
    }
    let lastGroup;
    for (const item of matches) {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        const heading = document.createElement('p');
        heading.className = 'command-group';
        heading.textContent = lastGroup;
        results.append(heading);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'command-choice';
      button.dataset.command = item.id;
      const label = document.createElement('strong');
      label.textContent = item.label;
      const detail = document.createElement('small');
      detail.textContent = item.detail;
      button.append(label, detail);
      button.addEventListener('click', () => closeThenRun(item.id));
      results.append(button);
    }
  };
  const open = () => {
    if (!available() || dialog.open || document.querySelector('dialog[open]')) return;
    input.value = '';
    draw();
    dialog.showModal();
    input.focus();
  };
  opener.addEventListener('click', open);
  input.addEventListener('input', draw);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      results.querySelector('.command-choice')?.click();
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      results.querySelector('.command-choice')?.focus();
    }
  });
  results.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const choices = [...results.querySelectorAll('.command-choice')];
    const current = choices.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && current === 0) input.focus();
    else choices[Math.max(0, Math.min(choices.length - 1,
      current + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  });
  const editing = target => target?.closest?.('input,textarea,select,[contenteditable="true"]');
  document.addEventListener('keydown', event => {
    if (!available() || event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (dialog.open) dialog.close();
      else open();
      return;
    }
    if (event.key === '/' && !event.ctrlKey && !event.altKey && !event.metaKey &&
      !editing(event.target) && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      actions.search();
    }
  });
  return {open, close:() => { if (dialog.open) dialog.close(); }};
}
