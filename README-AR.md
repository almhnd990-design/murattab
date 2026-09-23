# مُرتّب — السيرفر الخلفي (Agent Backend)

هذا مجلد واحد فيه سيرفر صغير (Node.js + Express) فيه **endpoint واحد فقط**: `POST /agent`.
يستقبل طلب الموقع، يبنيه كـ prompt ويرسله لنموذج ذكاء اصطناعي (Claude أو GPT)، ويرجّع الرد
بصيغة JSON محددة. **الموقع (HTML) ما تغيّر ولا شي — بس تضيف فيه رابط الـ endpoint.**

> ملاحظة صريحة: ما أقدر أعطيك رابط `https://...` جاهز لأنه يحتاج **حسابك الشخصي** عند
> الاستضافة و**مفتاح الـ API الخاص بك**. الخطوات تحت تأخذك من الصفر للرابط النهائي في
> حدود ١٥ دقيقة، والرابط بيكون شكله: `https://<اسم-المشروع>.onrender.com/agent`

---

## 1) محتويات المجلد

| الملف | وظيفته |
|---|---|
| `server.js` | نقطة التشغيل (يقرأ `.env` ويشغّل السيرفر) |
| `app.js` | تطبيق Express: CORS + التحقق + `/agent` + `/health` + معالجة الأخطاء |
| `lib/prompt.js` | بناء الـ prompt (الأعمدة + البيانات + طلب المستخدم + صيغة الرد) |
| `lib/providers.js` | الاتصال بـ Anthropic / OpenAI + إعادة المحاولة + رسائل أخطاء عربية |
| `lib/parse.js` | التأكد أن رد النموذج JSON صالح وتحويله للشكل المطلوب |
| `lib/rate-limit.js` | حد ٣٠ طلب/دقيقة لكل IP (حماية مفتاحك) |
| `render.yaml` | ملف نشر جاهز لـ Render (اختياري) |
| `api/agent.js` + `vercel.json` | للنشر على Vercel (اختياري) |
| `example-request.json` | طلب تجريبي جاهز للاختبار |
| `site/` | **الموقع نفسه**: `index.html` + `privacy.html` + `terms.html` |
| `scripts/check-endpoint.ps1` | سكربت اختبار الرابط من جهازك (ويندوز) |
| `scripts/smoke.mjs` | اختبار شامل للسيرفر (١٠ اختبارات) |
| `.env.example` | نموذج الإعدادات — انسخه إلى `.env` |
| `.dev/` | أدوات اختبار للمبرمجين فقط (تقدر تتجاهلها) |

---

## 2) الخطوة الأولى: جيب مفتاح API

اختر **واحدًا فقط** من الثلاثة (ما تحتاج أكثر من مزوّد):

### الخيار (ج) DeepSeek ← الأرخص بفارق كبير (موصى به)
هذا نفس عائلة النموذج اللي يشتغل داخل الوكيل اللي تكلمه الحين، وسعره أقل من Claude بـ **~١٥ مرة**.
1. افتح <https://platform.deepseek.com> وسوّ حساب (بريد فقط).
2. **Top up / Recharge** → أضف رصيد (٢–٥ دولار تكفي لآلاف الطلبات).
3. من القائمة: **API Keys** → **Create new API key** → اسمّه `murattab`.
4. **انسخ المفتاح فورًا** (يبدأ بـ `sk-...`) واحفظه بالمفكرة.
5. الموديل المناسب لك: `deepseek-flash` (رخيص وسريع جدًا).

### الخيار (أ) Anthropic — Claude  ← الأذكى في العربي
1. افتح <https://console.anthropic.com> وسوّ حساب (يحتاج بريد + جوال).
2. من القائمة اليسرى: **Billing** → أضف رصيد (يكفي ٥ دولارات للتجربة، والاستخدام هنا رخيص جدًا).
3. من القائمة: **API Keys** → اضغط **Create Key** → اسمّه مثلاً `murattab`.
4. **انسخ المفتاح فورًا** (يبدأ بـ `sk-ant-...`) — ما يبين مرة ثانية.
5. احفظه في مكان آمن مؤقتًا (مفكرة على جهازك مثلاً).

### الخيار (ب) OpenAI — GPT
1. افتح <https://platform.openai.com> وسوّ حساب.
2. **Settings → Billing** → أضف رصيد (٥ دولارات تكفي للتجربة).
3. **API keys → Create new secret key** → انسخ المفتاح (`sk-...`).
4. احفظه في مكان آمن.

> ⚠️ المفتاح مثل كلمة سر بنكك: لا تحطه في ملف HTML، ولا في GitHub، ولا ترسله لأحد.
> هو ينحط فقط في "متغيرات البيئة" عند الاستضافة (شرحها في الخطوة ٤).

**التكلفة المتوقعة:** كل طلب من صندوق "اطلب أي شيء" يرسل ~١٥٠ صف ويرجّع جدولًا صغيرًا:

| المزوّد + الموديل | تكلفة الطلب الواحد تقريبًا | ١٠٠٠ طلب |
|---|---|---|
| `deepseek-flash` | ~٠.٢ سنت (أو أقل) | أقل من ٣ دولارات |
| `claude-haiku-4-5-20251001` | ~١ سنت | ~١٠ دولارات |
| `claude-sonnet-5` | ~٣ سنت | ~٣٠ دولارًا |

> ما تحتاج أي **اشتراك شهري** — كل المزوّدين هنا بالاستخدام (تدفع على قد ما تستهلك فقط).
> وتقدر تبدّل المزوّد في أي وقت بتغيير سطر واحد (`AI_PROVIDER`) بدون أي تعديل في الكود.

---

## 3) (اختياري) جرّب السيرفر على جهازك قبل النشر

تحتاج تنزيل Node.js من <https://nodejs.org> (نسخة LTS). بعدها افتح PowerShell داخل المجلد:

```powershell
npm install
Copy-Item .env.example .env      # ثم افتح .env بالمفكرة وحط مفتاحك
npm start
```

بعدها افتح الرابط `http://localhost:8787/health` في المتصفح — لازم تشوف:

```json
{"ok":true,"service":"murattab-agent-server","provider":"anthropic","model":"claude-sonnet-5","up":3}
```

واختبر الـ endpoint:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-endpoint.ps1 -Url http://localhost:8787/agent
```

> تبي تتأكد أن كل شي شغال **بدون** ما تصرف رصيد؟ حط في `.env` السطر `AI_PROVIDER=mock`
> وشغّل `npm run smoke` — ١٠ اختبارات تمر بدون أي مفتاح.

---

## 4) النشر على Render (الطريقة الموصى بها) — خطوة بخطوة

Render مجاني للبداية، وما يبغى بطاقة في أغلب الحالات، والرابط اللي يعطيك هو نفسه اللي
تحطه في الموقع. (الأرقام والصفحات تتغير، فلو لقيت اختلاف بسيط في الأسماء دور على الأقرب لها.)

### 4.1 ارفع الملفات على GitHub
1. سوّ حساب على <https://github.com> (Sign up) — مجاني.
2. من الصفحة الرئيسية اضغط الزر الأخضر **New** لإنشاء مستودع جديد.
3. **Repository name**: `murattab-agent-server` → اختر **Private** (أنسب) → **Create repository**.
4. في الصفحة الجديدة اضغط على رابط **uploading an existing file**.
5. افتح مجلد المشروع على جهازك، وحدّد **الملفات والمجلدات التالية فقط** واسحبها لصفحة GitHub:
   - المجلدات: `api` ، `lib` ، `scripts`
   - الملفات: `app.js` ، `server.js` ، `package.json` ، `package-lock.json` ،
     `render.yaml` ، `vercel.json` ، `example-request.json` ، `README-AR.md`
   - **لا تسحب**: `node_modules` (ثقيل جدًا) ولا `.npm-cache` ولا `.env` (فيه المفتاح) ولا `.dev`.
6. اكتب في خانة الوصف: `backend for murattab` → اضغط **Commit changes**.

> ملاحظة عن الملفات المخفية (تبدأ بنقطة): لو ما ظهرت عندك في المستكشف، فعّل
> **View → Show → Hidden items** في ويندوز. مو ضرورية للنشر، لكن `.env.example` و`.gitignore`
> حلو تكون موجودة.

### 4.2 اربط Render بـ GitHub
1. افتح <https://render.com> → **Get Started** → سجّل دخول بحساب GitHub (أسهل طريقة: **GitHub**).
2. وافق على صلاحية قراءة المستودعات (تقدر تحدد مستودع واحد فقط).

### 4.3 أنشئ السيرفر
1. من لوحة Render اضغط **New +** → **Web Service**.
2. اختر المستودع `murattab-agent-server` → **Connect**.
3. املأ الحقول هذي **بالضبط**:

| الحقل | القيمة |
|---|---|
| **Name** | `murattab-agent` (أو أي اسم) |
| **Language / Runtime** | `Node` |
| **Region** | `Frankfurt (EU Central)` — الأقرب للخليج |
| **Branch** | `main` |
| **Root Directory** | اتركه فاضي |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | `Free` |

4. انزل لقسم **Environment Variables** واضغط **Add Environment Variable** وأضف هذي:

| Key | Value |
|---|---|
| `AI_PROVIDER` | `deepseek` (أو `anthropic` / `openai`) |
| `DEEPSEEK_API_KEY` | مفتاحك `sk-...` من DeepSeek |
| `DEEPSEEK_MODEL` | `deepseek-flash` |
| `ALLOWED_ORIGINS` | `*` مبدئيًا — بعدين حددها لدومين موقعك |

> لو اخترت Claude بدل DeepSeek، بدّل الثلاثة الأولى إلى:
> `AI_PROVIDER` = `anthropic` و`ANTHROPIC_API_KEY` = مفتاحك و`ANTHROPIC_MODEL` = `claude-sonnet-5`.

5. اضغط **Create Web Service** وانتظر ٢–٣ دقايق لين تخلص عملية البناء (**Live** بالأخضر).

### 4.4 خذ الرابط واختبره
1. فوق الصفحة بتحصل الرابط، شكله: `https://murattab-agent.onrender.com`
   (لو اخترت اسم ثاني، الرابط يتغير بنفس النمط).
2. افتح في المتصفح: `https://murattab-agent.onrender.com/health`
   لازم يبين `{"ok":true,...,"provider":"anthropic",...}`.
   **لو بين `ok:false`** معناها المفتاح غلط أو ناقص → راجع قسم حل المشاكل.
3. رقم ١ اختبار حقيقي من جهازك (ويندوز):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check-endpoint.ps1 -Url https://murattab-agent.onrender.com/agent
```

لازم يبين: الحالة `200` ورد JSON صحيح (جدول بـ `columns` و`rows`، أو نص بـ `answer`) ✅

**رابط الـ endpoint النهائي اللي تحطه في الموقع:**

```
https://murattab-agent.onrender.com/agent
```

---

## 5) الموقع (Frontend) — جاهز للإطلاق

ملفات الموقع النهائية في مجلد `site/`:

| الملف | الوصف |
|---|---|
| `site/index.html` | الموقع كامل (رفع + تنظيف + تحميل + صندوق الطلبات) |
| `site/privacy.html` | سياسة الخصوصية |
| `site/terms.html` | شروط الاستخدام |

**اللي صار على الموقع:**
- رأس ثابت (sticky) أعلى الصفحة: أيقونة + اسم «مُرتّب» بالأخضر الداكن `#2D5F4C` (نفس هوية التصميم) + روابط الخصوصية والشروط.
- تذييل فيه رابطا «سياسة الخصوصية» و«شروط الاستخدام» + سنة النشر + اسم الموقع.
- تحسينات للجوال: الرسم التوضيحي يترتب عموديًا، الأزرار بعرض كامل، ولا تمرير أفقي.
- إصلاح مهم: عمود التواريخ كان ما يتوحّد أبدًا لأن إكسل يرجّع التاريخ بصيغة `1/4/26`؛ الحين التنظيف يشتغل على القيم الخام والتاريخ يطلع `2026-01-04`.

**⚠️ شي واحد ناقص منك:** في `site/privacy.html` و`site/terms.html` فيه سطر `[ضع بريدك الإلكتروني هنا]` — بدّله ببريدك (أو احذف السطر).

### 5.1 ركّب رابط السيرفر في الموقع (تعديل سطر واحد)
1. افتح `site/index.html` بالمفكرة أو أي محرر نصوص.
2. اضغط `Ctrl + F` وابحث عن: `AGENT_API_URL`
3. بتحصل السطر **729**:
   ```js
   AGENT_API_URL: 'https://REPLACE-WITH-YOUR-RENDER-URL.onrender.com/agent'
   ```
4. بدّل الرابط كامل برابط سيرفرك (بين علامتي التنصيص، بدون مسافة زايدة):
   ```js
   AGENT_API_URL: 'https://murattab-agent.onrender.com/agent'
   ```
5. احفظ، ارفع الملف على الاستضافة (تحت)، وبعدها ارفع ملف إكسل وجرّب الصندوق.

> لو بقي فيه `REPLACE-WITH`، الموقع يبين «الوكيل غير مفعّل بعد» بدل ما يفشل بصمت.

### 5.2 استضافة الموقع (Static Site على Render — مجاني)
نفس المستودع يقدر يستضيف الموقع والسيرفر معًا، بدون أي تكلفة:
1. من لوحة Render: **New +** → **Static Site**.
2. اختر نفس المستودع `murattab-agent-server`.
3. **Root Directory**: `site` — **Build Command**: اتركه فاضي — **Publish Directory**: `.`
4. **Create Static Site** → بيطلع لك رابط مثل: `https://murattab-site.onrender.com`
5. الرابط النهائي للموقع: `https://murattab-site.onrender.com` (والصفحات: `/privacy.html` و`/terms.html`).

> بدائل مجانية للموقع: GitHub Pages أو Netlify أو Cloudflare Pages — كلها تنشر نفس مجلد `site` كما هو (ملفات ثابتة بدون أي بناء).

> ملاحظة أمنية: بعد ما يصير عندك دومين الموقع، حدّد `ALLOWED_ORIGINS` في متغيرات بيئة السيرفر لدومينك بدل `*`.

---

## 5.3) بدائل Render

### Railway
1. <https://railway.app> → سجّل بحساب GitHub.
2. **New Project → Deploy from GitHub repo** → اختر نفس المستودع.
3. Railway يكتشف Node تلقائيًا ويشغّل `npm start` (لا يحتاج أي إعداد بناء).
4. من تبويب **Variables** أضف نفس المتغيرات الأربعة في الجدول فوق.
5. من **Settings → Networking → Generate Domain** بتاخذ رابط مثل:
   `https://murattab-agent-production.up.railway.app/agent`
   ⚠️ خطة Railway المجانية تجريبية برصيد محدود ثم تصير مدفوعة — تأكد من صفحة الأسعار.

### Vercel
1. <https://vercel.com> → سجّل بحساب GitHub → **Add New → Project** → اختر المستودع → **Deploy**.
2. من **Settings → Environment Variables** أضف نفس المتغيرات ثم **Redeploy**.
3. الرابط يكون: `https://<اسم-المشروع>.vercel.app/api/agent`
   (لاحظ `/api/agent` مو `/agent` — لأن Vercel يحوّل كل ملف داخل مجلد `api` لمسار).
4. ⚠️ خطة Vercel المجانية (Hobby) مخصّصة للاستخدام **غير التجاري**؛ بما أن مُرتّب منتج،
   الأفضل Render أو Railway. كذلك Vercel ينهي الدوال بعد ٦٠ ثانية كحد أقصى.

---

## 7) حل المشاكل (الأعراض الشائعة)

| العَرَض | السبب المرجّح | الحل |
|---|---|---|
| الموقع يبين "تعذّر تنفيذ الطلب" | السيرفر رجّع خطأ (400/500) | افتح `<الرابط>/health`؛ لو `ok:false` فالمفتاح غلط/ناقص، صحّحه في متغيرات البيئة |
| `ok:false` + رسالة "مفتاح الـ API غير صحيح" | المفتاح منسوخ ناقص أو فيه مسافة | أعد نسخ المفتاح كامل بدون مسافات، واحفظ التعديل (Render يعيد النشر تلقائيًا) |
| `ok:false` + "اسم الموديل غير موجود" | اسم الموديل مو متوفر لحسابك | جرّب `claude-haiku-4-5-20251001` أو `gpt-5.4-mini` |
| أول طلب يأخذ ٣٠–٦٠ ثانية | خطة Render المجانية توقف الخدمة بعد ١٥ دقيقة خمول (Cold Start) | طبيعي؛ الطلب الثاني سريع. لو يضايقك، رقّي للخطة المدفوعة (~٧$ شهريًا) |
| "عدد الطلبات كثير حاليًا" | تجاوزت ٣٠ طلب/دقيقة | انتظر دقيقة، أو ارفع `RATE_LIMIT_PER_MIN` |
| "تم تجاوز حد الاستخدام أو الرصيد غير كافٍ" | رصيد حساب Anthropic/OpenAI صفر | أضف رصيد من لوحة المزوّد |
| المتصفح يبين خطأ CORS في الـ Console | `ALLOWED_ORIGINS` محدّد لدومين ثاني | خليه `*` أو حدّده لدومين موقعك بالضبط |
| الرد يبين JSON خام بدل جدول | السيرفر رجّع شكل غير متوقع | نادر — لكن تأكد أن `type` إما `table` أو `text` (السيرفر يتحقق من هذا تلقائيًا) |

**كيف أشوف سجل الأخطاء؟** من لوحة Render: **Logs**. كل سطر يبدأ بـ `[murattab]` ويبين
نوع الخطأ بالتفصيل (بدون ما يطبع مفتاحك أبدًا).

---

## 8) متغيرات البيئة (مرجع سريع)

| المتغير | افتراضي | الوصف |
|---|---|---|
| `AI_PROVIDER` | تلقائي | `deepseek` أو `anthropic` أو `openai` أو `mock` (للاختبار فقط) |
| `DEEPSEEK_API_KEY` | — | مفتاح DeepSeek (الأرخص) |
| `DEEPSEEK_MODEL` | `deepseek-flash` | اسم الموديل |
| `DEEPSEEK_THINKING` | `disabled` | وضع التفكير — اتركه مطفّي (أسرع وأرخص) |
| `ANTHROPIC_API_KEY` | — | مفتاح Claude (مطلوب لو اخترت anthropic) |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | اسم الموديل |
| `OPENAI_API_KEY` | — | مفتاح OpenAI (مطلوب لو اخترت openai) |
| `OPENAI_MODEL` | `gpt-5.4-mini` | اسم الموديل |
| `MAX_TOKENS` | `4096` | أقصى طول للرد |
| `REQUEST_TIMEOUT_MS` | `50000` | مهلة الطلب قبل ما يرجّع 500 |
| `MAX_ROWS` / `MAX_COLUMNS` | `400` / `60` | حدود البيانات المستقبلة (الزائد يُقتطع) |
| `MAX_RESULT_ROWS` | `200` | أقصى صفوف في الرد للموقع |
| `RATE_LIMIT_PER_MIN` | `30` | حد الطلبات لكل IP (`0` = بدون حد) |
| `ALLOWED_ORIGINS` | `*` | الدومينات المسموحة: `https://site.com,https://www.site.com` |
| `PORT` | `8787` (محليًا) | الاستضافة تحطه تلقائيًا |
| `TRUST_PROXY` | `1` | اتركه كما هو على Render/Railway |

---

## 9) عقد الـ API

**الطلب** `POST /agent` — `Content-Type: application/json`:

```json
{
  "columns": ["المنتج", "الكمية", "السعر"],
  "rows": [["كرسي", 12, 850], ["طاولة", 2, 4200]],
  "totalRows": 1500,
  "truncated": true,
  "query": "طلعلي الصفوف اللي فيها قيمة أكبر من 1000"
}
```

**الرد الناجح** (200) — أحد شكلين فقط، بدون أي حقول زايدة:

```json
{ "type": "table", "columns": ["المنتج", "السعر"], "rows": [["طاولة", 4200]] }
```
```json
{ "type": "text", "answer": "عدد الصفوف اللي فيها قيمة أكبر من ١٠٠٠ هو ١." }
```

**الرد عند الخطأ**: `{ "error": "رسالة واضحة بالعربي" }`
(400 لطلب ناقص/غير صالح، 429 لكثرة الطلبات، 500 لفشل النموذج أو رد غير JSON).
السيرفر **ما يعلّق أبدًا**: فيه مهلة ٥٠ ثانية وإعادة محاولة تلقائية إذا النموذج رجّع JSON مكسور.

**روابط مساعدة**: `GET /health` (حالة السيرفر والمزوّد) و`GET /` (معلومات الخدمة).

---

## 10) الأمان — ٥ قواعد

1. المفتاح في متغيرات البيئة فقط — مو في الكود ولا في الـ HTML ولا في GitHub.
2. لا ترفع ملف `.env` على GitHub أبدًا (`.gitignore` يمنعه تلقائيًا عند الرفع من جهازك).
3. بعد ما تستضيف الموقع، حدّد `ALLOWED_ORIGINS` بدومينك بدل `*` حتى ما يستخدم أحد سيرفرك.
4. اترك `RATE_LIMIT_PER_MIN` مفعّل — يمنع استهلاك مفتاحك من عبث الغير.
5. من لوحة Anthropic/OpenAI اضبط **Spending Limit** شهري (مثلاً ١٠$) حتى ما تتفاجأ بفاتورة.
