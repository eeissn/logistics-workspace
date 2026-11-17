import { zipSync, strToU8 } from 'fflate';
import { orderMargin, tripStatus, tripStatuses, etrnProgress } from './domain.mjs';
import { routeText } from './registry.mjs';

const titles = new Map(tripStatuses);
const xml = value => String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const text = value => `<c t="inlineStr"><is><t xml:space="preserve">${xml(value ?? '')}</t></is></c>`;
const number = value => Number.isFinite(value) ? `<c><v>${value}</v></c>` : '<c/>';
const date = value => {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? Date.parse(value + 'T00:00:00Z') : NaN;
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,10) !== value || value < '1900-01-01') return '<c/>';
  return `<c s="1"><v>${time / 86400000 + (value < '1900-03-01' ? 25568 : 25569)}</v></c>`;
};

export function exportLedger(orders, {parties, money}) {
  const headings = ['Номер','Дата','Маршрут','Статус','ЭТРН'];
  if (parties) headings.push('Заказчик','Перевозчик');
  if (money) headings.push('Ставка заказчика','Ставка перевозчика','Маржа');
  const rows = [headings.map(text), ...orders.map(order => {
    const cells = [text(order.number), date(order.date), text(routeText(order)),
      text(titles.get(tripStatus(order))), text(etrnProgress(order.etrn))];
    if (parties) cells.push(text(order.customer), text(order.carrier));
    if (money) cells.push(number(order.customerAmount), number(order.carrierAmount), number(orderMargin(order)));
    return cells;
  })];
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const pkg = 'http://schemas.openxmlformats.org/package/2006';
  const parts = {
    '[Content_Types].xml': `<Types xmlns="${pkg}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${pkg}/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="Заявки" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${pkg}/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<styleSheet xmlns="${main}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${main}"><sheetData>${rows.map((cells, i) =>
      `<row r="${i+1}">${cells.map((cell, col) => cell.replace('<c', `<c r="${String.fromCharCode(65+col)}${i+1}"`)).join('')}</row>`).join('')}</sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, content]) => [name, strToU8(content)])));
}
