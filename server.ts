import { createSupabaseApplication } from './src/supabase-app.mjs';

if (process.env.VERCEL_ENV === 'production') {
  process.env.APP_ORIGIN = 'https://elitebot.live';
} else {
  process.env.APP_ORIGIN ||= process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
}

const app = createSupabaseApplication();
const port = Number(process.env.PORT || 3000);

app.server.listen(port, '0.0.0.0', () => {
  console.log(`Elite Bot is running on port ${port} with Supabase persistence`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(() => {
      process.exitCode = 0;
    });
  });
}
