import { randomBytes } from 'node:crypto';
import { createApplication } from './src/app.mjs';

// Vercel provides HTTPS and a disposable runtime. APP_ORIGIN can be derived
// automatically. The SQLite file must live in the writable runtime directory.
if (process.env.VERCEL_ENV === 'production') {
  process.env.APP_ORIGIN = 'https://elitebot.live';
} else {
  process.env.APP_ORIGIN ||= process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
}
process.env.ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
process.env.SQLITE_PATH ||= process.env.VERCEL ? '/tmp/elitetrade.sqlite' : './data/elitetrade.sqlite';

const app = createApplication();
const port = Number(process.env.PORT || 3000);

app.server.listen(port, '0.0.0.0', () => {
  console.log(`Elite Bot is running on port ${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(() => {
      process.exitCode = 0;
    });
  });
}
