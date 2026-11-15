import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In `npm run dev`, serve /api/generate-recipe with the same code as the Netlify function,
// so the AI generator works locally with GEMINI_API_KEY from a .env file.
function localApi() {
  return {
    name: 'local-netlify-functions',
    configureServer(server) {
      server.middlewares.use('/api/generate-recipe', async (req, res) => {
        try {
          const { default: handler } = await server.ssrLoadModule('/netlify/functions/generate-recipe.mjs');
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const request = new Request('http://localhost/api/generate-recipe', {
            method: req.method,
            headers: { 'content-type': 'application/json' },
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
          });
          const response = await handler(request);
          res.statusCode = response.status;
          res.setHeader('content-type', 'application/json');
          res.end(await response.text());
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e?.message || e) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const k of ['GEMINI_API_KEY', 'GEMINI_MODEL']) if (env[k] && !process.env[k]) process.env[k] = env[k];
  return { plugins: [react(), localApi()] };
});
