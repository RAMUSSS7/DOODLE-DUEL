# Doodle Duel — Online Multiplayer Draw & Guess

A real-time multiplayer party game: one player draws, everyone else races to
guess the word in the chat. Built with **Node.js + Express + Socket.io** on
the server and plain **HTML/CSS/JS (Canvas)** on the client — no build step,
no framework needed.

## What's inside
```
doodle-duel/
├── server.js         # game server: rooms, rounds, scoring, drawing relay, reconnect
├── package.json
├── index.html        # all screens (home, lobby, game, results)
├── style.css         # chalkboard / paper visual theme
└── client.js         # socket handling + canvas drawing
```
All files live at the root of the project (no `public/` subfolder) — keep it
that way both locally and in your GitHub repo, or the server won't find them.

## Features
- Rooms with a 5-letter code, 2–8 players
- Word packs: **English**, **Arabic (العربية)**, or a **custom list** the
  host types in before starting
- No word repeats within the same game
- Progressive letter hints as the timer runs down
- 🥇 Fastest-guesser bonus + 🔥 guess streak bonus (both shown live)
- Emoji reactions guessers can throw while someone draws
- Automatic reconnect: if a player's connection drops, they keep their seat,
  score, and streak for 2 minutes and resume exactly where the game left off
- Confetti + a little win jingle on the final results screen
- End-game badges: Best Drawer and Fastest Guesser

## Run it locally
```bash
npm install
npm start
```
Then open **http://localhost:3000** in two different browser tabs (or two
devices on the same network) to test with more than one player.

## How the game works
- A host creates a room and gets a 5-letter code to share.
- 2–8 players can join a room.
- Each round, one player is given 3 word choices and draws the one they pick
  while everyone else types guesses in the chat.
- Points are awarded based on how fast you guess; the drawer also earns
  points for every correct guess.
- Letters of the word are progressively revealed as hints if nobody's
  guessing.
- After everyone has had a turn drawing (2 rounds per player by default),
  final scores are shown and the host can start a new game.

You can tune the round length, rounds per player, and word list at the top
of `server.js` (`ROUND_SECONDS`, `ROUNDS_PER_PLAYER`, `WORDS`).

## Deploying so people can actually play online

This game needs a server that stays running (it's not a static file you can
just drop into CrazyGames on its own). The easiest free options:

### Option A — Render.com (recommended, easiest)
1. Push this folder to a GitHub repo.
2. On [render.com](https://render.com), click **New → Web Service**, connect
   the repo.
3. Build command: `npm install`. Start command: `node server.js`.
4. Deploy. You'll get a URL like `https://doodle-duel.onrender.com`.
5. Note: Render's free tier "sleeps" after inactivity, so the first player
   to open the game after a while will see a ~30-second cold start. Fine for
   testing; consider a paid tier if the game gets real traffic.

### Option B — Railway.app or Glitch.com
Same idea — both can run a Node + Socket.io server directly from a repo or
zip upload, and Glitch in particular is very quick for this kind of
real-time app if you want zero config.

## Connecting this to CrazyGames

CrazyGames hosts your **client** (the HTML5 files), but it can't run your
**server** for you — your multiplayer server has to live somewhere like
Render (Option A above). The client just needs to know where to connect:

1. Deploy `server.js` (Option A/B) and note your server's URL, e.g.
   `https://doodle-duel.onrender.com`.
2. In `client.js`, change the very first line from:
   ```js
   const socket = io();
   ```
   to:
   ```js
   const socket = io('https://doodle-duel.onrender.com');
   ```
3. Zip `index.html`, `style.css`, and `client.js` together — at the root of
   the zip, not inside a folder — and upload that zip as your CrazyGames
   HTML5 build. `index.html` must be at the root of the zip.
4. In `server.js`, tighten the CORS setting before going live so random
   sites can't connect to your server:
   ```js
   const io = new Server(server, {
     cors: { origin: ["https://www.crazygames.com"], methods: ["GET", "POST"] }
   });
   ```

That's it — CrazyGames serves the page, and the page talks to your Render
server over WebSockets for all the real-time gameplay.

## Ideas for extending it
- Add more/localized word lists (e.g. an Arabic word pack).
- Private rooms with a max player limit shown in the lobby.
- A "custom words" mode where the host pastes their own word list.
- Emoji reactions players can throw while someone's drawing.
