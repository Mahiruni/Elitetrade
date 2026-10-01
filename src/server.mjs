import { createApplication } from './app.mjs';

if (!process.env.APP_ORIGIN && process.env.VERCEL_URL) {
  process.env.APP_ORIGIN = `https://${process.env.VERCEL_URL}`;
}
process.env.SQLITE_PATH ||= process.env.VERCEL ? '/tmp/elitetrade.sqlite' : './data/elitetrade.sqlite';

const app = createApplication();
const port = Number(process.env.PORT || 3000);
app.server.listen(port, '0.0.0.0', () => console.log(`Elite Bot is running on port ${port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => app.close().then(() => { process.exitCode = 0; }));
