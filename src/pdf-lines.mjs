const maxPdfPages = 50;
const maxItemsPerPage = 3000;
const maxTextLength = 500_000;

export async function extractPdfText(pdf) {
  if (pdf.numPages > maxPdfPages) {
    throw new Error(`В PDF больше ${maxPdfPages} страниц. Выберите файл только со страницами заявки.`);
  }
  const pages = [];
  let textLength = 0;
  for (let page = 1; page <= pdf.numPages; page++) {
    const reader = (await pdf.getPage(page)).streamTextContent().getReader();
    const items = [];
    let finished = false;
    try {
      while (!finished) {
        const {done, value} = await reader.read();
        finished = done;
        if (done) break;
        if (items.length + value.items.length > maxItemsPerPage) {
          throw new Error('Слишком много текстовых элементов на странице PDF.');
        }
        for (const item of value.items) {
          textLength += item.str?.length ?? 0;
          if (textLength > maxTextLength) throw new Error('Слишком много текста в PDF.');
          items.push(item);
        }
      }
    } finally {
      if (!finished) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    pages.push(linesFromItems(items));
  }
  const text = pages.join('\n');
  if (!text.trim()) throw new Error('В PDF нет текстового слоя. Для сканов потребуется OCR.');
  return text;
}

export function linesFromItems(items) {
  const rows = [];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const [, , , , x, y] = item.transform;
    let row = rows.find(row => Math.abs(row.y - y) < 1.5);
    if (!row) { row = {y, items: []}; rows.push(row); }
    row.items.push({x, width: item.width, text: item.str});
  }
  return rows.sort((a, b) => b.y - a.y).map(row => {
    let line = '';
    let end = -Infinity;
    for (const item of row.items.sort((a, b) => a.x - b.x)) {
      const gap = item.x - end;
      const separator = !line || /\s$/.test(line) ? '' : gap > 16 ? '    ' : gap > 1 ? ' ' : '';
      line += separator + item.text;
      end = item.x + item.width;
    }
    return line;
  }).join('\n');
}

