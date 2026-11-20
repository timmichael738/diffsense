import { buildApp } from './app.js';
import { ClaudeReviewer } from './reviewer.js';

const app = await buildApp({
  reviewer: new ClaudeReviewer(),
  githubToken: process.env.GITHUB_TOKEN,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

await app.listen({ host: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 8787) });
