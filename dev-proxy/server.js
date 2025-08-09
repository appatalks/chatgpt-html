const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

// OpenAI proxy
app.use('/openai', createProxyMiddleware({
  target: 'https://api.openai.com',
  changeOrigin: true,
  pathRewrite: {
    '^/openai': '',
  },
  onProxyReq: (proxyReq) => {
    proxyReq.setHeader('Origin', 'https://api.openai.com');
  }
}));

// Google proxy (optional)
app.use('/google', createProxyMiddleware({
  target: 'https://www.googleapis.com',
  changeOrigin: true,
  pathRewrite: {
    '^/google': '',
  },
  onProxyReq: (proxyReq) => {
    proxyReq.setHeader('Origin', 'https://www.googleapis.com');
  }
}));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Dev proxy listening on http://localhost:${PORT}`));
