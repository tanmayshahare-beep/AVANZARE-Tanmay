import { AppError } from '../errors';

// The legacy build is the CJS-compatible Node entry point of pdf.js (same as extract.ts).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as {
  getDocument(opts: object): { promise: Promise<OcrPdfDocument> };
};

interface OcrPdfPage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
  cleanup(): void;
}
interface OcrPdfDocument {
  numPages: number;
  getPage(n: number): Promise<OcrPdfPage>;
  destroy(): Promise<void>;
}

const MAX_OCR_PAGES = 8; // CVs are short; bound the (slow) OCR cost per file
const RENDER_SCALE = 2;  // upscaling the page improves OCR accuracy on small fonts

/**
 * Rasterize each page of a text-less (scanned) PDF and run OCR on it. The heavy
 * dependencies (@napi-rs/canvas for rendering, tesseract.js for recognition) are
 * imported lazily so they only load when a scanned CV actually needs OCR — the
 * common text-PDF path never pays for them. Throws AVZ-PARSE-107 on failure.
 */
export async function ocrPdf(buffer: Buffer, language: string, filePath: string): Promise<string> {
  let canvasMod: typeof import('@napi-rs/canvas');
  let tesseract: typeof import('tesseract.js');
  try {
    canvasMod = await import('@napi-rs/canvas');
    tesseract = await import('tesseract.js');
  } catch (err) {
    throw new AppError('AVZ-PARSE-107', filePath, 'OCR engine could not be loaded', err);
  }

  let doc: OcrPdfDocument;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      verbosity: 0,
      isEvalSupported: false,
      disableFontFace: true,
    }).promise;
  } catch (err) {
    throw new AppError('AVZ-PARSE-107', filePath, 'could not open PDF for OCR', err);
  }

  const worker = await tesseract.createWorker(language || 'eng');
  try {
    let out = '';
    const pages = Math.min(doc.numPages, MAX_OCR_PAGES);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = canvasMod.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const png = canvas.toBuffer('image/png');
      const { data } = await worker.recognize(png);
      out += data.text + '\n';
      page.cleanup();
    }
    return out;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('AVZ-PARSE-107', filePath, 'OCR failed while reading the PDF', err);
  } finally {
    await worker.terminate();
    await doc.destroy();
  }
}
