import { defineConfig, Plugin, Connect } from 'vite';
import react from '@vitejs/plugin-react';
import { parseDwgIsolated } from './src/core/dwg-parser-isolated.ts';

function cadApiPlugin(): Plugin {
  // 개발 서버(5173)와 프리뷰 서버(4173)가 같은 API를 쓰도록 등록 함수를 공유
  const registerApi = (server: { middlewares: Connect.Server }) => {
      // DWG 파싱 엔드포인트
      server.middlewares.use('/api/parse-dwg', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }

        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks);
            const result = parseDwgIsolated(buffer);
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify(result));
          } catch (err: any) {
            console.error('API parse-dwg error:', err);
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 500;
            res.end(JSON.stringify({ status: 'error', message: err.message || String(err) }));
          }
        });
      });
  };

  return {
    name: 'cad-api-plugin',
    configureServer(server) {
      registerApi(server);
    },
    configurePreviewServer(server) {
      registerApi(server);
    }
  };
}

export default defineConfig({
  plugins: [react(), cadApiPlugin()],
  server: {
    port: 5173,
    host: true
  },
  optimizeDeps: {
    exclude: ['@mlightcad/libredwg-web']
  }
});
