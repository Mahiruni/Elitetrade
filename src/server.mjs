import { randomBytes } from 'node:crypto';
import { createApplication } from './app.mjs';

// Vercel provides HTTPS and a disposable runtime. APP_ORIGIN can be derived
// automatically; ENCRYPTION_KEY should still be configured as a Vercel secret
// for durable MFA/MT5 encryption across instance replacement.
process.env.APP_ORIGIN ||= process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
process.env.ENCRYPTION_KEY ||= randomBytes(32).toString('base64');

const app = createApplication();
const port = Number(process.env.PORT || 3000);
app.server.listen(port, '0.0.0.0', () => console.log(`Elite Bot is running on port ${port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => app.close().then(() => { process.exitCode = 0; }));
