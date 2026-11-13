const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

export function parseSheetText(text) {
  const draft = {};
  const parts = text.trim().split(/,\s+/);
  for (const part of parts) {
    const number = part.match(/^заявка\s*(?:№\s*)?([\w-]+)$/iu);
    const amount = part.match(/^(\d[\d \u00a0]*(?:[,.]\d{1,2})?)\s*(?:руб(?:лей|ля|ль|\.)?|₽)$/iu);
    const date = part.match(/^(обратились|обещали)\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[а-я]+(?:\s+\d{4})?)$/iu);
    if (number) draft.number = number[1];
    else if (amount) draft.amount = amount[1].replace(/\s/g, '').replace(',', '.');
    else if (date) {
      const field = date[1].toLowerCase() === 'обратились' ? 'requested' : 'promised';
      if (/^\d{4}-/.test(date[2])) draft[field] = date[2];
      else {
        const [day, month, year] = date[2].toLowerCase().split(/\s+/);
        const index = months.indexOf(month);
        if (year && index >= 0) draft[field] = `${year}-${String(index + 1).padStart(2,'0')}-${day.padStart(2,'0')}`;
      }
    } else if (!draft.title && !/^(заявка|обещали|обратились)\b/iu.test(part)) draft.title = part;
  }
  return draft;
}
