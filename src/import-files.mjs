export function checkImportFile(file, format, maxMiB) {
  if (!file || !file.size) throw new Error(`Выберите непустой файл ${format}.`);
  if (file.size > maxMiB * 1024 * 1024) {
    throw new Error(`Файл ${format} превышает ${maxMiB} МиБ. Выберите файл меньшего размера.`);
  }
}
