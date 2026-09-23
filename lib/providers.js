/**
 * مزوّدو الذكاء الاصطناعي. المزوّد الأساسي: DeepSeek (صيغة OpenAI المتوافقة)،
 * ويدعم اختياريًا Anthropic (Claude) و OpenAI. ما فيه أي رد وهمي/تجريبي في هذا
 * الملف — كل رد يرجّع من النموذج الحقيقي.
 * كل الدوال ترجّع نص الرد الخام، والتحويل إلى JSON يصير في lib/parse.js.
 */

export class ProviderError extends Error {
  constructor(publicMessage, { status, detail } = {}) {
    super(publicMessage);
    this.name = 'ProviderError';
    this.publicMessage = publicMessage;
    this.status = status;
    this.detail = detail;
  }
}

const DEFAULT_MODELS = {
  deepseek: 'deepseek-chat',
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.4-mini',
};

// لو DeepSeek رفض اسم الموديل المضبوط، نجرّب هذا الاسم الاحتياطي مرة وحدة.
const DEEPSEEK_FALLBACK_MODEL = 'deepseek-flash';

/** يحوّل متغيرات البيئة إلى إعدادات جاهزة للمزوّد المختار. */
export function resolveProviderConfig(env = process.env) {
  let provider = String(env.AI_PROVIDER || env.PROVIDER || '').trim().toLowerCase();

  // "mock" كان مزوّدًا تجريبيًا وقد أصبح ملغى: نتجاهله ونختار المزوّد الحقيقي
  // تلقائيًا (عشان الخدمة ما تتعطل لو بقيت القيمة القديمة في إعدادات الاستضافة).
  if (provider === 'mock') {
    console.warn('[murattab] AI_PROVIDER=mock لم يعد مدعومًا — سيتم اختيار مزوّد حقيقي تلقائيًا.');
    provider = '';
  }

  // الافتراضي هو DeepSeek (مزوّد الخدمة الرسمي)، ثم Claude ثم OpenAI.
  if (!provider) {
    if (env.DEEPSEEK_API_KEY) provider = 'deepseek';
    else if (env.ANTHROPIC_API_KEY) provider = 'anthropic';
    else if (env.OPENAI_API_KEY) provider = 'openai';
  }

  if (!provider) {
    throw new ProviderError(
      'ما فيه مزوّد ذكاء اصطناعي مضبوط. أضف DEEPSEEK_API_KEY في متغيرات البيئة.'
    );
  }

  if (provider === 'deep' || provider === 'deep-seek' || provider === 'deepseek-chat') provider = 'deepseek';
  if (provider === 'claude' || provider === 'anthropic-api') provider = 'anthropic';
  if (provider === 'gpt' || provider === 'chatgpt') provider = 'openai';

  if (provider === 'deepseek') {
    const apiKey = String(env.DEEPSEEK_API_KEY || '').trim();
    if (!apiKey) throw new ProviderError('متغير البيئة DEEPSEEK_API_KEY غير موجود أو فاضي.');
    return {
      provider: 'deepseek',
      kind: 'openai',
      apiKey,
      baseUrl: stripSlash(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'),
      model: String(env.DEEPSEEK_MODEL || env.AI_MODEL || DEFAULT_MODELS.deepseek).trim(),
      maxTokens: positiveInt(env.MAX_TOKENS, 4096),
    };
  }

  if (provider === 'anthropic') {
    const apiKey = String(env.ANTHROPIC_API_KEY || '').trim();
    if (!apiKey) throw new ProviderError('متغير البيئة ANTHROPIC_API_KEY غير موجود أو فاضي.');
    return {
      provider,
      kind: 'anthropic',
      apiKey,
      baseUrl: stripSlash(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'),
      model: String(env.ANTHROPIC_MODEL || env.AI_MODEL || DEFAULT_MODELS.anthropic).trim(),
      maxTokens: positiveInt(env.MAX_TOKENS, 4096),
    };
  }

  if (provider === 'openai') {
    const apiKey = String(env.OPENAI_API_KEY || '').trim();
    if (!apiKey) throw new ProviderError('متغير البيئة OPENAI_API_KEY غير موجود أو فاضي.');
    return {
      provider,
      kind: 'openai',
      apiKey,
      baseUrl: stripSlash(env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
      model: String(env.OPENAI_MODEL || env.AI_MODEL || DEFAULT_MODELS.openai).trim(),
      maxTokens: positiveInt(env.MAX_TOKENS, 4096),
    };
  }

  throw new ProviderError(`قيمة AI_PROVIDER غير مدعومة: "${provider}". المدعوم: deepseek, anthropic, openai.`);
}

/** يرجّع نص الرد الخام من النموذج الحقيقي. */
export async function generateText({ cfg, system, user, signal }) {
  try {
    return await generateOnce(cfg, { system, user, signal });
  } catch (err) {
    // احتياطي: لو DeepSeek رفض اسم الموديل، نجرّب الاسم البديل مرة وحدة.
    if (isModelRejected(cfg, err)) {
      console.warn(
        `[murattab] DeepSeek رفض الموديل "${cfg.model}" — إعادة المحاولة بـ "${DEEPSEEK_FALLBACK_MODEL}"`
      );
      return await generateOnce({ ...cfg, model: DEEPSEEK_FALLBACK_MODEL }, { system, user, signal });
    }
    throw err;
  }
}

function isModelRejected(cfg, err) {
  if (cfg.provider !== 'deepseek') return false;
  if (cfg.model === DEEPSEEK_FALLBACK_MODEL) return false;
  if (!(err instanceof ProviderError)) return false;
  if (err.status !== 400 && err.status !== 404) return false;
  return /model/i.test(String(err.detail || ''));
}

async function generateOnce(cfg, { system, user, signal }) {
  const attempts = 1 + positiveInt(process.env.PROVIDER_RETRIES, 1);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (cfg.kind === 'anthropic' || cfg.provider === 'anthropic') {
        return await anthropicGenerate(cfg, { system, user, signal });
      }
      return await openaiGenerate(cfg, { system, user, signal });
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof ProviderError &&
        (err.status === 429 || err.status === 408 || (typeof err.status === 'number' && err.status >= 500));
      if (!retryable || attempt === attempts) throw err;
      console.warn(`[murattab] retry ${attempt}/${attempts - 1} after provider error ${err.status}`);
      await delay(900 * attempt);
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------- Anthropic

async function anthropicGenerate(cfg, { system, user, signal }) {
  const res = await fetchWithTimeout(
    `${cfg.baseUrl}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    },
    signal
  );

  const data = await readJson(res);
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();

  if (!text) {
    throw new ProviderError('النموذج رجع رد فاضي (Anthropic).', {
      status: 200,
      detail: JSON.stringify(data).slice(0, 400),
    });
  }
  return text;
}

// ------------------------------------------------------------------- OpenAI

const OPENAI_JSON_SCHEMA = {
  name: 'murattab_result',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['table', 'text'] },
      columns: { type: 'array', items: { type: 'string' } },
      rows: {
        type: 'array',
        items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } },
      },
      answer: { type: 'string' },
    },
    required: ['type', 'columns', 'rows', 'answer'],
  },
};

async function openaiGenerate(cfg, { system, user, signal }) {
  // نحاول أول شيء بـ structured output، وإذا الموديل ما يدعمه نرجع تدريجيًا.
  // DeepSeek يدعم json_object فقط، فنتخطى json_schema عشان ما نرسل طلبًا مرفوضًا.
  const formatAttempts =
    cfg.provider === 'deepseek'
      ? [{ response_format: { type: 'json_object' } }, {}]
      : [
          { response_format: { type: 'json_schema', json_schema: OPENAI_JSON_SCHEMA } },
          { response_format: { type: 'json_object' } },
          {},
        ];

  let lastError;

  for (const format of formatAttempts) {
    const body = {
      model: cfg.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...format,
    };
    if (usesMaxCompletionTokens(cfg.model)) body.max_completion_tokens = cfg.maxTokens;
    else body.max_tokens = cfg.maxTokens;

    if (cfg.provider === 'deepseek') {
      // وضع التفكير مطفّي افتراضيًا: أسرع وأرخص، ومحلل بيانات ما يحتاجه.
      const thinking = String(process.env.DEEPSEEK_THINKING || 'disabled').trim().toLowerCase();
      body.thinking = { type: thinking === 'enabled' ? 'enabled' : 'disabled' };
    }

    const res = await fetchWithTimeout(
      `${cfg.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      signal
    );

    if (res.status === 400 && Object.keys(format).length > 0) {
      const err = await toProviderError(res);
      // نفرّق بين "الموديل ما يدعم صيغة الرد" (نرجّع للصيغة اللي بعدها) وبين
      // مشكلة ثانية مثل اسم موديل غير موجود (نطلع فورًا عشان مسار الاحتياطي يشتغل).
      const looksLikeFormatIssue = /response_format|json_schema|json_object|format/i.test(String(err.detail || ''));
      if (looksLikeFormatIssue) {
        lastError = err;
        console.warn(`[murattab] المزوّد رفض صيغة الرد، نجرّب صيغة أبسط: ${short(err.detail)}`);
        continue;
      }
      throw err;
    }

    const data = await readJson(res);
    const message = data?.choices?.[0]?.message;
    const text = typeof message?.content === 'string' ? message.content.trim() : '';

    if (text) return text;

    lastError = new ProviderError('النموذج رجع رد فاضي (OpenAI).', {
      status: 200,
      detail: JSON.stringify(message ?? data).slice(0, 400),
    });
    if (message?.refusal) break;
  }

  throw lastError || new ProviderError('فشل الاتصال بـ OpenAI بدون تفاصيل.');
}

// ------------------------------------------------------------------ helpers

async function fetchWithTimeout(url, init, signal) {
  return fetch(url, { ...init, signal });
}

async function readJson(res) {
  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!res.ok) throw buildProviderError(res.status, data, raw);
  if (data === null) {
    throw new ProviderError('رد غير مفهوم من مزوّد الذكاء الاصطناعي (مو JSON).', {
      status: res.status,
      detail: raw.slice(0, 300),
    });
  }
  return data;
}

async function toProviderError(res) {
  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  return buildProviderError(res.status, data, raw);
}

function buildProviderError(status, data, raw) {
  const detail =
    data?.error?.message || data?.message || data?.error?.type || (raw ? raw.slice(0, 300) : '');

  let publicMessage;
  if (status === 401 || status === 403) {
    publicMessage = 'مفتاح الـ API غير صحيح أو ما عنده صلاحية. تأكد من المفتاح في متغيرات البيئة.';
  } else if (status === 404) {
    publicMessage = 'اسم الموديل غير موجود عند المزوّد. تأكد من قيمة الموديل في متغيرات البيئة.';
  } else if (status === 429) {
    publicMessage = 'تم تجاوز حد الاستخدام أو الرصيد غير كافٍ عند مزوّد الذكاء الاصطناعي. انتظر قليلًا وجرّب.';
  } else if (status === 400 || status === 422) {
    publicMessage = `الطلب مرفوض من مزوّد الذكاء الاصطناعي: ${short(detail) || 'تفاصيل غير متوفرة'}`;
  } else if (status === 413) {
    publicMessage = 'البيانات المرسلة كبيرة على المزوّد. جرّب طلب على جزء أصغر من البيانات.';
  } else if (typeof status === 'number' && status >= 500) {
    publicMessage = `مزوّد الذكاء الاصطناعي رجع خطأ مؤقت (كود ${status}). جرّب مرة ثانية.`;
  } else {
    publicMessage = `فشل طلب النموذج (كود ${status || 'غير معروف'}).`;
  }

  return new ProviderError(publicMessage, { status, detail: short(detail, 400) });
}

function short(value, max = 200) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function stripSlash(url) {
  return String(url).trim().replace(/\/+$/, '');
}

function usesMaxCompletionTokens(model) {
  return /^(o[1-9]|gpt-5|gpt-6)/i.test(String(model || ''));
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
