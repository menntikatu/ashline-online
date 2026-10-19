# ASHLINE: BLACK CELL（パッケージ）

ブラウザで遊ぶ3D FPS。AI戦（SOLO OPS）と、オンライン対戦（フリーマッチ／ルームマッチ最大12人）が入っています。

## ファイル
| ファイル | 役割 |
|---|---|
| `index.html` | ゲーム本体（これだけでAI戦は遊べます） |
| `server.js` | 対戦サーバー（Node.js）。`index.html` の配信と、WebSocketの `/ws` を提供 |
| `freematch.js` | 対戦のしくみ（部屋・チーム分け・勝敗・ルーム管理）。`server.js` が読み込みます |
| `package.json` | 依存パッケージ（`ws`）と起動コマンド |

## 動かし方（自分のPC）
```
npm install
npm start
```
ブラウザで `http://localhost:3000/` を開きます。同じネットワークの別端末からは `http://（このPCのIP）:3000/` で開けます。

## インターネットで公開（Render など）
1. このフォルダを GitHub にアップロードします。
2. Render で「New Web Service」→ そのリポジトリを選びます。
3. Build Command: `npm install` ／ Start Command: `npm start`
4. 出来上がった URL（例 `https://xxxx.onrender.com`）を、みんなで開きます。
   - 無料プランは、しばらく使わないと止まり、最初の接続に最大60秒かかります。

### GitHub Pages に `index.html` を置く場合
GitHub Pages は静的ページ専用で、対戦サーバー（WebSocket）は動かせません。
`server.js` は Render などで動かし、ゲームの **SETTINGS → 対戦サーバー** に `https://xxxx.onrender.com` を入れて「保存」→「接続テスト」で `✓ 接続OK` を確認してください。

## 友達と確実に同じ部屋で遊ぶ方法
1. **ONLINE → PRIVATE ROOM → 作成** で、部屋（6桁コード）を作ります。
2. 待機画面の **招待リンク（コピー）** を友達に送ります（コードを直接入力してもOK）。
3. 友達がリンクを開くと、自動で同じ部屋に入ります（サーバーURLも引き継がれます）。
4. ホストが「ゲーム開始」を押します。人数は2〜12人。4人のときだけ、ホストがチームを決められます。

## マッチしないときのチェックリスト
1. **全員が同じ BUILD か**：メニュー下の `BUILD r6` と、待機画面の `BUILD / サーバー` 表示を見比べます。違う端末は `Ctrl+Shift+R`（スマホは再読み込み）で更新します。
2. **同じサーバーにつながっているか**：待機画面の「接続先」と「ROOM ○○○」を見比べます。ROOMが違えば別の部屋です。
3. **SETTINGS → 接続テスト**：`✓ 接続OK` と出るか確認します。「未対応」と出たら、サーバーの `freematch.js` が古いです。
4. **学校・会社のネットワーク**：WebSocket（`wss://`）や、`onrender.com` が制限されていることがあります。スマホのテザリングなどで試して切り分けます。
5. スマホは、画面が消えると接続が切れます。待機中は画面を点けたままにしてください。

## 設定を変えたいとき（`freematch.js` の `FM`）
- `MAX`（フリーマッチの上限＝6）／`ROOM_MAX`（ルームの上限＝12）／`WAIT_MS`（自動開始までの時間＝60秒）
- `PREP_MS`（試合前の準備時間＝10秒）／`RESPAWN_MS`／`PROTECT_MS`（スポーン保護）
