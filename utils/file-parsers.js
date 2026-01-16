import {
  errorHandler,
  ErrorSeverity,
  ErrorCategory,
  createError,
} from '../errorHandler.js';

import logger from './logger.js';

export const SUPPORTED_TYPES = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/csv': 'csv',
};

export const FILE_EXTENSIONS = {
  '.pdf': 'pdf',
  '.txt': 'txt',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.docx': 'docx',
  '.csv': 'csv',
};

export async function canParse(file) {
  const mimeType = file.type?.toLowerCase() || '';
  const fileName = file.name?.toLowerCase() || '';
  const extension = fileName.slice(fileName.lastIndexOf('.'));

  if (SUPPORTED_TYPES[mimeType]) {
    return SUPPORTED_TYPES[mimeType];
  }

  if (FILE_EXTENSIONS[extension]) {
    return FILE_EXTENSIONS[extension];
  }

  return null;
}

export async function parse(file) {
  const type = await canParse(file);

  if (!type) {
    throw createError(`Unsupported file type: ${file.type || file.name}`, {
      category: ErrorCategory.INPUT,
      severity: ErrorSeverity.MEDIUM,
      context: { fileName: file.name, fileType: file.type },
    });
  }

  const parser = parsers[type];
  if (!parser) {
    throw createError(`No parser available for type: ${type}`, {
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.HIGH,
      context: { fileName: file.name, fileType: type },
    });
  }

  try {
    const result = await parser(file);
    logger.info('FileParsers', `Successfully parsed ${file.name} as ${type}`);
    return result;
  } catch (error) {
    logger.error('FileParsers', `Failed to parse ${file.name}:`, error);
    throw createError(`Failed to parse file: ${error.message}`, {
      category: ErrorCategory.INPUT,
      severity: ErrorSeverity.HIGH,
      originalError: error,
      context: { fileName: file.name, fileType: type },
    });
  }
}

async function parsePDF(file) {
  const pdfjsLib = await loadPDFJS();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const textChunks = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ');
    textChunks.push({ page: i, text: pageText });
  }

  const fullText = textChunks.map((c) => c.text).join('\n\n');

  return {
    content: fullText,
    metadata: {
      fileName: file.name,
      fileType: 'pdf',
      pageCount: pdf.numPages,
      charCount: fullText.length,
      pages: textChunks.map((c) => ({ page: c.page, chars: c.text.length })),
    },
  };
}

async function loadPDFJS() {
  if (window.pdfjsLib) {
    return window.pdfjsLib;
  }

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('libs/pdf.min.js');
  document.head.appendChild(script);

  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
  });

  return window.pdfjsLib;
}

async function parseDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer });

  return {
    content: result.value,
    metadata: {
      fileName: file.name,
      fileType: 'docx',
      charCount: result.value.length,
    },
  };
}

async function parseCSV(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r\n|\n/).filter((line) => line.trim());

        if (lines.length === 0) {
          resolve({
            content: '',
            metadata: {
              fileName: file.name,
              fileType: 'csv',
              charCount: 0,
              rowCount: 0,
            },
          });
          return;
        }

        const header = lines[0];
        const rows = lines.slice(1);
        const csvText = rows
          .map((row) => {
            const values = row.split(',');
            const formatted = header.split(',').map((h, i) => `${h.trim()}: ${values[i]?.trim() || ''}`);
            return formatted.join(' | ');
          })
          .join('\n');

        const fullText = `Columns: ${header}\n\n${csvText}`;

        resolve({
          content: fullText,
          metadata: {
            fileName: file.name,
            fileType: 'csv',
            charCount: fullText.length,
            rowCount: rows.length,
            columns: header.split(',').map((c) => c.trim()),
          },
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () =>
      reject(createError('Failed to read CSV file', {
        category: ErrorCategory.INPUT,
        severity: ErrorSeverity.HIGH,
        originalError: error,
      }));

    reader.readAsText(file);
  });
}

async function parseMarkdown(file) {
  const text = await readAsText(file);

  let frontmatter = {};
  let content = text;

  const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (frontmatterMatch) {
    const frontmatterText = frontmatterMatch[1];
    content = frontmatterMatch[2];

    frontmatterText.split('\n').forEach((line) => {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        frontmatter[key.trim()] = valueParts.join(':').trim();
      }
    });
  }

  return {
    content: content.trim(),
    metadata: {
      fileName: file.name,
      fileType: 'markdown',
      charCount: content.length,
      frontmatter,
    },
  };
}

async function parseTXT(file) {
  const text = await readAsText(file);

  return {
    content: text,
    metadata: {
      fileName: file.name,
      fileType: 'txt',
      charCount: text.length,
    },
  };
}

async function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () =>
      reject(createError('Failed to read file', {
        category: ErrorCategory.INPUT,
        severity: ErrorSeverity.HIGH,
      }));

    reader.readAsText(file);
  });
}

const parsers = {
  pdf: parsePDF,
  docx: parseDOCX,
  csv: parseCSV,
  markdown: parseMarkdown,
  txt: parseTXT,
};

export const fileParsers = {
  canParse,
  parse,
  SUPPORTED_TYPES,
  FILE_EXTENSIONS,
};
