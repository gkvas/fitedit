import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');

const app = express();

app.disable('x-powered-by');

// Defense-in-depth: the app is fully client-side, so scripts/styles/fonts all
// come from our own origin; the only external requests are OpenStreetMap map
// tiles. This also enforces at the platform level that a loaded FIT file's
// data can't be sent anywhere (connect-src 'self').
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' https://*.tile.openstreetmap.org data:",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
});

app.use(express.static(distDir));

// Single-page app: any unmatched route serves index.html.
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`fitedit serving dist/ on http://localhost:${port}`);
});
