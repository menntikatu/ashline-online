'use strict';
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws', maxPayload: 16 * 1024 });
const rooms = new Map();
let nextId = 1;
const VALID_MAPS = new Set(['shibuya', 'industrial', 'village']);

app.disable('x-powered-by');
app.use(express.static(__dirname, { extensions: ['html'] }));
app.get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'ashline-online', rooms: rooms.size, clients: wss.clients.size }));
app.get('/api/status', (_req, res) => res.status(200).json({ ok: true, rooms: [...rooms.entries()].map(([code, room]) => ({ room: code, map: room.map, players: room.players.size })) }));
function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch (err) { console.error('send failed:', err.message); }
  }
}
function broadcast(room, obj, except = null) {
  for (const player of room.players.values()) if (player.ws !== except) send(player.ws, obj);
}
function roomState(room) {
  const players = [...room.players.values()].map(p => ({ id: p.id, role: p.role }));
  broadcast(room, { type: 'room-state', count: players.length, players });
}
function removePlayer(ws, reason = 'disconnect') {
  const player = ws.player;
  if (!player) return;
  ws.player = null;
  const room = rooms.get(player.room);
  if (!room) return;
  room.players.delete(player.id);
  console.log(`player ${player.id} left room ${player.room} (${reason})`);
  if (room.players.size === 0) {
    rooms.delete(player.room);
    console.log(`room ${player.room} removed`);
  } else {
    broadcast(room, { type: 'peer-left', id: player.id });
    roomState(room);
  }
}
function validRoomCode(value) { return /^\d{6}$/.test(String(value || '')); }

wss.on('connection', (ws, req) => {
  ws.player = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  console.log('websocket connected:', req.socket.remoteAddress || 'unknown');
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: '通信データを読み取れませんでした。ページを再読み込みしてね。' }); }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'create' || msg.type === 'join') {
      if (ws.player) return send(ws, { type: 'error', message: 'すでに部屋に接続しています。ページを再読み込みしてね。' });
      const code = String(msg.room || '');
      const map = String(msg.map || 'shibuya');
      if (!validRoomCode(code)) return send(ws, { type: 'error', message: '部屋番号は6桁の数字です。' });
      if (!VALID_MAPS.has(map)) return send(ws, { type: 'error', message: '選択したマップがサーバーにありません。ページを更新してね。' });
      let room = rooms.get(code);
      if (msg.type === 'create') {
        if (room && room.players.size > 0) return send(ws, { type: 'error', message: 'その部屋番号は使用中です。「部屋を作る」をもう一度押してね。' });
        room = { code, map, players: new Map(), createdAt: Date.now() };
        rooms.set(code, room);
      } else {
        if (!room) return send(ws, { type: 'error', message: '部屋が見つかりません。ホストから最新の6桁番号を聞いてね。' });
        if (room.map !== map) return send(ws, { type: 'error', message: 'ホストとマップが違います。ロビーで同じマップを選んでね。' });
        if (room.players.size >= 2) return send(ws, { type: 'room-full', message: 'この部屋は満員です（最大2人）。' });
      }
      if (room.players.size >= 2) return send(ws, { type: 'room-full', message: 'この部屋は満員です（最大2人）。' });
      const id = String(nextId++);
      const role = room.players.size === 0 ? 'host' : 'guest';
      ws.player = { id, room: code, map, role, ws };
      room.players.set(id, ws.player);
      send(ws, { type: 'joined', id, role, room: code, map: room.map });
      roomState(room);
      broadcast(room, { type: 'peer-joined', id, role }, ws);
      console.log(`player ${id} joined room ${code} as ${role}; map=${map}; count=${room.players.size}`);
      return;
    }

    const player = ws.player;
    if (!player) return send(ws, { type: 'error', message: '先に部屋を作るか、部屋番号で参加してね。' });
    const room = rooms.get(player.room);
    if (!room) { removePlayer(ws, 'room-missing'); return send(ws, { type: 'error', message: '部屋が閉じられました。もう一度部屋を作ってね。' }); }

    if (msg.type === 'state') {
      const x = Number(msg.x), z = Number(msg.z), yaw = Number(msg.yaw), hp = Number(msg.hp);
      if (![x, z, yaw, hp].every(Number.isFinite)) return;
      if (Math.abs(x) > 500 || Math.abs(z) > 500 || Math.abs(yaw) > 1000) return;
      broadcast(room, { type: 'state', id: player.id, x, z, yaw, hp: Math.max(0, Math.min(100, hp)) }, ws);
    } else if (msg.type === 'shot') {
      const yaw = Number(msg.yaw);
      if (!Number.isFinite(yaw) || Math.abs(yaw) > 1000) return;
      broadcast(room, { type: 'shot', id: player.id, yaw }, ws);
    } else if (msg.type === 'leave') {
      removePlayer(ws, 'leave-message');
      send(ws, { type: 'left' });
    }
  });
  ws.on('close', () => removePlayer(ws, 'socket-close'));
  ws.on('error', err => { console.error('websocket error:', err.message); removePlayer(ws, 'socket-error'); });
});

// Detect dead connections so stale room slots do not remain occupied.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { removePlayer(ws, 'heartbeat-timeout'); ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { removePlayer(ws, 'ping-failed'); ws.terminate(); }
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));
server.on('error', err => { console.error('HTTP server error:', err); });
const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => console.log(`ASHLINE server listening on 0.0.0.0:${port}`));
process.on('SIGTERM', () => { console.log('SIGTERM received; shutting down'); clearInterval(heartbeat); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); });
