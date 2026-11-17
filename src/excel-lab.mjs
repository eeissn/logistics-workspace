import {zipSync, strToU8} from 'fflate';

const esc = text => String(text ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');

const column = index => {
  let label = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + (n - 1) % 26) + label;
  }
  return label;
};
const sheetXml = rows => {
  const items = rows.map((row, index) => '<row r="' + (index + 1) + '">' +
    row.map((value, n) => '<c r="' + column(n) + (index + 1) +
      '" t="inlineStr"><is><t>' + esc(value) + '</t></is></c>').join('') + '</row>').join('');
  return '<' + '?xml version="1.0" encoding="UTF-8"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    items + '</sheetData></worksheet>';
};

export function makeWorkbook(sheets) {
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('No sheets');
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const types = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="' + types + '.sheet.main+xml"/>' +
      sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i+1) + '.xml" ContentType="' +
        types + '.worksheet+xml"/>').join('') + '</Types>',
    '_rels/.rels': '<Relationships xmlns="' + pkg + '"><Relationship Id="rId1" Type="' +
      rel + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="' + main + '" xmlns:r="' + rel + '"><sheets>' +
      sheets.map((sheet, i) => '<sheet name="' + esc(sheet.name) + '" sheetId="' +
        (i+1) + '" r:id="rId' + (i+1) + '"/>').join('') + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="' + pkg + '">' +
      sheets.map((sheet, i) => '<Relationship Id="rId' + (i+1) + '" Type="' + rel +
        '/worksheet" Target="worksheets/sheet' + (i+1) + '.xml"/>').join('') +
      '</Relationships>',
  };
  sheets.forEach((sheet, index) => { files['xl/worksheets/sheet'+(index+1)+'.xml'] = sheetXml(sheet.rows); });
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, xml]) => [path, strToU8(xml)])));
}

const alternate = ['Клиент','Номер рейса','Разгрузка','ТК','Дата создания',
  'Погрузка','Стоимость перевозчика','Маршрут','Доход','Прибыль'];
const standard = ['Дата','Номер заявки','Заказчик','Перевозчик','Направление',
  'Ставка с Заказчиком','Ставка с Перевозчиком','Маржа','Загрузка','Выгрузка'];

export const labSamples = {
  alternate: {
    name:'excel-alt-columns.xlsx',
    sheets:[
      {name:'Рейсы', rows:[
        ['Учебная таблица с другими заголовками — без персональных данных'],
        ['Колонки переставлены местами, перед ними два служебных ряда'],
        alternate,
        ['ООО Тест-Клиент','ALT-2026-01','19.11.2026 17:00','ИП Учебный','18.11.2026',
          '18.11.2026 09:00','65000 без НДС','Казань → Самара','90000 НДС 22%',25000],
        ['ООО Демо','ALT-2026-02','20.11.2026 15:00','ООО Пример','19.11.2026',
          '19.11.2026 12:00','42000 без НДС','Тула → Калуга','55000 без НДС',13000]
      ]},
      {name:'Сводка',rows:[['Вспомогательный лист, не заявки'],['Всего учебных строк',2]]}
    ]
  },
  reordered: {
    name:'excel-reordered-months.xlsx',
    sheets:[
      {name:'Октябрь', rows:[
        [...standard].reverse(),
        ['19.10.2026','18.10.2026',21000,'67000 без НДС','88000 НДС 22%',
          'Москва → Тула','ИП Пример','ООО Тест','SHUFFLED-01','17.10.2026']
      ]},
      {name:'Ноябрь',rows:[
        standard,
        ['17.11.2026','SHUFFLED-02','ООО Демо','ИП Учебный','Самара → Казань',
          '50000 без НДС','37000 без НДС',13000,'18.11.2026','20.11.2026']
      ]}
    ]
  },
  invalid: {
    name:'excel-unknown-format.xlsx',
    sheets:[{name:'Посторонний формат', rows:[
      ['Код','Поставщик','Сумма','Примечание'],
      ['ABC-001','ООО Пример','35000','Нет колонок для заявки']
    ]}]
  }
};

export function attachExcelLab() {
  if (import.meta.env.VITE_EXCEL_LAB !== 'true' || import.meta.env.VITE_DEMO !== 'true') return;
  const panel = document.getElementById('excel-lab-controls');
  panel.hidden = false;
  for (const [key, sample] of Object.entries(labSamples)) {
    panel.querySelector('[data-lab-sample="' + key + '"]').addEventListener('click', () => {
      const file = new Blob([makeWorkbook(sample.sheets)], {
        type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(file);
      link.download = sample.name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
  }
  panel.querySelector('#lab-open-excel').addEventListener('click', () =>
    document.getElementById('ledger').click());
  panel.querySelector('#lab-reset-demo').addEventListener('click', () => {
    if (!window.confirm('Очистить только тестовые заявки в этом браузере?')) return;
    localStorage.removeItem('logistics-workspace:excel-lab:v1');
    location.reload();
  });
}
