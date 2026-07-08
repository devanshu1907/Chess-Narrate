// server.js
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 4321;
const DIST_DIR = path.join(__dirname, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

const server = http.createServer((req, res) => {
  // Normalize request path (strip query parameters)
  const urlPath = req.url.split('?')[0];
  let filePath = path.join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath);
  
  // Prevent directory traversal attacks
  if (!filePath.startsWith(DIST_DIR)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Forbidden');
    return;
  }

  const serveFile = (targetPath) => {
    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    
    // Add COOP/COEP headers to support multi-threaded WASM
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

    const stream = fs.createReadStream(targetPath);
    stream.pipe(res);
  };

  // Check if file or directory exists
  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('404 Not Found');
      return;
    }

    if (stats.isDirectory()) {
      // If it is a directory (like /about), look for index.html inside it
      const indexFilePath = path.join(filePath, 'index.html');
      fs.stat(indexFilePath, (err2, stats2) => {
        if (err2 || !stats2.isFile()) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain');
          res.end('404 Not Found');
          return;
        }
        serveFile(indexFilePath);
      });
    } else if (stats.isFile()) {
      serveFile(filePath);
    } else {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('404 Not Found');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Static file server running at http://localhost:${PORT}/`);
});
