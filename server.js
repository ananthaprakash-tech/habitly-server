const http = require('http');
const fs = require('fs');
const path = require('path');

// In-memory store (persists while server runs)
// For Railway free tier - data persists as long as server is up
let DB = {};
const DB_FILE = path.join(__dirname, 'db.json');

// Load saved data on startup
try {
  if (fs.existsSync(DB_FILE)) {
    DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    console.log('Loaded saved data');
  }
} catch(e) { console.log('Starting fresh'); }

function saveDB() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(DB)); } catch(e) {}
}

const server = http.createServer((req, res) => {
  // CORS headers - allow all origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  
  const url = req.url;
  
  // GET /data - load all data
  if (req.method === 'GET' && url === '/data') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, data: DB, ts: DB._ts || 0 }));
    return;
  }
  
  // POST /data - save all data  
  if (req.method === 'POST' && url === '/data') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const incomingTs = payload._ts || 0;
        const currentTs = DB._ts || 0;
        
        // Only update if incoming data is newer
        if (incomingTs >= currentTs) {
          DB = payload;
          DB._ts = incomingTs || Date.now();
          saveDB();
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, ts: DB._ts }));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, skipped: true, reason: 'older data' }));
        }
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }
  
  // GET / - health check
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, app: 'Habitly Sync Server', version: '1.0' }));
    return;
  }
  
  res.writeHead(404);
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Habitly sync server running on port', PORT));
