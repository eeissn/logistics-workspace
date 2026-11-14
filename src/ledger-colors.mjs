import { unzipSync, strFromU8 } from 'fflate';

const stages = {
  FFA2C4C9:'unloaded', FFFFE599:'signed',
  FFB4A7D6:'loaded', FFEA9999:'failed',
};

export function createLedgerColorReader(buffer) {
  const files = unzipSync(new Uint8Array(buffer), {
    filter: entry => /^xl\/(?:workbook\.xml|styles\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(entry.name),
  });
  const xml = name => files[name] && new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml');
  const styles = xml('xl/styles.xml');
  const book = xml('xl/workbook.xml');
  const rels = xml('xl/_rels/workbook.xml.rels');
  return (sheetName, rows) => readLedgerColors(xml, styles, book, rels, sheetName, rows);
}

function readLedgerColors(xml, styles, book, rels, sheetName, rows) {
  const sheet = [...(book?.getElementsByTagNameNS('*','sheet') ?? [])].find(item => item.getAttribute('name') === sheetName);
  const relation = [...(rels?.getElementsByTagNameNS('*','Relationship') ?? [])]
    .find(item => item.getAttribute('Id') === sheet?.getAttribute('r:id'));
  const target = relation?.getAttribute('Target');
  const data = target && xml(target.startsWith('/') ? target.slice(1) : 'xl/' + target);
  if (!data || !styles || data.getElementsByTagNameNS('*','conditionalFormatting').length) return new Map();
  const header = rows[0];
  const firstValue = [...data.getElementsByTagNameNS('*','c')].find(cell =>
    cell.getElementsByTagNameNS('*','v').length || cell.getElementsByTagNameNS('*','is').length);
  if (!/^[A-Z]+1$/.test(firstValue?.getAttribute('r') ?? '')) return new Map();
  let column = (header?.findIndex(cell => String(cell).trim() === 'Номер заявки') ?? -1) + 1;
  let letters = '';
  while (column) {
    column--;
    letters = String.fromCharCode(65 + column % 26) + letters;
    column = Math.floor(column / 26);
  }
  if (!letters) return new Map();
  const fills = styles.getElementsByTagNameNS('*','fills')[0]?.children ?? [];
  const formats = styles.getElementsByTagNameNS('*','cellXfs')[0]?.children ?? [];
  const colored = new Map();
  for (const cell of data.getElementsByTagNameNS('*','c')) {
    const address = cell.getAttribute('r') ?? '';
    if (address.replace(/\d+$/, '') !== letters) continue;
    const format = formats[Number(cell.getAttribute('s') ?? 0)];
    const fill = fills[Number(format?.getAttribute('fillId'))];
    const pattern = fill?.getElementsByTagNameNS('*','patternFill')[0];
    if (pattern?.getAttribute('patternType') !== 'solid') continue;
    const color = pattern.getElementsByTagNameNS('*','fgColor')[0]?.getAttribute('rgb')?.toUpperCase();
    if (Object.hasOwn(stages, color)) colored.set(Number(address.slice(letters.length)), stages[color]);
  }
  return colored;
}
