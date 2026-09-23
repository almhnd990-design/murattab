/**
 * التحويل من رد النموذج (نص حر) إلى الشكل المتفق عليه مع الموقع:
 *   { "type": "table", "columns": [...], "rows": [[...], ...] }
 *   { "type": "text",  "answer": "..." }
 *
 * كل الأخطاء هنا من نوع OutputError حتى يرجع السيرفر 500 مع { error } واضح.
 */

export class OutputError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'OutputError';
    this.detail = detail;
  }
}

const MAX_RESULT_ROWS = toPositiveInt(process.env.MAX_RESULT_ROWS, 200);

/** يستخرج أول كائن JSON صالح من نص النموذج (يتعامل مع ```json ... ``` وأي كلام زايد). */
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new OutputError('النموذج رجع رد فاضي.');
  }

  let candidate = text.trim();

  // 1) نص داخل سياج markdown
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1].trim()) candidate = fence[1].trim();

  // 2) النص كما هو
  const direct = tryParse(candidate);
  if (direct !== undefined) return direct;

  // 3) أول كائن متوازن {...} داخل النص
  const slice = sliceBalancedObject(candidate);
  if (slice) {
    const parsed = tryParse(slice);
    if (parsed !== undefined) return parsed;
  }

  // 4) أول مصفوفة متوازنة [...] (بعض النماذج ترجع مصفوفة صفوف مباشرة)
  const arr = sliceBalancedArray(candidate);
  if (arr) {
    const parsed = tryParse(arr);
    if (parsed !== undefined) return parsed;
  }

  throw new OutputError('رد النموذج مو JSON صالح.', String(text).slice(0, 800));
}

/**
 * يتحقق من الشكل ويرجّعه نظيف جاهز للإرسال للموقع.
 * @param {unknown} parsed كائن JSON (أو نص ليُستخرج منه)
 * @param {{ fallbackColumns?: string[] }} options
 */
export function parseModelOutput(parsed, { fallbackColumns = [] } = {}) {
  const obj = typeof parsed === 'string' ? extractJson(parsed) : parsed;

  if (Array.isArray(obj)) {
    return normalizeTable({ columns: fallbackColumns, rows: obj });
  }
  if (!obj || typeof obj !== 'object') {
    throw new OutputError('رد النموذج مو كائن JSON.');
  }

  const type = detectType(obj);

  if (type === 'table') return normalizeTable(obj, fallbackColumns);
  if (type === 'text') return normalizeText(obj);

  throw new OutputError(
    'نوع الرد غير معروف (المتوقع "table" أو "text").',
    JSON.stringify(obj).slice(0, 300)
  );
}

function detectType(obj) {
  if (typeof obj.type === 'string') return obj.type.trim().toLowerCase();
  if (Array.isArray(obj.rows)) return 'table';
  if (typeof obj.answer === 'string') return 'text';
  if (Array.isArray(obj.data)) return 'table'; // بعض النماذج تستخدم data
  return '';
}

function normalizeTable(obj, fallbackColumns = []) {
  const rawRows = Array.isArray(obj.rows) ? obj.rows : Array.isArray(obj.data) ? obj.data : null;
  if (!rawRows) {
    throw new OutputError('الرد من نوع table بدون مصفوفة rows.');
  }

  let columns = Array.isArray(obj.columns)
    ? obj.columns.map(toCell)
    : Array.isArray(obj.headers)
      ? obj.headers.map(toCell)
      : [];

  if (columns.length === 0) columns = fallbackColumns.map(String);
  if (columns.length === 0) {
    throw new OutputError('الرد من نوع table بدون أسماء أعمدة.');
  }

  const rows = [];
  for (const row of rawRows.slice(0, MAX_RESULT_ROWS)) {
    const cells = Array.isArray(row) ? row.map(toCell) : [toCell(row)];
    // نوحّد عدد الخلايا مع عدد الأعمدة
    while (cells.length < columns.length) cells.push('');
    rows.push(cells.slice(0, columns.length));
  }

  // ملاحظة: نرجّع نفس الشكل المتفق عليه بالضبط (type / columns / rows) بدون حقول زائدة.
  return { type: 'table', columns, rows };
}

function normalizeText(obj) {
  const raw = obj.answer ?? obj.text ?? obj.message ?? obj.result;
  const answer = typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw);
  if (!answer.trim()) {
    throw new OutputError('الرد من نوع text بدون حقل answer.');
  }
  return { type: 'text', answer: answer.trim() };
}

function toCell(value) {
  if (value === null || value === undefined) return '';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return JSON.stringify(value);
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sliceBalancedObject(text) {
  return sliceBalanced(text, '{', '}');
}

function sliceBalancedArray(text) {
  return sliceBalanced(text, '[', ']');
}

function sliceBalanced(text, open, close) {
  const start = text.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
