import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => ({
  plugins: [react(), ...(command === 'serve' ? [{
    name: 'local-development-csp',
    transformIndexHtml(html: string) { return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:*"); },
  }] : [])],
  base: './', server: { host: '127.0.0.1', port: 5173, strictPort: false },
}));
