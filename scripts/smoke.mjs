/**
 * اختبار سريع للـ endpoint بدون أي مكتبات خارجية.
 * الاستخدام:
 *   npm run smoke                                (يختبر سيرفر محلي على 127.0.0.1:8787)
 *   BASE_URL=https://xxx.onrender.com npm run smoke
 *   ERROR_URL=https://yyy.onrender.com npm run smoke   (سيرفر بدون مفتاح، لازم يرجّع 500)
 */

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const ERROR_URL = (process.env.ERROR_URL || '').replace(/\/+$/, '');

let passed = 0;
let failed = 0;

function check(name, condition, details) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${details ? ` -> ${details}` : ''}`);
  }
}

const sampleBody = {
  columns: ['المنتج', 'الكمية', 'السعر'],
  rows: [
    ['كرسي', 12, 850],
    ['طاولة', 2, 4200],
    ['مصباح', 40, 120],
  ],
  totalRows: 3,
  truncated: false,
  query: 'طلعلي الصفوف اللي فيها قيمة أكبر من 1000',
};

async function postJson(url, body, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, json, text };
}

function isAgentShape(json) {
  if (!json || typeof json !== 'object') return false;
  if (json.type === 'text') return typeof json.answer === 'string';
  if (json.type === 'table') return Array.isArray(json.columns) && Array.isArray(json.rows) && json.columns.length > 0;
  return false;
}

console.log(`\n== اختبار ${BASE_URL} ==\n`);

// 1) الصفحة الرئيسية
try {
  const res = await fetch(`${BASE_URL}/`);
  const json = await res.json();
  check('GET / يرجّع 200 مع معلومات الخدمة', res.status === 200 && json.service === 'murattab-agent-server', `status ${res.status}`);
} catch (err) {
  check('GET / يرجّع 200 مع معلومات الخدمة', false, String(err.message));
}

// 2) health
try {
  const res = await fetch(`${BASE_URL}/health`);
  const json = await res.json();
  check('GET /health يرجّع 200', res.status === 200, `status ${res.status} body ${JSON.stringify(json)}`);
  console.log(`        provider=${json.provider} model=${json.model}`);
} catch (err) {
  check('GET /health يرجّع 200', false, String(err.message));
}

// 3) CORS preflight
try {
  const res = await fetch(`${BASE_URL}/agent`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://example.com',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  const allowOrigin = res.headers.get('access-control-allow-origin');
  check('CORS preflight مسموح', (res.status === 204 || res.status === 200) && !!allowOrigin, `status ${res.status} allow-origin ${allowOrigin}`);
} catch (err) {
  check('CORS preflight مسموح', false, String(err.message));
}

// 4) طلب جدول
try {
  const { res, json, text } = await postJson(`${BASE_URL}/agent`, sampleBody, { origin: 'https://example.com' });
  check('POST /agent (طلب فلترة) يرجّع 200 JSON بالشكل المتفق عليه', res.status === 200 && isAgentShape(json), `status ${res.status} body ${text.slice(0, 200)}`);
  check('ترويسة CORS موجودة في الرد', !!res.headers.get('access-control-allow-origin'), 'missing header');
  if (json) console.log(`        type=${json.type} ${json.type === 'table' ? `rows=${json.rows.length}` : `answer="${String(json.answer).slice(0, 60)}…"`}`);
} catch (err) {
  check('POST /agent (طلب فلترة) يرجّع 200 JSON بالشكل المتفق عليه', false, String(err.message));
}

// 5) طلب نصي
try {
  const { res, json } = await postJson(`${BASE_URL}/agent`, { ...sampleBody, query: 'كم عدد الصفوف؟ ولخصلي البيانات' });
  check('POST /agent (طلب نصي) يرجّع رد صالح', res.status === 200 && isAgentShape(json), `status ${res.status} body ${JSON.stringify(json).slice(0, 200)}`);
} catch (err) {
  check('POST /agent (طلب نصي) يرجّع رد صالح', false, String(err.message));
}

// 6) طلب ناقص -> 400
try {
  const { res, json } = await postJson(`${BASE_URL}/agent`, { columns: ['a'], rows: [] });
  check('طلب ناقص يرجّع 400 مع error', res.status === 400 && typeof json?.error === 'string', `status ${res.status}`);
} catch (err) {
  check('طلب ناقص يرجّع 400 مع error', false, String(err.message));
}

// 7) JSON مكسور -> 400
try {
  const res = await fetch(`${BASE_URL}/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ columns: oops',
  });
  const json = await res.json().catch(() => null);
  check('JSON مكسور يرجّع 400 مع error', res.status === 400 && typeof json?.error === 'string', `status ${res.status}`);
} catch (err) {
  check('JSON مكسور يرجّع 400 مع error', false, String(err.message));
}

// 8) مسار غير موجود -> 404
try {
  const res = await fetch(`${BASE_URL}/nope`);
  const json = await res.json().catch(() => null);
  check('مسار غير موجود يرجّع 404 مع error', res.status === 404 && typeof json?.error === 'string', `status ${res.status}`);
} catch (err) {
  check('مسار غير موجود يرجّع 404 مع error', false, String(err.message));
}

// 9) سيرفر بدون مفتاح API -> 500 مع error
if (ERROR_URL) {
  try {
    const { res, json } = await postJson(`${ERROR_URL}/agent`, sampleBody);
    check('سيرفر بدون مفتاح يرجّع 500 مع error واضح', res.status === 500 && typeof json?.error === 'string', `status ${res.status} body ${JSON.stringify(json).slice(0, 200)}`);
  } catch (err) {
    check('سيرفر بدون مفتاح يرجّع 500 مع error واضح', false, String(err.message));
  }
}

console.log(`\n== النتيجة: ${passed} ناجح، ${failed} فاشل ==\n`);
process.exit(failed === 0 ? 0 : 1);
