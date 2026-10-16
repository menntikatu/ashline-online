ASHLINE: BLACK CELL — Server + Map Update

Files: index.html, server.js, package.json. Upload all three from this folder to the SAME root folder in your GitHub repository.

Render settings:
- Environment: Node
- Build Command: npm install
- Start Command: npm start
- Health check path (optional): /health

New map: GREYFIELD RUINED VILLAGE. Layout: south spawn compound -> central market square -> west residential lane / east barn lane -> north final objective zone. Includes clear lanes, alternate flanks, solid cover, and supply locations.

Lobby flow: create room -> remain in lobby; share the six-digit code. Friend joins same map. Solo: press the green play button; PvP: once two players are connected, press the blue PvP start button.

Diagnostics: open https://YOUR-RENDER-URL/health. It should return JSON with ok:true. If it does not, check Render Logs. The server code cannot be verified against your live Render service until you deploy these files and test the public URL.

Note: this is a prototype relay server. Player movement and shot visuals are relayed; authoritative hit validation and anti-cheat are not implemented.
