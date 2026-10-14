const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();
app.use(express.static(path.join(__dirname)));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'ASHLINE' }));
function send(ws, obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, except) { for (const p of room.players) if (p !== except) send(p, obj); }
wss.on('connection', ws => {
  ws.data = { room: null, id: Math.random().toString(36).slice(2, 10), role: null };
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'create' || msg.type === 'join') {
      if (ws.data.room) return;
      const code = String(msg.room || '');
      if (!/^\d{6}$/.test(code)) return send(ws, { type: 'error', message: '部屋番号は6桁です' });
      let room = rooms.get(code);
      if (msg.type === 'create') {
        if (room) return send(ws, { type: 'error', message: 'その番号は使用中です。もう一度作成してね' });
        room = { code, map: msg.map === 'industrial' ? 'industrial' : 'shibuya', players: [] };
        rooms.set(code, room);
      } else if (!room) return send(ws, { type: 'error', message: '部屋が見つかりません。ホストに番号を確認してね' });
      if (msg.type === 'join' && msg.map && msg.map !== room.map) return send(ws, { type: 'error', message: 'ホストと同じマップを選択してから参加してね' });
      if (room.players.length >= 2) return send(ws, { type: 'room-full' });
      room.players.push(ws); ws.data.room = room; ws.data.role = room.players.length === 1 ? 'host' : 'guest';
      send(ws, { type: 'joined', id: ws.data.id, role: ws.data.role, room: code, map: room.map });
      if (room.players.length === 2) broadcast(room, { type: 'peer-joined', id: ws.data.id, map: room.map }, ws);
      return;
    }
    const room = ws.data.room; if (!room) return;
    if (msg.type === 'state') {
      const x = Number(msg.x), z = Number(msg.z), yaw = Number(msg.yaw), hp = Number(msg.hp);
      if (![x,z,yaw,hp].every(Number.isFinite)) return;
      broadcast(room, { type: 'state', id: ws.data.id, x: Math.max(-240,Math.min(240,x)), z: Math.max(-240,Math.min(240,z)), yaw, hp: Math.max(0,Math.min(100,hp)) }, ws);
    } else if (msg.type === 'shot') {
      const yaw = Number(msg.yaw); if (Number.isFinite(yaw)) broadcast(room, { type: 'shot', id: ws.data.id, yaw }, ws);
    }
  });
  ws.on('close', () => {
    const room = ws.data.room; if (!room) return;
    room.players = room.players.filter(p => p !== ws);
    broadcast(room, { type: 'peer-left', id: ws.data.id });
    if (!room.players.length) rooms.delete(room.code);
    else { // The remaining player can continue; their room remains joinable.
      room.players[0].data.role = 'host';
    }
  });
});
const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`ASHLINE server listening on ${port}`));
