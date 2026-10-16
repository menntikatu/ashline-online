const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
const rooms = new Map();
let nextId = 1;
app.use(express.static(__dirname));
app.get('/health', (_req, res) => res.json({ ok: true }));
function send(ws, obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, except) { for (const p of room.players.values()) if (p.ws !== except) send(p.ws, obj); }
wss.on('connection', ws => {
  ws.player = null;
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'create' || msg.type === 'join') {
      const code = String(msg.room || '');
      if (!/^\d{6}$/.test(code)) return send(ws, { type: 'error', message: '部屋番号は6桁です' });
      let room = rooms.get(code);
      if (msg.type === 'create') {
        if (room && room.players.size) return send(ws, { type: 'error', message: 'その番号は使用中です。もう一度作成してね' });
        room = { map: String(msg.map || 'shibuya'), players: new Map() };
        rooms.set(code, room);
      } else {
        if (!room) return send(ws, { type: 'error', message: '部屋が見つかりません。番号を確認してね' });
        if (room.map !== String(msg.map || 'shibuya')) return send(ws, { type: 'error', message: 'ホストと同じマップを選んでね' });
        if (room.players.size >= 2) return send(ws, { type: 'room-full' });
      }
      if (room.players.size >= 2) return send(ws, { type: 'room-full' });
      const id = String(nextId++);
      const role = room.players.size === 0 ? 'host' : 'guest';
      ws.player = { id, room: code, ws };
      room.players.set(id, ws.player);
      send(ws, { type: 'joined', id, role, room: code, map: room.map });
      broadcast(room, { type: 'peer-joined', id }, ws);
      return;
    }
    const player = ws.player; if (!player) return;
    const room = rooms.get(player.room); if (!room) return;
    if (msg.type === 'state') {
      const x = Number(msg.x), z = Number(msg.z), yaw = Number(msg.yaw), hp = Number(msg.hp);
      if (![x,z,yaw,hp].every(Number.isFinite)) return;
      broadcast(room, { type:'state', id:player.id, x, z, yaw, hp:Math.max(0,Math.min(100,hp)) }, ws);
    } else if (msg.type === 'shot') {
      const yaw = Number(msg.yaw); if (!Number.isFinite(yaw)) return;
      broadcast(room, { type:'shot', id:player.id, yaw }, ws);
    }
  });
  ws.on('close', () => {
    const player = ws.player; if (!player) return;
    const room = rooms.get(player.room); if (!room) return;
    room.players.delete(player.id);
    broadcast(room, { type:'peer-left', id:player.id });
    if (room.players.size === 0) rooms.delete(player.room);
  });
});
const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`ASHLINE server listening on ${port}`));
