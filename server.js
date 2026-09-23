import 'dotenv/config';

import { app } from './app.js';
import { resolveProviderConfig, ProviderError } from './lib/providers.js';

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '0.0.0.0';

app.listen(port, host, () => {
  console.log(`[murattab] ${'murattab-agent-server'} listening on http://${host}:${port}`);
  console.log(`[murattab] endpoint: POST http://localhost:${port}/agent  |  health: GET /health`);
  try {
    const cfg = resolveProviderConfig(process.env);
    console.log(`[murattab] provider=${cfg.provider} model=${cfg.model}`);
    if (cfg.provider === 'mock') {
      console.warn('[murattab] تنبيه: المزوّد mock مفعّل — للاختبار فقط، مو للاستخدام الحقيقي.');
    }
  } catch (err) {
    const message = err instanceof ProviderError ? err.publicMessage : String(err?.message || err);
    console.error(`[murattab] تحذير: ${message}`);
    console.error('[murattab] السيرفر شغال لكن /agent بيرجع 500 لين تضبط المفتاح.');
  }
});
