import express from 'express';
import cors from 'cors';

import { buildPrompt, REPAIR_INSTRUCTION } from './lib/prompt.js';
import { parseModelOutput, OutputError } from './lib/parse.js';
import { generateText, ProviderError, resolveProviderConfig } from './lib/providers.js';
import { createRateLimiter } from './lib/rate-limit.js';

const SERVICE = 'murattab-agent-server';

const REQUEST_TIMEOUT_MS = positiveInt(process.env.REQUEST_TIMEOUT_MS, 50_000);
const MAX_COLUMNS = positiveInt(process.env.MAX_COLUMNS, 60);
const MAX_ROWS = positiveInt(process.env.MAX_ROWS, 400);
const MAX_QUERY_CHARS = positiveInt(process.env.MAX_QUERY_CHARS, 2_000);

export const app = express();

app.disable('x-powered-by');
if (String(process.env.TRUST_PROXY ?? '1') !== 'false') app.set('trust proxy', 1);

// ---------------------------------------------------------------- CORS
// افتراضيًا: أي origin (الموقع ما يعرف بعد). لما تستضيف الموقع، حدّد:
// ALLOWED_ORIGINS=https://your-site.com,https://www.your-site.com
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowAnyOrigin = allowedOrigins.length === 0 || allowedOrigins.includes('*');

app.use(
  cors({
    origin: allowAnyOrigin ? true : allowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86_400,
  })
);

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }));

app.use(
  createRateLimiter({
    max: positiveInt(process.env.RATE_LIMIT_PER_MIN, 30),
    windowMs: 60_000,
  })
);

// -------------------------------------------------------------- meta routes

app.get('/', (_req, res) => {
  res.json({
    service: SERVICE,
    endpoint: 'POST /agent',
    health: 'GET /health',
    request: { columns: ['...'], rows: [['...']], totalRows: 0, truncated: false, query: 'طلب المستخدم' },
  });
});

app.get('/health', (_req, res) => {
  const info = { ok: true, service: SERVICE, up: Math.round(process.uptime()) };
  try {
    const cfg = resolveProviderConfig(process.env);
    info.provider = cfg.provider;
    info.model = cfg.model;
  } catch (err) {
    info.ok = false;
    info.configError = err instanceof ProviderError ? err.publicMessage : String(err?.message || err);
  }
  res.status(info.ok ? 200 : 500).json(info);
});

// -------------------------------------------------------------- main route

app.post('/agent', async (req, res) => {
  const startedAt = Date.now();

  const checked = validateBody(req.body);
  if (!checked.ok) return fail(res, 400, checked.error);

  let cfg;
  try {
    cfg = resolveProviderConfig(process.env);
  } catch (err) {
    return fail(res, 500, err instanceof ProviderError ? err.publicMessage : String(err?.message || err));
  }

  const { columns, rows, totalRows, truncated, query } = checked.value;
  const prompt = buildPrompt({ columns, rows, totalRows, truncated, query });
  const meta = { columns, rows, totalRows, truncated, query };

  try {
    let text = await generateText({
      cfg,
      system: prompt.system,
      user: prompt.user,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      meta,
    });

    let result;
    try {
      result = parseModelOutput(text, { fallbackColumns: columns });
    } catch (err) {
      if (!(err instanceof OutputError)) throw err;

      // محاولة إصلاح وحدة: نرجّع رد النموذج له ونطلب JSON صالح فقط.
      console.warn(`[murattab] invalid JSON from model, asking for a fix: ${err.message}`);
      const repairUser = `${prompt.user}\n\n---\n${REPAIR_INSTRUCTION}\n\nردك السابق كان:\n${String(text).slice(0, 1_500)}`;

      text = await generateText({
        cfg,
        system: prompt.system,
        user: repairUser,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        meta,
      });
      result = parseModelOutput(text, { fallbackColumns: columns });
    }

    console.log(
      `[murattab] 200 provider=${cfg.provider} model=${cfg.model} type=${result.type} ` +
        `rows=${result.rows ? result.rows.length : 0} in=${rows.length} ${Date.now() - startedAt}ms`
    );
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof OutputError) {
      console.error(`[murattab] model output not usable: ${err.message} ${err.detail || ''}`);
      return fail(res, 500, 'النموذج رجع رد بصيغة غير صالحة (مو JSON). جرّب تعيد صياغة الطلب أو أبسط منه.');
    }
    if (err instanceof ProviderError) {
      console.error(`[murattab] provider error ${err.status || ''}: ${err.detail || err.publicMessage}`);
      return fail(res, 500, err.publicMessage);
    }
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      console.error(`[murattab] timeout after ${REQUEST_TIMEOUT_MS}ms`);
      return fail(res, 500, `انتهت المهلة (${Math.round(REQUEST_TIMEOUT_MS / 1000)} ثانية) بدون رد من النموذج. جرّب طلب أبسط.`);
    }
    console.error('[murattab] unexpected error', err);
    return fail(res, 500, 'خطأ غير متوقع في السيرفر أثناء تنفيذ الطلب.');
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: 'المسار غير موجود. استخدم POST /agent' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'صيغة JSON في الطلب غير صحيحة.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'حجم الطلب كبير جدًا. أرسل عدد صفوف أقل.' });
  }
  console.error('[murattab] express error', err);
  res.status(500).json({ error: 'خطأ غير متوقع في السيرفر.' });
});

// ---------------------------------------------------------------- validation

function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'الطلب لازم يكون كائن JSON فيه columns و rows و query.' };
  }

  const { columns, rows, query } = body;

  if (!Array.isArray(columns) || columns.length === 0) {
    return { ok: false, error: 'حقل columns مطلوب ولازم يكون مصفوفة غير فاضية.' };
  }
  if (columns.length > MAX_COLUMNS) {
    return { ok: false, error: `عدد الأعمدة أكبر من الحد المسموح (${MAX_COLUMNS}).` };
  }
  if (!Array.isArray(rows)) {
    return { ok: false, error: 'حقل rows مطلوب ولازم يكون مصفوفة صفوف.' };
  }
  if (typeof query !== 'string' || !query.trim()) {
    return { ok: false, error: 'حقل query مطلوب ولازم يكون نص غير فاضي.' };
  }
  if (query.length > MAX_QUERY_CHARS) {
    return { ok: false, error: `الطلب طويل جدًا (الحد ${MAX_QUERY_CHARS} حرف).` };
  }

  const cleanColumns = columns.map((c) => (c === null || c === undefined ? '' : String(c)));
  const cleanRows = rows.map((row) => (Array.isArray(row) ? row.map(cellToString) : [cellToString(row)]));

  let truncated = body.truncated === true;
  let totalRows = Number(body.totalRows);
  if (!Number.isFinite(totalRows) || totalRows < 0) totalRows = cleanRows.length;
  if (totalRows < cleanRows.length) totalRows = cleanRows.length;

  let usedRows = cleanRows;
  if (usedRows.length > MAX_ROWS) {
    usedRows = usedRows.slice(0, MAX_ROWS);
    truncated = true;
  }

  return {
    ok: true,
    value: {
      columns: cleanColumns,
      rows: usedRows,
      totalRows,
      truncated,
      query: query.trim(),
    },
  };
}

function cellToString(value) {
  if (value === null || value === undefined) return '';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  return JSON.stringify(value);
}

function fail(res, status, message) {
  res.status(status).json({ error: message });
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
