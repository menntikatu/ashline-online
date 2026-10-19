// server.js — 対戦サーバー（Render / Fly.io / Railway など「Nodeが動く場所」用）
// 使い方:  npm install ws  →  node server.js   （index.html と freematch.js を同じフォルダに置く）
// GitHub Pages に index.html を置く場合も、この server.js は別の場所（Render等）で動かし、index.html の「SETTINGS → 対戦サーバー」にURLを入れる。
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const { setupFreeMatch, FM } = require('./freematch');
let wss;
const server = http.createServer((req, res) => {
  if (req.url === '/health') {                                              // 接続テスト用（別サイトのページからも読めるようCORS許可）
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ ok: true, version: FM.VERSION, proto: FM.PROTO, online: wss ? wss.clients.size : 0 }));
  }
  fs.readFile(path.join(__dirname, 'index.html'), (err, buf) => {
    if (err) { res.writeHead(404); return res.end('index.html not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(buf);   // 端末ごとに古い版が残らないように
  });
});
wss = new WebSocketServer({ server, path: '/ws' });
setupFreeMatch(wss);
wss.on('connection', (ws, req) => console.log('connected', req.socket.remoteAddress, 'online=' + wss.clients.size));
process.on('uncaughtException', e => console.error('uncaught', e));
server.listen(process.env.PORT || 3000, () => console.log('listening on', process.env.PORT || 3000, 'freematch', FM.VERSION));
