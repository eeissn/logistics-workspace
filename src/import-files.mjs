export function checkImportFile(file, format, maxMiB) {
  if (!file || !file.size) throw new Error(`Выберите непустой файл ${format}.`);
  if (file.size > maxMiB * 1024 * 1024) {
    throw new Error(`Файл ${format} превышает ${maxMiB} МиБ. Выберите файл меньшего размера.`);
  }
}

// The XLSX reader allocates output from the ZIP directory sizes.
const maxExcelExpandedBytes = 32 * 1024 * 1024;
const maxExcelEntries = 256;

export async function readExcelArchive(file) {
  checkImportFile(file, 'Excel', 10);
  const buffer = await file.arrayBuffer();
  const zip = new DataView(buffer);
  const word = offset => zip.getUint16(offset, true);
  const long = offset => zip.getUint32(offset, true);
  const invalid = () => new Error('Не удалось прочитать архив XLSX. Пересохраните таблицу в Excel.');
  let end = zip.byteLength - 22;
  const earliestEnd = Math.max(0, end - 65535);
  // Use the same last end-record signature as the ZIP reader.
  while (end >= earliestEnd && long(end) !== 0x06054b50) end--;
  if (end < earliestEnd || end + 22 + word(end + 20) !== zip.byteLength) throw invalid();

  const count = word(end + 10);
  const start = long(end + 16);
  const size = long(end + 12);
  if (word(end + 4) || word(end + 6) || word(end + 8) !== count ||
      !count || start + size !== end || (end >= 20 && long(end - 20) === 0x07064b50)) throw invalid();
  if (count > maxExcelEntries) throw new Error('В Excel слишком много вложенных частей. Оставьте только нужные листы.');

  let cursor = start;
  let expanded = 0;
  for (let entry = 0; entry < count; entry++) {
    if (cursor + 46 > end || long(cursor) !== 0x02014b50) throw invalid();
    const method = word(cursor + 10);
    const packedSize = long(cursor + 20);
    const unpackedSize = long(cursor + 24);
    const local = long(cursor + 42);
    if (word(cursor + 8) & 1 || word(cursor + 34) ||
        (method !== 0 && method !== 8) || (method === 0 && packedSize !== unpackedSize) ||
        local + 30 > start || long(local) !== 0x04034b50) throw invalid();
    const dataStart = local + 30 + word(local + 26) + word(local + 28);
    if (dataStart + packedSize > start) throw invalid();

    expanded += unpackedSize;
    if (expanded > maxExcelExpandedBytes) {
      throw new Error('Объём Excel после распаковки превышает 32 МиБ. Оставьте только нужные листы.');
    }
    cursor += 46 + word(cursor + 28) + word(cursor + 30) + word(cursor + 32);
  }
  if (cursor !== end) throw invalid();
  return buffer;
}
