import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { extractPdfText } from './pdf-lines.mjs';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function readPdf(file) {
  const loading = getDocument({data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false});
  try {
    return await extractPdfText(await loading.promise);
  } finally {
    await loading.destroy();
  }
}
