// freematch.js v2 — フリーマッチ＋ルームマッチ(最大12人)＋3つのゲームモード（Node.js + ws）
// 既存の server.js の、wss を作った直後に2行追加:  const { setupFreeMatch } = require('./freematch');  setupFreeMatch(wss);
const FM = { MAX: 6, MIN: 2, ROOM_MAX: 12, ROOM_GRACE_MS: 90000, PROTO: 5, MIN_CLIENT_PROTO: 5, VERSION: 'r7', HEARTBEAT_MS: 25000, GHOST_MS: 45000,   // PROTO/VERSION：クライアントとの対応確認用／HEARTBEAT：無料ホスティングの無通信切断を防ぐ
    // ルーム上限12人／試合後に空になった部屋を残す時間（再戦用）
  WAIT_MS: 60000, RESPAWN_MS: 3000, PREP_MS: 10000, PROTECT_MS: 2500,   // 準備フェーズ＝前半5秒：ゲームモード確認／後半5秒：名前確認＋遅延補正＋カウントダウン
   GO_DELAY: 800,
  MAPS: ['arena'],   // 対人戦専用マップの一覧（新しいPvPマップを作ったらここに追加）
  LIMIT_MS: { tri: 600000, raid: 360000, core: 600000 }, LIVES: { tri: 3, core: 1 }, TEAM_LIVES: 10 };
const MODES = ['tri', 'raid', 'core'];
const matches = new Map();
let ONLINE = () => 0;
const rid = () => Math.random().toString(36).slice(2, 8);
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = (m, o, except) => { for (const p of m.players) if (p.ws !== except) send(p.ws, o); };
const pub = p => ({ id: p.id, name: p.name, team: p.team });
const pickMap = () => FM.MAPS[Math.floor(Math.random() * FM.MAPS.length)];

function newMatch(kind, mode) {
  const m = { id: 'M' + rid(), kind, mode, map: kind === 'room' ? 'random' : pickMap(), status: 'waiting', players: [], hostId: null,
    deadline: null, timer: null, limitTimer: null, closeTimer: null, hostToken: null, label: (kind === 'room' ? 'R' : 'F') + rid().slice(0, 3).toUpperCase(), teamLives: { A: 0, B: 0 }, holder: null, over: false, code: null };
  matches.set(m.id, m); return m;
}
function snapshot(m) {
  const base = { matchId: m.id, label: m.label, mode: m.mode, map: m.map, count: m.players.length, players: m.players.map(pub) };
  if (m.kind === 'room') return { type: 'rm-state', ...base, code: m.code, hostId: m.hostId, max: FM.ROOM_MAX, min: FM.MIN };
  return { type: 'fm-state', ...base, hostId: m.hostId, online: ONLINE(), max: FM.MAX, min: FM.MIN, remainingMs: m.deadline ? Math.max(0, m.deadline - Date.now()) : null };
}
// チーム分け：シャッフル後に分割。奇数人数のときは多いほうのチームもランダム（5人→2対3 / 3対2）
function assignTeams(players) {
  const a = players.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  const n = a.length, small = Math.floor(n / 2), sizeA = n % 2 === 0 ? n / 2 : (Math.random() < 0.5 ? small : n - small);
  a.forEach((p, i) => { p.team = i < sizeA ? 'A' : 'B'; });
}
function status(m) {
  bcast(m, { type: 'fm-status', mode: m.mode, teamLives: m.teamLives, holder: m.holder,
    players: m.players.map(p => ({ id: p.id, lives: p.lives, out: p.out, k: p.kills || 0, d: p.deaths || 0 })),
    remainingMs: m.limitAt ? Math.max(0, m.limitAt - Date.now()) : null });
}
function startMatch(m, reason) {
  clearTimeout(m.timer); m.status = 'playing';
  if (m.kind === 'free') {                                   // フリーマッチ：普通にマッチ。ゲームモードは開始時にランダムで決まる
    m.mode = MODES[Math.floor(Math.random() * MODES.length)];
    assignTeams(m.players);
  }
  if (m.map === 'random') m.map = pickMap();                  // ルームの「ランダム」を実際のマップに確定
  if (m.mode === 'raid') m.teamLives = { A: FM.TEAM_LIVES, B: FM.TEAM_LIVES };
  for (const p of m.players) { p.lives = FM.LIVES[m.mode] || 0; p.dead = false; p.out = false; p.kills = 0; p.deaths = 0; p.protectUntil = 0; }
  const list = m.players.map(pub);
  m.status = 'preparing'; m.startAt = Date.now() + FM.PREP_MS;                 // 5秒：名前確認＋遅延計測。全員が startAt に合わせて同時スタート
  for (const p of m.players) send(p.ws, { type: 'fm-start', matchId: m.id, mode: m.mode, map: m.map, reason, you: { id: p.id, team: p.team }, players: list, startAt: m.startAt, serverNow: Date.now(), goDelay: FM.GO_DELAY });
  m.prepTimer = setInterval(() => bcast(m, { type: 'fm-lats', lats: Object.fromEntries(m.players.map(p => [p.id, p.ping || 0])) }), 1000);
  setTimeout(() => {
    clearInterval(m.prepTimer); if (m.over || m.status !== 'preparing' || !m.players.length) return;
    m.status = 'playing'; m.players.forEach(p => { p.protectUntil = Date.now() + FM.PROTECT_MS; }); m.limitAt = Date.now() + FM.LIMIT_MS[m.mode]; m.limitTimer = setTimeout(() => timeUp(m), FM.LIMIT_MS[m.mode]);
    status(m); checkWin(m);
  }, FM.PREP_MS + FM.GO_DELAY);
}
function endMatch(m, winner, reason) {
  if (m.over) return; m.over = true; m.status = 'ended'; clearTimeout(m.timer); clearTimeout(m.limitTimer); clearInterval(m.prepTimer);
  bcast(m, { type: 'fm-end', winner, reason, mode: m.mode, stats: m.players.map(p => ({ id: p.id, name: p.name, team: p.team, k: p.kills || 0, d: p.deaths || 0 })) });
  if (m.kind !== 'room') setTimeout(() => matches.delete(m.id), 10000);     // ルームは試合後も残す（全員が抜けて一定時間たつと閉じる）
}
function resetRoom(m) {                                                        // 試合後の部屋を待機状態に戻す
  clearTimeout(m.timer); clearTimeout(m.limitTimer); clearInterval(m.prepTimer); clearTimeout(m.closeTimer);
  Object.assign(m, { status: 'waiting', over: false, holder: null, teamLives: { A: 0, B: 0 }, hostId: null, deadline: null, limitAt: null });
  m.players.forEach(p => { p.team = ''; });
}
function timeUp(m) {                                   // タイムアップ：データ保持チーム→残機/生存数の多いチーム→引き分け
  if (m.over) return;
  if (m.mode === 'raid' && m.holder) return endMatch(m, m.holder.team, 'timeup-data');
  const score = t => m.mode === 'raid' ? m.teamLives[t] : m.players.filter(p => p.team === t && !p.out).length;
  const a = score('A'), b = score('B');
  endMatch(m, a === b ? 'DRAW' : (a > b ? 'A' : 'B'), 'timeup');
}
function checkWin(m) {
  if (m.over || m.status !== 'playing') return;
  const down = t => m.players.filter(p => p.team === t).every(p => p.out);
  const dA = down('A'), dB = down('B');
  if (dA && dB) endMatch(m, 'DRAW', 'elimination'); else if (dA) endMatch(m, 'B', 'elimination'); else if (dB) endMatch(m, 'A', 'elimination');
}
function onDead(m, p, killerId, head) {
  if (m.over || p.dead || p.out) return; p.dead = true; p.deaths = (p.deaths || 0) + 1;
  const kl = m.players.find(x => x.id === killerId && x.team !== p.team); if (kl) kl.kills = (kl.kills || 0) + 1;          // スコア集計
  bcast(m, { type: 'fm-feed', killer: kl ? kl.name : null, killerTeam: kl ? kl.team : null, victim: p.name, victimTeam: p.team, head: !!head });   // キルログ
  if (m.holder && m.holder.id === p.id) { m.holder = null; bcast(m, { type: 'fm-data', holder: null }); }   // データを持ったまま倒れたら自陣に戻る
  if (m.mode === 'tri') { p.lives--; if (p.lives <= 0) p.out = true; }
  else if (m.mode === 'core') p.out = true;                                                              // 一死終戦
  else { if (m.teamLives[p.team] > 0) m.teamLives[p.team]--; else p.out = true; }                       // チーム共有残機：残っていれば1減らして復活、0なら復活不可
  if (p.out) send(p.ws, { type: 'fm-out' });
  else setTimeout(() => { if (!m.over && m.players.includes(p)) { p.dead = false; p.protectUntil = Date.now() + FM.PROTECT_MS; send(p.ws, { type: 'fm-respawn', protectMs: FM.PROTECT_MS }); status(m); } }, FM.RESPAWN_MS);
  status(m); checkWin(m);
}
function schedule(m) {                                  // フリーマッチ：6人で即開始／2人以上で60秒後に開始
  if (m.status !== 'waiting' || m.kind !== 'free') return;
  if (m.players.length >= FM.MAX) return startMatch(m, 'full');
  if (m.players.length >= FM.MIN && !m.deadline) {
    m.deadline = Date.now() + FM.WAIT_MS;
    m.timer = setTimeout(() => { if (m.status === 'waiting' && m.players.length >= FM.MIN) startMatch(m, 'timeout'); }, FM.WAIT_MS);
  }
  if (m.players.length < FM.MIN && m.deadline) { clearTimeout(m.timer); m.deadline = null; }
  bcast(m, snapshot(m));
}
function addPlayer(m, ws, name) { const p = { id: rid(), name: String(name || 'PLAYER').slice(0, 12), ws, team: '', lastSeen: Date.now() }; m.players.push(p); ws.fm = { match: m, p }; return p; }
function leave(ws) {
  const f = ws.fm; if (!f) return; ws.fm = null; const m = f.match;
  m.players = m.players.filter(p => p !== f.p);
  if (m.status === 'playing') { bcast(m, { type: 'peer-left', id: f.p.id }); if (m.holder && m.holder.id === f.p.id) { m.holder = null; bcast(m, { type: 'fm-data', holder: null }); } checkWin(m); }
  if (!m.players.length) {
    clearTimeout(m.timer); clearTimeout(m.limitTimer); clearInterval(m.prepTimer);
    if (m.kind === 'room' && m.status === 'ended') { m.hostId = null; m.closeTimer = setTimeout(() => matches.delete(m.id), FM.ROOM_GRACE_MS); }   // 試合後の部屋は一定時間残す（再戦用）
    else matches.delete(m.id);                                                                                                                    // 待機中・試合中に全員いなくなったらルーム終了
    return;
  }
  if (m.kind === 'room') {                                                      // ホストが抜けたら、残った先頭の人に引き継ぐ（試合中でも）
    if (m.hostId === f.p.id) { const nh = m.players[0]; m.hostId = nh.id; bcast(m, { type: 'rm-notice', text: nh.name + ' が新しいホストになりました' }); }
    if (m.status === 'waiting') { roomTeams(m); bcast(m, snapshot(m)); }
  } else { if (m.hostId === f.p.id) m.hostId = m.players[0].id; schedule(m); }
}
function roomTeams(m) { if (m.players.length === 4) { if (!m.players.every(p => p.team)) assignTeams(m.players); } else m.players.forEach(p => { p.team = ''; }); }

// 待機中の幽霊（切断に気づけなかった接続）を取り除く
function sweepGhosts() {
  const now = Date.now();
  for (const m of [...matches.values()]) {
    if (m.status !== 'waiting') continue;
    for (const p of m.players.slice()) if (now - (p.lastSeen || now) > FM.GHOST_MS) { try { if (p.ws.terminate) p.ws.terminate(); } catch (e) { /* 無視 */ } leave(p.ws); }
  }
}
// 待機中のフリーマッチ部屋が2つ以上に分かれていたら、1つに統合する（「同じ部屋にマッチしない」の保険）
function mergeWaiting() {
  const rooms = [...matches.values()].filter(x => x.kind === 'free' && x.status === 'waiting' && x.players.length > 0).sort((a, b) => b.players.length - a.players.length);
  if (rooms.length < 2) return;
  const target = rooms[0];
  for (const src of rooms.slice(1)) {
    if (target.players.length + src.players.length > FM.MAX) continue;
    for (const p of src.players.slice()) { target.players.push(p); if (p.ws.fm) p.ws.fm.match = target; send(p.ws, { type: 'fm-merged', label: target.label }); }
    src.players = []; clearTimeout(src.timer); matches.delete(src.id);
  }
  schedule(target);
}
function setupFreeMatch(wss) {
  ONLINE = () => wss.clients.size;
  setInterval(() => { sweepGhosts(); mergeWaiting(); for (const m of matches.values()) if (m.status === 'waiting') bcast(m, snapshot(m)); }, 5000).unref();   // 待機中の部屋に定期送信（人数更新＋無通信切断の防止）
  setInterval(() => {                                                              // 死んだ接続の掃除（ping/pong）。待機中でも切断されにくくする
    for (const ws of wss.clients) { if (ws.isAlive === false) { try { ws.terminate(); } catch (e) { /* 既に閉じている */ } continue; } ws.isAlive = false; try { if (ws.ping) ws.ping(); } catch (e) { /* 無視 */ } }
  }, FM.HEARTBEAT_MS).unref();
  wss.on('connection', ws => {
    ws.isAlive = true; if (ws.on) ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', raw => {
      ws.isAlive = true; if (ws.fm && ws.fm.p) ws.fm.p.lastSeen = Date.now();
      let d; try { d = JSON.parse(raw); } catch { return; }
      if (!d || typeof d.type !== 'string' || !(d.type.startsWith('fm-') || d.type.startsWith('rm-'))) return;
      const t = d.type;
      if (t === 'fm-hello') {                                                         // 接続確認：このサーバーが新しい対戦システムに対応しているか
        const all = [...matches.values()];
        const waiting = all.filter(x => x.kind === 'free' && x.status === 'waiting').map(x => ({ label: x.label, count: x.players.length }));
        return send(ws, { type: 'fm-hello', proto: FM.PROTO, version: FM.VERSION, compatible: !(Number(d.proto) < FM.MIN_CLIENT_PROTO), waiting, online: ONLINE(), free: all.filter(x => x.kind === 'free' && x.status === 'waiting').length, rooms: all.filter(x => x.kind === 'room').length, maxFree: FM.MAX, maxRoom: FM.ROOM_MAX });
      }
      if (t === 'fm-join') {                                                          // フリーマッチ参加（同じモード同士でマッチング）
        leave(ws); const mode = MODES.includes(d.mode) ? d.mode : 'tri';
        let m = [...matches.values()].find(x => x.kind === 'free' && x.status === 'waiting' && x.players.length < FM.MAX), created = false;   // 世界中の空き部屋を探す
        if (!m) { m = newMatch('free', mode); created = true; }                                                                                  // 無ければ自分で部屋を作成   // モードに関係なく同じ待機列に入る（人数が少なくても集まる）
        const p = addPlayer(m, ws, d.name); p.pick = mode; if (!m.hostId) m.hostId = p.id; send(ws, { type: 'fm-joined', id: p.id, matchId: m.id, label: m.label, created }); return schedule(m);
      }
      if (t === 'rm-create') {                                                        // ルーム作成（作った人がホスト）
        leave(ws); const m = newMatch('room', 'tri'); do { m.code = String(Math.floor(100000 + Math.random() * 900000)); } while ([...matches.values()].some(x => x.code === m.code && x !== m));
        m.hostToken = d.token ? String(d.token).slice(0, 40) : null;
        const p = addPlayer(m, ws, d.name); p.token = m.hostToken; m.hostId = p.id; send(ws, { type: 'rm-joined', id: p.id, code: m.code, host: true }); return bcast(m, snapshot(m));
      }
      if (t === 'rm-join') {                                                          // ルーム参加：人数はサーバーが管理し、満員・開始済みは明確なエラーを返す
        const err = (code, message) => send(ws, { type: 'rm-error', code, message });
        const m = [...matches.values()].find(x => x.kind === 'room' && x.code === String(d.code));
        if (!m) return err('notfound', '部屋が見つかりません。6桁のコードを確認してね');
        if (m.status === 'ended' && m.players.length === 0) resetRoom(m);           // 試合後に全員抜けた部屋は、待機状態に戻る
        if (m.status !== 'waiting') return err('started', m.status === 'ended' ? 'まだ前の試合の結果表示中です。少し待ってからもう一度入ってね' : 'この部屋はすでに試合中です');
        if (!m.players.some(p => p.ws === ws) && m.players.length >= FM.ROOM_MAX) return err('full', `満員です（${m.players.length}/${FM.ROOM_MAX}人）。別の部屋を作るか、空きが出るまで待ってね`);
        leave(ws); clearTimeout(m.closeTimer);
        const p = addPlayer(m, ws, d.name); p.token = d.token ? String(d.token).slice(0, 40) : null;
        if (!m.hostId) m.hostId = p.id;
        else if (m.hostToken && p.token === m.hostToken && m.hostId !== p.id) { m.hostId = p.id; bcast(m, { type: 'rm-notice', text: p.name + ' （部屋の作成者）がホストに戻りました' }); }   // 作成者が戻ったらホストを返す
        roomTeams(m); send(ws, { type: 'rm-joined', id: p.id, code: m.code, host: m.hostId === p.id }); return bcast(m, snapshot(m));
      }
      if (t === 'fm-ping') return send(ws, { type: 'fm-pong', t: d.t, st: Date.now() });                   // 時計合わせ用
      const f = ws.fm; if (!f) return; const m = f.match, me = f.p;
      if (t === 'fm-leave') return leave(ws);
      if (t === 'fm-lat') { me.ping = Math.max(0, Math.round(+d.ms) || 0); return; }
      if (t === 'fm-begin' && m.kind === 'free' && m.status === 'waiting' && m.hostId === me.id) { if (m.players.length < FM.MIN) return send(ws, { type: 'rm-error', message: '最低2人必要です' }); return startMatch(m, 'host'); }
      if (m.kind === 'room' && m.status === 'waiting' && m.hostId === me.id) {      // ホスト操作
        if (t === 'rm-set') { if (MODES.includes(d.mode)) m.mode = d.mode; if (d.map === 'random' || FM.MAPS.includes(d.map)) m.map = d.map; return bcast(m, snapshot(m)); }
        if (t === 'rm-team' && m.players.length === 4) { const x = m.players.find(p => p.id === d.target); if (x && (d.team === 'A' || d.team === 'B')) { x.team = d.team; bcast(m, snapshot(m)); } return; }
        if (t === 'rm-kick') { const x = m.players.find(p => p.id === d.target); if (x && x !== me) { send(x.ws, { type: 'rm-kicked' }); leave(x.ws); } return; }   // ホストによる追放
        if (t === 'rm-start') {
          if (m.players.length < FM.MIN) return send(ws, { type: 'rm-error', message: '最低2人必要です' });
          const ok = m.players.length === 4 && m.players.some(p => p.team === 'A') && m.players.some(p => p.team === 'B');
          if (!ok) assignTeams(m.players);                                              // 4人以外はランダム／4人はホスト設定を使用
          return startMatch(m, 'host');
        }
      }
      if (m.status !== 'playing' || m.over) return;
      if (t === 'fm-state') bcast(m, { type: 'state', id: me.id, x: +d.x || 0, z: +d.z || 0, yaw: +d.yaw || 0, hp: +d.hp, c: d.c ? 1 : 0, map: m.map }, ws);
      else if (t === 'fm-shot') bcast(m, { type: 'shot', id: me.id, yaw: +d.yaw || 0 }, ws);
      else if (t === 'fm-hit') { const v = m.players.find(p => p.id === d.target); if (v && v.team !== me.team && !me.dead && !v.dead && v.protectUntil > Date.now()) send(ws, { type: 'fm-blocked' });      // スポーン保護中
      else if (v && v.team !== me.team && !me.dead && !v.dead) send(v.ws, { type: 'hit', from: me.id, dmg: Math.min(100, Math.max(0, +d.dmg || 0)), head: !!d.head }); }
      else if (t === 'fm-dead') {                                       // 倒した相手にキルを通知（キルカメラ用）
        if (!me.dead) { const k = m.players.find(p => p.id === d.killer); if (k && k.team !== me.team) send(k.ws, { type: 'fm-kill', victim: me.id }); }
        onDead(m, me, d.killer, d.head);
      }
      else if (m.mode === 'raid' && !me.dead) {
        if (t === 'fm-take' && !m.holder) { m.holder = { id: me.id, team: me.team }; bcast(m, { type: 'fm-data', holder: m.holder }); status(m); }
        else if (t === 'fm-deliver' && m.holder && m.holder.id === me.id) endMatch(m, me.team, 'data');
      }
    });
    ws.on('close', () => leave(ws));
  });
}
module.exports = { setupFreeMatch, FM, _test: { matches, newMatch, addPlayer, mergeWaiting, sweepGhosts } };
