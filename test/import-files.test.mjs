import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync } from 'fflate';
import { checkImportFile, readExcelArchive } from '../src/import-files.mjs';
import { extractPdfText } from '../src/pdf-lines.mjs';

test('import accepts a file at the limit and rejects empty files', () => {
  assert.doesNotThrow(() => checkImportFile({size: 10 * 1024 * 1024}, 'Excel', 10));
  assert.throws(() => checkImportFile({size: 0}, 'Excel', 10), /непустой/);
});

test('XLSX preflight returns the exact validated archive and rejects damaged headers', async () => {
  const bytes = zipSync({'xl/workbook.xml': new TextEncoder().encode('<workbook/>')});
  const file = new Blob([bytes]);
  assert.deepEqual(new Uint8Array(await readExcelArchive(file)), bytes);
  await assert.rejects(readExcelArchive(new Blob([bytes.slice(0, -1)])), /архив XLSX/);
  await assert.rejects(readExcelArchive(new Blob(['not an archive'])), /архив XLSX/);
});

test('XLSX preflight rejects small archives with a large declared expanded size', async () => {
  const bytes = zipSync({'xl/worksheets/sheet1.xml': new Uint8Array(2048).fill(65)});
  const zip = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const directory = zip.getUint32(bytes.byteLength - 6, true);
  zip.setUint32(directory + 24, 32 * 1024 * 1024 + 1, true);
  await assert.rejects(readExcelArchive(new Blob([bytes])), /после распаковки.*32 МиБ/);
});

test('XLSX preflight rejects archives with too many members', async () => {
  const entries = Object.fromEntries(Array.from({length: 257}, (_, i) => [`${i}.xml`, new Uint8Array()]));
  await assert.rejects(readExcelArchive(new Blob([zipSync(entries)])), /много вложенных частей/);
});

function pdfWithPages(pages, cancel) {
  return {
    numPages: pages.length,
    async getPage(number) {
      const chunks = pages[number - 1].values();
      return {
        streamTextContent() {
          return new ReadableStream({
            pull(controller) {
              const {done, value} = chunks.next();
              if (done) controller.close();
              else controller.enqueue({items: value});
            },
            cancel,
          });
        },
      };
    },
  };
}

const item = (str, x = 0) => ({str, transform: [1, 0, 0, 1, x, 0], width: 10});

test('PDF extraction preserves page layout across text chunks', async () => {
  const pdf = pdfWithPages([[[item('Первая')], [item('страница', 15)]], [[item('Вторая')]]]);
  assert.equal(await extractPdfText(pdf), 'Первая страница\nВторая');
});

test('PDF extraction rejects too many pages before opening the first page', async () => {
  await assert.rejects(extractPdfText({numPages: 51}), /50 страниц/);
});

test('PDF extraction cancels streams that exceed the text or item budget', async t => {
  const cancel = t.mock.fn();
  const dense = pdfWithPages([[[...Array(3001).fill(item('а'))], [item('ещё')]]], cancel);
  const long = pdfWithPages([[[item('а'.repeat(300_000))]], [[item('б'.repeat(250_000))], [item('ещё')]]], cancel);
  await assert.rejects(extractPdfText(dense), /текстовых элементов/);
  await assert.rejects(extractPdfText(long), /Слишком много текста/);
  assert.equal(cancel.mock.callCount(), 2);
});
