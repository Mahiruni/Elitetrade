import { createApplication } from './src/app.mjs';

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
