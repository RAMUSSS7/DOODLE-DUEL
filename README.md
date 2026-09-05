# Doodle Duel — Online Multiplayer Draw & Guess

A real-time multiplayer party game: one player draws, everyone else races to
guess the word in the chat. Built with **Node.js + Express + Socket.io** on
the server, **PostgreSQL** for accounts/friends, and plain **HTML/CSS/JS
(Canvas)** on the client — no build step, no frontend framework needed.

## What's inside
```
doodle-duel/
├── server.js         # game server + accounts/friends REST & socket API
├── db.js             # PostgreSQL connection + schema setup
├── package.json
├── index.html        # all screens (home, lobby, game, friends, results…)
├── style.css         # chalkboard / paper visual theme
├── client.js         # socket handling, canvas drawing, accounts UI
├── manifest.json      # PWA manifest
├── service-worker.js  # PWA offline app-shell caching
└── icons/              # PWA icons
```
All files live at the root of the project (no `public/` subfolder) — keep it
that way both locally and in your GitHub repo, or the server won't find them.

## Features

### Core game
- Rooms with a 5-letter code, 2–8 players
- Pre-room settings screen: host picks word pack, difficulty, speed round, and
  team mode **before** the room is even created
- Word packs: **English**, **Arabic (العربية)**, or a **custom list**
- Word difficulty (easy / medium / hard / mixed) affects scoring
- No word repeats within the same game
- Progressive letter hints as the timer runs down
- 🥇 Fastest-guesser bonus + 🔥 guess streak bonus (both shown live)
- Drawing tools: pen, line, rectangle, circle, fill bucket, undo
- Emoji reactions guessers can throw while someone draws
- Team Mode (2 teams) and an optional bonus Speed Round (2x points)
- Public/private rooms with a "browse public rooms" list
- Typing indicator, dark/light theme, sound & animation toggles
- Automatic reconnect: if a player's connection drops, they keep their seat,
  score, and streak for 2 minutes and resume exactly where the game left off
- A slide-out menu with Settings, My Stats (level/XP + achievements), My
  Doodles, How to Play, and About
- Confetti + a little win jingle on the final results screen
- **Solo Play** (no room needed): Draw Practice — pick a word pack and
  difficulty, sketch freely, no timer pressure, no one guessing. Reveal the
  word, download your doodle, or save it to **My Doodles**
- Installable as a **PWA** — "Add to Home Screen" on phones
- One-tap **Share invite link** from the lobby
- Optional **brush sound** while drawing (off by default)

### Accounts & Friends (needs a database — see setup below)
- Sign up / log in with a username + password
- Every account gets a permanent, unique **friend code** to share
- Send/accept/decline friend requests by friend code
- Friends list with live online/offline status
- **Direct messages** between friends, independent of any game room
- **Invite a friend straight to a room** — no need to copy/paste a link;
  they get an in-app notification with a one-tap Join button. Works from
  the lobby (invites into the room you're already in) or from a DM/Friends
  screen (spins up a fresh room and joins you into it automatically)
- **Recently Played With** — after finishing a game with someone who isn't
  yet a friend, they show up here with a one-tap "Add Friend" button
- **My Profile** — upload a profile photo, write a short bio, and see your
  games played / wins / best score (tracked automatically after every
  multiplayer game you finish while logged in)

### Safety
- Basic **profanity filter** applied to game chat and direct messages
- **Block/Unblock** another account — removes any friendship, and blocked
  users can't send you friend requests or DMs
- **Report a player** during a game (with an optional note) — reports are
  logged to the database for later review
- **Mute** a player's chat locally during a game (client-side only, no
  account needed)

## Run it locally

You need a PostgreSQL database for the accounts/friends features (the core
game itself works fine without one — those features simply won't respond
if the database can't connect).

```bash
npm install

# Point the server at a Postgres database:
export DATABASE_URL="postgres://user:password@host:5432/dbname"

npm start
```

If `DATABASE_URL` isn't set, it falls back to
`postgres://postgres:devpass123@localhost:5432/doodleduel_dev` for local
development with a Postgres server running on your own machine.

Then open **http://localhost:3000** in two different browser tabs (or two
devices on the same network) to test with more than one player.

## Setting up a real (free) database for deployment

Render's own free PostgreSQL is time-limited, so a standalone free Postgres
host is more reliable long-term. Either of these works well and stays free
for a small project like this:

### Option 1 — Neon (neon.tech)
1. Sign up at neon.tech, create a new project.
2. Copy the **connection string** it gives you (starts with `postgres://`).
3. That's your `DATABASE_URL`.

### Option 2 — Supabase (supabase.com)
1. Sign up, create a new project.
2. Go to Project Settings → Database → Connection string (URI format).
3. That's your `DATABASE_URL`.

Either way, the very first time the server starts with a valid
`DATABASE_URL`, it automatically creates all the tables it needs
(`users`, `sessions`, `friend_requests`, `friendships`, `messages`) — no
manual SQL required.

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
of `server.js` (`ROUND_SECONDS`, `ROUNDS_PER_PLAYER`, `WORD_PACKS`).

## Deploying so people can actually play online

This game needs a server that stays running (it's not a static file you can
just drop into CrazyGames on its own).

### Render.com (recommended, easiest)
1. Push this folder to a GitHub repo.
2. On [render.com](https://render.com), click **New → Web Service**, connect
   the repo.
3. Build command: `npm install`. Start command: `node server.js`.
4. In the service's **Environment** tab, add an environment variable:
   `DATABASE_URL` = the connection string from Neon or Supabase (see above).
5. Deploy. You'll get a URL like `https://doodle-duel.onrender.com`.
6. Note: Render's free tier "sleeps" after inactivity, so the first player
   to open the game after a while will see a ~30-second cold start. Fine for
   testing; consider a paid tier if the game gets real traffic.

## Connecting this to CrazyGames

CrazyGames hosts your **client** (the HTML5 files), but it can't run your
**server** for you — your multiplayer server has to live somewhere like
Render (above). The client just needs to know where to connect:

1. Deploy the server and note its URL, e.g. `https://doodle-duel.onrender.com`.
2. In `client.js`, change the very first line from:
   ```js
   const socket = io();
   ```
   to:
   ```js
   const socket = io('https://doodle-duel.onrender.com');
   ```
3. Zip `index.html`, `style.css`, `client.js`, `manifest.json`,
   `service-worker.js`, and the `icons/` folder together — at the root of
   the zip, not inside a folder — and upload that as your CrazyGames HTML5
   build. `index.html` must be at the root of the zip.
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
- Push notifications for friend requests / invites when the app is closed
  (needs the Web Push API + storing subscription info per user).
- Group chat rooms for a friend group, not just 1-on-1 DMs.
- A "Recently played with" list to quickly re-invite past teammates.
- Profile pictures/avatars (would need file upload + storage, e.g. S3).
