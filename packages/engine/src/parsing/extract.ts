import fs from 'node:fs';
import path from 'node:path';
import { AppError, asAppError } from '../errors';

// The legacy build is the CJS-compatible Node entry point of pdf.js.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as {
  getDocument(opts: object): { promise: Promise<PdfDocument> };
};

interface PdfTextItem { str: string; hasEOL?: boolean }
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{ items: PdfTextItem[] }>;
    cleanup(): void;
  }>;
  destroy(): Promise<void>;
}

/** Extract text page by page, preserving line breaks (contact heuristics need them). */
async function pdfToText(buffer: Buffer): Promise<string> {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    verbosity: 0,
    isEvalSupported: false,
  }).promise;
  try {
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      for (const item of content.items) {
        text += item.str;
        text += item.hasEOL ? '\n' : ' ';
      }
      text += '\n';
      page.cleanup();
    }
    return text;
  } finally {
    await doc.destroy();
  }
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require('mammoth') as { extractRawText(opts: { buffer: Buffer }): Promise<{ value: string }> };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WordExtractor = require('word-extractor') as new () => { extract(file: string): Promise<{ getBody(): string }> };

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc'];

/** Extract plain text from a CV file. Throws AppError with an AVZ-PARSE code on failure. */
export async function extractText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new AppError('AVZ-PARSE-104', filePath, `extension "${ext}"`);
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    throw asAppError(err, 'AVZ-PARSE-101', filePath);
  }

  let text: string;
  if (ext === '.pdf') {
    try {
      text = await pdfToText(buffer);
    } catch (err) {
      throw asAppError(err, 'AVZ-PARSE-102', filePath);
    }
    if (!text || text.replace(/\s/g, '').length < 20) {
      // Real text layers of even one-page CVs exceed this; near-empty means scanned images.
      throw new AppError('AVZ-PARSE-103', filePath);
    }
  } else if (ext === '.docx') {
    try {
      text = (await mammoth.extractRawText({ buffer })).value;
    } catch (err) {
      throw asAppError(err, 'AVZ-PARSE-106', filePath);
    }
  } else {
    try {
      const doc = await new WordExtractor().extract(filePath);
      text = doc.getBody();
    } catch (err) {
      throw asAppError(err, 'AVZ-PARSE-106', filePath);
    }
  }

  if (!text || !text.trim()) throw new AppError('AVZ-PARSE-105', filePath);
  return text;
}
