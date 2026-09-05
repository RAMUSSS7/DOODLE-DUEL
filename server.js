const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool, initSchema } = require('./db');

const app = express();
const server = http.createServer(app);
app.use(express.json());

// NOTE: origin is wide open here for easy testing/deployment.
// Before shipping publicly, restrict this to your CrazyGames game URL.
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(__dirname));
app.get('/api/words', (req, res) => {
  res.json(WORD_PACKS);
});

// ---------------- Accounts / Friends REST API ----------------
const FRIEND_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
function makeFriendCode() {
  return Array.from({ length: 6 }, () => FRIEND_CODE_CHARS[Math.floor(Math.random() * FRIEND_CODE_CHARS.length)]).join('');
}
async function uniqueFriendCode() {
  for (let i = 0; i < 20; i++) {
    const code = makeFriendCode();
    const { rows } = await pool.query('SELECT 1 FROM users WHERE friend_code = $1', [code]);
    if (!rows.length) return code;
  }
  throw new Error('Could not generate a unique friend code');
}
function makeSessionToken() {
  return crypto.randomBytes(24).toString('hex');
}
function validUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_]{3,16}$/.test(u);
}

app.post('/api/signup', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!validUsername(username)) return res.status(400).json({ error: 'Username must be 3-16 letters, numbers, or underscores.' });
    if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const existing = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (existing.rows.length) return res.status(409).json({ error: 'That username is already taken.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const friendCode = await uniqueFriendCode();
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, friend_code) VALUES ($1, $2, $3) RETURNING id, username, friend_code',
      [username, passwordHash, friendCode]
    );
    const user = result.rows[0];
    const token = makeSessionToken();
    await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);
    res.json({ token, userId: user.id, username: user.username, friendCode: user.friend_code });
  } catch (err) {
    console.error('signup error', err);
    res.status(500).json({ error: 'Something went wrong creating your account.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
    const result = await pool.query('SELECT id, username, password_hash, friend_code FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Incorrect username or password.' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect username or password.' });
    const token = makeSessionToken();
    await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);
    res.json({ token, userId: user.id, username: user.username, friendCode: user.friend_code });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Something went wrong logging you in.' });
  }
});

async function getUserByToken(token) {
  if (!token) return null;
  const result = await pool.query(
    `SELECT u.id, u.username, u.friend_code FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

app.get('/api/me', async (req, res) => {
  const token = req.query.token;
  const user = await getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Not logged in.' });
  res.json({ userId: user.id, username: user.username, friendCode: user.friend_code });
});

app.post('/api/logout', async (req, res) => {
  const { token } = req.body || {};
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
const ROUND_SECONDS = 80;
const SPEED_ROUND_SECONDS = 30;
const ROUNDS_PER_PLAYER = 2;
const MAX_PLAYERS = 8;
const CHOOSE_SECONDS = 10;
const HINT_FRACTIONS = [0.6, 0.35, 0.15];
const FASTEST_BONUS = 25;
const STREAK_BONUS_PER = 5;
const STREAK_BONUS_CAP = 25;
const RECONNECT_GRACE_MS = 120000;
const DIFFICULTY_MULT = { easy: 1, medium: 1.25, hard: 1.5 };

function w(word, difficulty) { return { word, difficulty }; }

// Basic profanity filter for public chat/DMs. Not exhaustive — extend this
// list as needed. Matches whole words only, case-insensitive.
const BAD_WORDS = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'piss',
  'slut', 'whore', 'faggot', 'nigger', 'retard'
];
const BAD_WORDS_RE = BAD_WORDS.map(word => new RegExp(`\\b${word}\\w*`, 'gi'));
function censorText(text) {
  let out = String(text || '');
  BAD_WORDS_RE.forEach(re => { out = out.replace(re, m => '*'.repeat(m.length)); });
  return out;
}

const WORD_PACKS = {
  english: [
    w('cat','easy'), w('sun','easy'), w('dog','easy'), w('star','easy'), w('fish','easy'),
    w('ball','easy'), w('tree','easy'), w('moon','easy'), w('book','easy'), w('house','easy'),
    w('guitar','medium'), w('elephant','medium'), w('pizza','easy'), w('rainbow','medium'), w('robot','medium'),
    w('castle','medium'), w('dragon','medium'), w('umbrella','medium'), w('bicycle','medium'), w('volcano','medium'),
    w('penguin','medium'), w('sandwich','medium'), w('rocket','medium'), w('ghost','easy'), w('octopus','medium'),
    w('waterfall','hard'), w('cactus','medium'), w('lighthouse','hard'), w('skateboard','hard'), w('dinosaur','medium'),
    w('butterfly','medium'), w('snowman','easy'), w('pirate','medium'), w('telescope','hard'), w('mushroom','medium'),
    w('kangaroo','medium'), w('campfire','medium'), w('helicopter','hard'), w('jellyfish','hard'), w('pumpkin','easy'),
    w('wizard','medium'), w('tornado','medium'), w('sunglasses','medium'), w('backpack','medium'), w('fountain','medium'),
    w('saxophone','hard'), w('pretzel','hard'), w('cupcake','easy'), w('anchor','medium'), w('compass','medium'),
    w('igloo','medium'), w('mermaid','medium'), w('tractor','medium'), w('windmill','medium'), w('beehive','hard'),
    w('scarecrow','hard'), w('submarine','hard'), w('waffle','easy'), w('flamingo','medium'), w('koala','easy'),
    w('astronaut','hard'), w('lantern','medium'), w('peacock','medium'), w('avalanche','hard'), w('bonfire','medium'),
    w('canoe','medium'), w('drum','easy'), w('earthquake','hard'), w('feather','medium'), w('glacier','hard'),
    w('hammock','medium'), w('iceberg','hard'), w('jukebox','hard'), w('kite','easy'), w('lava','easy'),
    w('moose','medium'), w('nest','easy'), w('oasis','hard'), w('pancake','easy'), w('quicksand','hard'),
    w('raccoon','medium'), w('saddle','medium'), w('treehouse','medium'), w('unicorn','medium'), w('vampire','medium'),
    w('walrus','hard'), w('xylophone','hard'), w('yeti','medium'), w('zeppelin','hard'), w('chess','medium'),
    w('fireworks','medium'), w('harmonica','hard'), w('jigsaw','medium'), w('labyrinth','hard'), w('mosaic','hard'),
    w('narwhal','hard'), w('origami','hard'), w('pyramid','medium'), w('satellite','hard'), w('trampoline','medium'),
    w('wheelbarrow','hard'), w('snorkel','medium'), w('periscope','hard'), w('popcorn','easy'), w('marshmallow','medium')
  ],
  arabic: [
    w('قطة','easy'), w('كلب','easy'), w('شمس','easy'), w('قمر','easy'), w('بيت','easy'),
    w('سيارة','easy'), w('تفاحة','easy'), w('موزة','easy'), w('كرة','easy'), w('شجرة','easy'),
    w('جبل','medium'), w('بحر','easy'), w('سمكة','easy'), w('طائرة','medium'), w('قطار','medium'),
    w('دراجة','medium'), w('مفتاح','medium'), w('ساعة','easy'), w('كتاب','easy'), w('قلم','easy'),
    w('كرسي','easy'), w('طاولة','medium'), w('باب','easy'), w('نافذة','medium'), w('ثلج','easy'),
    w('نار','easy'), w('ماء','easy'), w('ورقة','easy'), w('حذاء','easy'), w('قبعة','medium'),
    w('نظارة','medium'), w('هاتف','medium'), w('حاسوب','hard'), w('تلفاز','medium'), w('كاميرا','medium'),
    w('ثعبان','medium'), w('أسد','easy'), w('نمر','easy'), w('فيل','easy'), w('زرافة','medium'),
    w('قرد','easy'), w('دجاجة','medium'), w('بقرة','medium'), w('خروف','medium'), w('حصان','medium'),
    w('أرنب','medium'), w('سلحفاة','hard'), w('فراشة','hard'), w('نحلة','medium'), w('عنكبوت','hard'),
    w('تمساح','hard'), w('بطة','easy'), w('بومة','medium'), w('نجمة','easy'), w('سحابة','medium'),
    w('مطر','easy'), w('برق','medium'), w('رعد','medium'), w('جزيرة','hard'), w('قلعة','medium'),
    w('برج','medium'), w('جسر','medium'), w('مصباح','medium'), w('مرآة','medium'), w('سرير','easy'),
    w('وسادة','medium'), w('حقيبة','medium'), w('دمية','medium'), w('بالون','medium'), w('كيك','easy'),
    w('بيتزا','easy'), w('برغر','easy'), w('عصير','easy'), w('مروحة','medium'), w('دلو','easy'),
    w('مقص','medium'), w('فرشاة','medium'), w('صابون','medium'), w('مكنسة','hard')
  ]
};

const rooms = {};

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function newPlayer(token, socketId, name) {
  return {
    token, id: socketId, name: (name || 'Player').slice(0, 16),
    score: 0, connected: true, guessedThisRound: false,
    streak: 0, fastestCount: 0, pointsAsDrawer: 0, leaveTimer: null, team: null
  };
}

function publicPlayers(room) {
  const drawer = currentDrawer(room);
  return room.players.map(p => ({
    id: p.id, name: p.name, score: p.score, connected: p.connected, streak: p.streak, team: p.team,
    isDrawer: (room.state === 'drawing' || room.state === 'choosing') && drawer && drawer.token === p.token,
    guessed: !!p.guessedThisRound
  }));
}

function teamTotals(room) {
  if (!room.teamMode) return null;
  const totals = { A: 0, B: 0 };
  room.players.forEach(p => { if (p.team) totals[p.team] += p.score; });
  return totals;
}

function broadcastPlayers(room) {
  io.to(room.code).emit('players-update', {
    players: publicPlayers(room),
    hostToken: room.hostToken,
    teamMode: room.teamMode,
    teams: teamTotals(room)
  });
}

function maskWord(word) {
  return word.split('').map(ch => (ch === ' ' ? ' ' : '_')).join('');
}

function getWordPool(room) {
  if (room.wordPack === 'custom' && room.customWords && room.customWords.length >= 5) {
    return room.customWords.map(word => ({ word, difficulty: 'medium' }));
  }
  if (room.wordPack === 'arabic') return WORD_PACKS.arabic;
  return WORD_PACKS.english;
}

function pickWordOptions(room) {
  const basePool = getWordPool(room);
  const diffOk = e => (!room.difficultyFilter || room.difficultyFilter === 'mixed') ? true : e.difficulty === room.difficultyFilter;
  let pool = basePool.filter(diffOk).filter(e => !room.usedWords.has(e.word));
  if (pool.length < 3) { room.usedWords.clear(); pool = basePool.filter(diffOk); }
  if (pool.length < 3) pool = basePool.slice(); // fallback if the chosen difficulty has too few words
  const options = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    options.push(pool.splice(idx, 1)[0]);
  }
  return options;
}

function clearRoomTimer(room) { if (room.timer) { clearInterval(room.timer); room.timer = null; } }
function currentDrawer(room) { return room.players[room.currentDrawerIndex] || null; }
function connectedCount(room) { return room.players.filter(p => p.connected).length; }
function emitToPlayer(player, event, payload) { if (player && player.connected) io.to(player.id).emit(event, payload); }

function assignTeams(room) {
  const connected = room.players.filter(p => p.connected);
  connected.forEach((p, i) => { p.team = i % 2 === 0 ? 'A' : 'B'; });
}

function startChoosing(room) {
  clearRoomTimer(room);
  room.roundNumber++;

  if (room.roundNumber > room.totalRounds) {
    if (room.speedRoundEnabled && !room.speedRoundDone && connectedCount(room) >= 2) {
      room.speedRoundDone = true;
      room.isSpeedRound = true;
      room.totalRounds += 1;
    } else {
      return endGame(room);
    }
  } else {
    room.isSpeedRound = false;
  }

  if (connectedCount(room) < 2) return endGame(room);

  let attempts = 0;
  do {
    room.currentDrawerIndex = (room.currentDrawerIndex + 1) % room.players.length;
    attempts++;
  } while (!room.players[room.currentDrawerIndex].connected && attempts <= room.players.length);

  room.players.forEach(p => (p.guessedThisRound = false));
  room.state = 'choosing';
  room.wordOptions = pickWordOptions(room);
  room.drawingHistory = [];
  room.groupCounter = 0;
  room.currentGroupId = null;
  room.hintsSent = 0;
  room.firstGuesserToken = null;

  const drawer = currentDrawer(room);

  io.to(room.code).emit('choosing', {
    drawerId: drawer.id, drawerName: drawer.name,
    roundNumber: room.roundNumber, totalRounds: room.totalRounds,
    chooseSeconds: CHOOSE_SECONDS, isSpeedRound: room.isSpeedRound
  });
  emitToPlayer(drawer, 'choose-word', { options: room.wordOptions });

  let secondsLeft = CHOOSE_SECONDS;
  room.timer = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearRoomTimer(room);
      startDrawing(room, room.wordOptions[0].word, room.wordOptions[0].difficulty);
    }
  }, 1000);
}

function startDrawing(room, word, difficulty) {
  clearRoomTimer(room);
  room.state = 'drawing';
  room.currentWord = word;
  room.currentDifficulty = difficulty || 'medium';
  room.usedWords.add(word);
  room.maskedWord = maskWord(word);
  const seconds = room.isSpeedRound ? SPEED_ROUND_SECONDS : ROUND_SECONDS;
  room.roundSeconds = seconds;
  room.timeLeft = seconds;
  room.drawingHistory = [];
  room.firstGuesserToken = null;
  const drawer = currentDrawer(room);

  io.to(room.code).emit('round-start', {
    drawerId: drawer.id, drawerName: drawer.name, maskedWord: room.maskedWord,
    wordLength: word.length, timeLeft: room.timeLeft, roundNumber: room.roundNumber,
    totalRounds: room.totalRounds, isSpeedRound: room.isSpeedRound, difficulty: room.currentDifficulty
  });
  emitToPlayer(drawer, 'your-word', { word });
  broadcastPlayers(room);

  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(room.code).emit('tick', { timeLeft: room.timeLeft });
    const fraction = room.timeLeft / seconds;
    if (room.hintsSent < HINT_FRACTIONS.length && fraction <= HINT_FRACTIONS[room.hintsSent]) {
      room.hintsSent++;
      revealHint(room);
    }
    if (room.timeLeft <= 0) endRound(room, 'timeout');
  }, 1000);
}

function revealHint(room) {
  const chars = room.maskedWord.split('');
  const hiddenIdx = [];
  for (let i = 0; i < chars.length; i++) if (chars[i] === '_') hiddenIdx.push(i);
  if (!hiddenIdx.length) return;
  const idx = hiddenIdx[Math.floor(Math.random() * hiddenIdx.length)];
  chars[idx] = room.currentWord[idx];
  room.maskedWord = chars.join('');
  io.to(room.code).emit('word-hint', { maskedWord: room.maskedWord });
}

function endRound(room, reason) {
  clearRoomTimer(room);
  room.state = 'roundEnd';
  const drawer = currentDrawer(room);
  room.players.forEach(p => {
    if (p.connected && (!drawer || p.token !== drawer.token) && !p.guessedThisRound) p.streak = 0;
  });
  io.to(room.code).emit('round-end', { word: room.currentWord, reason, players: publicPlayers(room), teams: teamTotals(room) });
  setTimeout(() => { if (rooms[room.code]) startChoosing(room); }, 5000);
}

function endGame(room) {
  clearRoomTimer(room);
  room.state = 'gameEnd';
  const final = [...room.players].sort((a, b) => b.score - a.score);
  const bestDrawer = [...room.players].sort((a, b) => b.pointsAsDrawer - a.pointsAsDrawer)[0];
  const fastest = [...room.players].sort((a, b) => b.fastestCount - a.fastestCount)[0];
  io.to(room.code).emit('game-end', {
    players: final.map(p => ({ id: p.id, token: p.token, name: p.name, score: p.score })),
    bestDrawer: bestDrawer && bestDrawer.pointsAsDrawer > 0 ? bestDrawer.name : null,
    fastestGuesser: fastest && fastest.fastestCount > 0 ? fastest.name : null,
    teamMode: room.teamMode,
    teams: teamTotals(room)
  });
  recordGameResults(final);
}

async function recordGameResults(final) {
  try {
    const loggedInUserIds = [];
    for (let i = 0; i < final.length; i++) {
      const p = final[i];
      const sock = io.sockets.sockets.get(p.id);
      const userId = sock && sock.data && sock.data.userId;
      if (!userId) continue;
      loggedInUserIds.push(userId);
      await pool.query(
        `INSERT INTO game_results (user_id, score, rank, total_players) VALUES ($1, $2, $3, $4)`,
        [userId, p.score, i + 1, final.length]
      );
    }
    for (const a of loggedInUserIds) {
      for (const b of loggedInUserIds) {
        if (a === b) continue;
        await pool.query(
          `INSERT INTO recent_plays (user_id, played_with_id, played_at) VALUES ($1, $2, now())
           ON CONFLICT (user_id, played_with_id) DO UPDATE SET played_at = now()`,
          [a, b]
        );
      }
    }
  } catch (err) {
    console.error('recordGameResults error', err);
  }
}

function resetGame(room) {
  clearRoomTimer(room);
  room.state = 'lobby';
  room.currentDrawerIndex = -1;
  room.roundNumber = 0;
  room.currentWord = null;
  room.maskedWord = null;
  room.usedWords = new Set();
  room.speedRoundDone = false;
  room.isSpeedRound = false;
  room.players.forEach(p => {
    p.score = 0; p.guessedThisRound = false; p.streak = 0; p.fastestCount = 0; p.pointsAsDrawer = 0; p.team = null;
  });
  broadcastPlayers(room);
  io.to(room.code).emit('back-to-lobby', {
    wordPack: room.wordPack, teamMode: room.teamMode, isPublic: room.isPublic,
    difficulty: room.difficultyFilter, speedRoundEnabled: room.speedRoundEnabled
  });
}

function sendResumeState(socket, room, player) {
  socket.emit('room-joined', {
    code: room.code, you: player.token, hostToken: room.hostToken,
    players: publicPlayers(room), wordPack: room.wordPack, gameState: room.state,
    teamMode: room.teamMode, isPublic: room.isPublic,
    difficulty: room.difficultyFilter, speedRoundEnabled: room.speedRoundEnabled
  });
  if (room.state === 'lobby') return;

  if (room.state === 'choosing' || room.state === 'drawing') {
    const drawer = currentDrawer(room);
    socket.emit('choosing', {
      drawerId: drawer.id, drawerName: drawer.name, roundNumber: room.roundNumber,
      totalRounds: room.totalRounds, chooseSeconds: CHOOSE_SECONDS, isSpeedRound: room.isSpeedRound
    });
    if (room.state === 'drawing') {
      socket.emit('round-start', {
        drawerId: drawer.id, drawerName: drawer.name, maskedWord: room.maskedWord,
        wordLength: room.currentWord ? room.currentWord.length : 0, timeLeft: room.timeLeft,
        roundNumber: room.roundNumber, totalRounds: room.totalRounds,
        isSpeedRound: room.isSpeedRound, difficulty: room.currentDifficulty
      });
      socket.emit('canvas-sync', { history: room.drawingHistory });
      if (drawer.token === player.token) socket.emit('your-word', { word: room.currentWord });
    } else if (drawer.token === player.token) {
      socket.emit('choose-word', { options: room.wordOptions });
    }
  } else if (room.state === 'roundEnd') {
    socket.emit('round-end', { word: room.currentWord, reason: 'resumed', players: publicPlayers(room), teams: teamTotals(room) });
  } else if (room.state === 'gameEnd') {
    const final = [...room.players].sort((a, b) => b.score - a.score);
    socket.emit('game-end', { players: final.map(p => ({ id: p.id, token: p.token, name: p.name, score: p.score })), teamMode: room.teamMode, teams: teamTotals(room) });
  }
}

function publicRoomsList() {
  return Object.values(rooms)
    .filter(r => r.isPublic && r.state === 'lobby' && connectedCount(r) < MAX_PLAYERS && connectedCount(r) > 0)
    .map(r => {
      const host = r.players.find(p => p.token === r.hostToken);
      return { code: r.code, host: host ? host.name : '?', count: connectedCount(r) };
    });
}

// ---------------- Friends: presence tracking ----------------
// userId (number) -> Set of socket.id currently connected for that account
const onlineSockets = new Map();
function markOnline(userId, socketId) {
  if (!onlineSockets.has(userId)) onlineSockets.set(userId, new Set());
  onlineSockets.get(userId).add(socketId);
}
function markOffline(userId, socketId) {
  const set = onlineSockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (!set.size) onlineSockets.delete(userId);
}
function isOnline(userId) { return onlineSockets.has(userId); }
function emitToUser(userId, event, payload) {
  const set = onlineSockets.get(userId);
  if (!set) return;
  set.forEach(sid => io.to(sid).emit(event, payload));
}

io.on('connection', socket => {
  // ---------------- Friends: auth + presence ----------------
  socket.on('friends:auth', async ({ token }) => {
    const user = await getUserByToken(token);
    if (!user) return socket.emit('friends:auth-error', { message: 'Session expired, please log in again.' });
    socket.data.userId = user.id;
    socket.data.username = user.username;
    markOnline(user.id, socket.id);
    socket.emit('friends:auth-ok', { userId: user.id, username: user.username, friendCode: user.friend_code });
  });

  // ---------------- Leaderboard ----------------
  const LEADERBOARD_QUERIES = {
    best_score: {
      list: `SELECT u.id, u.username, MAX(gr.score)::int AS value
             FROM game_results gr JOIN users u ON u.id = gr.user_id
             GROUP BY u.id, u.username ORDER BY value DESC LIMIT 20`,
      myValue: `SELECT MAX(score)::int AS value FROM game_results WHERE user_id = $1`,
      higherCount: `SELECT COUNT(*)::int AS n FROM (
                      SELECT user_id, MAX(score) AS best FROM game_results GROUP BY user_id
                    ) t WHERE t.best > $1`
    },
    wins: {
      list: `SELECT u.id, u.username, COUNT(*) FILTER (WHERE gr.rank = 1)::int AS value
             FROM game_results gr JOIN users u ON u.id = gr.user_id
             GROUP BY u.id, u.username ORDER BY value DESC LIMIT 20`,
      myValue: `SELECT COUNT(*) FILTER (WHERE rank = 1)::int AS value FROM game_results WHERE user_id = $1`,
      higherCount: `SELECT COUNT(*)::int AS n FROM (
                      SELECT user_id, COUNT(*) FILTER (WHERE rank = 1) AS wins FROM game_results GROUP BY user_id
                    ) t WHERE t.wins > $1`
    },
    games: {
      list: `SELECT u.id, u.username, COUNT(*)::int AS value
             FROM game_results gr JOIN users u ON u.id = gr.user_id
             GROUP BY u.id, u.username ORDER BY value DESC LIMIT 20`,
      myValue: `SELECT COUNT(*)::int AS value FROM game_results WHERE user_id = $1`,
      higherCount: `SELECT COUNT(*)::int AS n FROM (
                      SELECT user_id, COUNT(*) AS games FROM game_results GROUP BY user_id
                    ) t WHERE t.games > $1`
    }
  };

  socket.on('leaderboard:get', async ({ category }) => {
    const q = LEADERBOARD_QUERIES[category];
    if (!q) return;
    try {
      const listRes = await pool.query(q.list);
      let myRank = null, myValue = 0;
      const me = socket.data.userId;
      if (me) {
        const myValRes = await pool.query(q.myValue, [me]);
        myValue = myValRes.rows[0].value || 0;
        const higherRes = await pool.query(q.higherCount, [myValue]);
        myRank = higherRes.rows[0].n + 1;
      }
      socket.emit('leaderboard:data', {
        category,
        top: listRes.rows.map(r => ({ id: r.id, username: r.username, value: r.value })),
        myRank,
        myValue
      });
    } catch (err) {
      console.error('leaderboard:get error', err);
    }
  });

  // ---------------- Profile ----------------
  socket.on('profile:get', async () => {
    const me = socket.data.userId;
    if (!me) return;
    try {
      const userRes = await pool.query('SELECT username, bio, avatar_data_url, friend_code FROM users WHERE id=$1', [me]);
      const statsRes = await pool.query(
        `SELECT COUNT(*)::int AS games_played,
                COUNT(*) FILTER (WHERE rank = 1)::int AS wins,
                COALESCE(MAX(score), 0)::int AS best_score
         FROM game_results WHERE user_id = $1`,
        [me]
      );
      if (!userRes.rows.length) return;
      const u = userRes.rows[0];
      const s = statsRes.rows[0];
      socket.emit('profile:data', {
        username: u.username,
        bio: u.bio || '',
        avatarDataUrl: u.avatar_data_url || null,
        friendCode: u.friend_code,
        gamesPlayed: s.games_played,
        wins: s.wins,
        bestScore: s.best_score
      });
    } catch (err) {
      console.error('profile:get error', err);
    }
  });

  socket.on('profile:update-bio', async ({ bio }) => {
    const me = socket.data.userId;
    if (!me) return;
    const clean = String(bio || '').slice(0, 150);
    try {
      await pool.query('UPDATE users SET bio=$1 WHERE id=$2', [clean, me]);
      socket.emit('profile:bio-updated', { bio: clean });
    } catch (err) {
      console.error('profile:update-bio error', err);
    }
  });

  socket.on('profile:update-avatar', async ({ dataUrl }) => {
    const me = socket.data.userId;
    if (!me) return;
    if (typeof dataUrl !== 'string' || dataUrl.length > 200000) {
      return socket.emit('profile:error', { message: 'That image is too large.' });
    }
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(dataUrl)) {
      return socket.emit('profile:error', { message: 'Unsupported image format.' });
    }
    try {
      await pool.query('UPDATE users SET avatar_data_url=$1 WHERE id=$2', [dataUrl, me]);
      socket.emit('profile:avatar-updated', { avatarDataUrl: dataUrl });
    } catch (err) {
      console.error('profile:update-avatar error', err);
    }
  });

  socket.on('friends:send-request', async ({ friendCode }) => {
    const me = socket.data.userId;
    if (!me) return socket.emit('friends:error', { message: 'Please log in first.' });
    try {
      const codeUpper = String(friendCode || '').trim().toUpperCase();
      const target = await pool.query('SELECT id, username FROM users WHERE friend_code = $1', [codeUpper]);
      if (!target.rows.length) return socket.emit('friends:error', { message: 'No account found with that friend code.' });
      const targetId = target.rows[0].id;
      if (targetId === me) return socket.emit('friends:error', { message: "That's your own friend code!" });

      const already = await pool.query(
        `SELECT 1 FROM friendships WHERE (user_id_a=$1 AND user_id_b=$2) OR (user_id_a=$2 AND user_id_b=$1)`,
        [me, targetId]
      );
      if (already.rows.length) return socket.emit('friends:error', { message: 'You are already friends.' });

      const blocked = await pool.query(
        `SELECT 1 FROM blocked_users WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1)`,
        [me, targetId]
      );
      if (blocked.rows.length) return socket.emit('friends:error', { message: 'This person is not accepting friend requests.' });

      await pool.query(
        `INSERT INTO friend_requests (from_user_id, to_user_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (from_user_id, to_user_id) DO UPDATE SET status='pending', created_at=now()`,
        [me, targetId]
      );
      socket.emit('friends:request-sent', { username: target.rows[0].username });
      emitToUser(targetId, 'friends:incoming-request', { fromUserId: me, fromUsername: socket.data.username });
    } catch (err) {
      console.error('send-request error', err);
      socket.emit('friends:error', { message: 'Could not send friend request.' });
    }
  });

  socket.on('friends:respond', async ({ fromUserId, accept }) => {
    const me = socket.data.userId;
    if (!me) return;
    try {
      const reqRow = await pool.query(
        `SELECT id FROM friend_requests WHERE from_user_id=$1 AND to_user_id=$2 AND status='pending'`,
        [fromUserId, me]
      );
      if (!reqRow.rows.length) return;
      if (accept) {
        await pool.query(`UPDATE friend_requests SET status='accepted' WHERE id=$1`, [reqRow.rows[0].id]);
        const a = Math.min(me, fromUserId), b = Math.max(me, fromUserId);
        await pool.query(
          `INSERT INTO friendships (user_id_a, user_id_b) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [a, b]
        );
        const meRow = await pool.query('SELECT username FROM users WHERE id=$1', [me]);
        emitToUser(fromUserId, 'friends:request-accepted', { byUserId: me, byUsername: meRow.rows[0].username });
      } else {
        await pool.query(`UPDATE friend_requests SET status='declined' WHERE id=$1`, [reqRow.rows[0].id]);
      }
      pushFriendsList(me);
    } catch (err) {
      console.error('respond error', err);
    }
  });

  async function pushFriendsList(userId) {
    try {
      const friendsQ = await pool.query(
        `SELECT u.id, u.username FROM friendships f
         JOIN users u ON u.id = (CASE WHEN f.user_id_a = $1 THEN f.user_id_b ELSE f.user_id_a END)
         WHERE f.user_id_a = $1 OR f.user_id_b = $1
         ORDER BY u.username`,
        [userId]
      );
      const friends = friendsQ.rows.map(r => ({ id: r.id, username: r.username, online: isOnline(r.id) }));

      const incomingQ = await pool.query(
        `SELECT fr.from_user_id, u.username FROM friend_requests fr
         JOIN users u ON u.id = fr.from_user_id
         WHERE fr.to_user_id = $1 AND fr.status = 'pending'`,
        [userId]
      );
      const incoming = incomingQ.rows.map(r => ({ fromUserId: r.from_user_id, fromUsername: r.username }));

      emitToUser(userId, 'friends:list', { friends, incoming });
    } catch (err) {
      console.error('pushFriendsList error', err);
    }
  }
  socket.on('friends:get-list', () => { if (socket.data.userId) pushFriendsList(socket.data.userId); });

  // ---------------- Block / Unblock / Report ----------------
  socket.on('friends:block', async ({ userId }) => {
    const me = socket.data.userId;
    if (!me || !userId || userId === me) return;
    try {
      await pool.query('INSERT INTO blocked_users (user_id, blocked_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me, userId]);
      await pool.query('DELETE FROM friendships WHERE (user_id_a=$1 AND user_id_b=$2) OR (user_id_a=$2 AND user_id_b=$1)', [me, userId]);
      await pool.query('DELETE FROM friend_requests WHERE (from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1)', [me, userId]);
      socket.emit('friends:blocked', { userId });
      pushFriendsList(me);
    } catch (err) {
      console.error('friends:block error', err);
    }
  });

  socket.on('friends:unblock', async ({ userId }) => {
    const me = socket.data.userId;
    if (!me || !userId) return;
    try {
      await pool.query('DELETE FROM blocked_users WHERE user_id=$1 AND blocked_user_id=$2', [me, userId]);
      socket.emit('friends:unblocked', { userId });
    } catch (err) {
      console.error('friends:unblock error', err);
    }
  });

  socket.on('friends:get-blocked', async () => {
    const me = socket.data.userId;
    if (!me) return;
    try {
      const rows = await pool.query(
        `SELECT bu.blocked_user_id AS id, u.username FROM blocked_users bu
         JOIN users u ON u.id = bu.blocked_user_id WHERE bu.user_id = $1 ORDER BY bu.created_at DESC`,
        [me]
      );
      socket.emit('friends:blocked-list', { blocked: rows.rows });
    } catch (err) {
      console.error('friends:get-blocked error', err);
    }
  });

  socket.on('report-player', async ({ reportedName, roomCode, reason }) => {
    try {
      await pool.query(
        'INSERT INTO reports (reporter_user_id, reporter_name, reported_name, room_code, reason) VALUES ($1,$2,$3,$4,$5)',
        [
          socket.data.userId || null,
          socket.data.username || null,
          String(reportedName || '').slice(0, 32),
          String(roomCode || '').slice(0, 8),
          String(reason || '').slice(0, 200)
        ]
      );
    } catch (err) {
      console.error('report-player error', err);
    }
    socket.emit('report-submitted');
  });

  socket.on('friends:invite', ({ friendUserId, myToken, myName }) => {
    const me = socket.data.userId;
    if (!me) return;
    if (!isOnline(friendUserId)) return socket.emit('friends:error', { message: 'Your friend is not online right now.' });

    const existingCode = socket.data.roomCode;
    const existingRoom = existingCode && rooms[existingCode];
    const stillMember = existingRoom && existingRoom.players.some(p => p.id === socket.id);

    if (existingRoom && stillMember && existingRoom.state === 'lobby') {
      // Already hosting/sitting in a lobby — invite the friend into THIS room.
      socket.emit('friends:invite-created', { code: existingCode, createdNew: false });
      emitToUser(friendUserId, 'friends:invite-received', { fromUsername: socket.data.username, code: existingCode });
      return;
    }

    // Not currently in a joinable room — spin up a fresh one and actually
    // join the inviter into it too, so they land in the lobby together.
    const code = makeRoomCode();
    const room = {
      code, players: [], hostToken: myToken, state: 'lobby', currentDrawerIndex: -1,
      currentWord: null, maskedWord: null, roundNumber: 0, totalRounds: 0, timer: null, timeLeft: 0,
      wordOptions: [], drawingHistory: [], groupCounter: 0, currentGroupId: null, hintsSent: 0,
      wordPack: 'english', customWords: [], usedWords: new Set(), firstGuesserToken: null,
      isPublic: false, teamMode: false, speedRoundEnabled: true, speedRoundDone: false, isSpeedRound: false,
      difficultyFilter: 'mixed'
    };
    room.players.push(newPlayer(myToken, socket.id, myName));
    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;

    socket.emit('room-joined', {
      code, you: myToken, hostToken: room.hostToken, players: publicPlayers(room),
      wordPack: room.wordPack, gameState: room.state, teamMode: room.teamMode, isPublic: room.isPublic,
      difficulty: room.difficultyFilter, speedRoundEnabled: room.speedRoundEnabled
    });
    socket.emit('friends:invite-created', { code, createdNew: true });
    emitToUser(friendUserId, 'friends:invite-received', { fromUsername: socket.data.username, code });
  });

  socket.on('friends:send-request-by-id', async ({ toUserId }) => {
    const me = socket.data.userId;
    if (!me || !toUserId || toUserId === me) return;
    try {
      const target = await pool.query('SELECT username, friend_code FROM users WHERE id=$1', [toUserId]);
      if (!target.rows.length) return socket.emit('friends:error', { message: 'That player no longer exists.' });
      const already = await pool.query(
        'SELECT 1 FROM friendships WHERE (user_id_a=$1 AND user_id_b=$2) OR (user_id_a=$2 AND user_id_b=$1)',
        [me, toUserId]
      );
      if (already.rows.length) return socket.emit('friends:error', { message: 'You are already friends.' });
      const blocked = await pool.query(
        'SELECT 1 FROM blocked_users WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1)',
        [me, toUserId]
      );
      if (blocked.rows.length) return socket.emit('friends:error', { message: 'This person is not accepting friend requests.' });
      await pool.query(
        `INSERT INTO friend_requests (from_user_id, to_user_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (from_user_id, to_user_id) DO UPDATE SET status='pending', created_at=now()`,
        [me, toUserId]
      );
      socket.emit('friends:request-sent', { username: target.rows[0].username });
      emitToUser(toUserId, 'friends:incoming-request', { fromUserId: me, fromUsername: socket.data.username });
    } catch (err) {
      console.error('send-request-by-id error', err);
      socket.emit('friends:error', { message: 'Could not send friend request.' });
    }
  });

  socket.on('friends:recent-played', async () => {
    const me = socket.data.userId;
    if (!me) return;
    try {
      const rows = await pool.query(
        `SELECT rp.played_with_id AS id, u.username, rp.played_at
         FROM recent_plays rp
         JOIN users u ON u.id = rp.played_with_id
         WHERE rp.user_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM friendships f
             WHERE (f.user_id_a = $1 AND f.user_id_b = rp.played_with_id)
                OR (f.user_id_b = $1 AND f.user_id_a = rp.played_with_id)
           )
         ORDER BY rp.played_at DESC
         LIMIT 5`,
        [me]
      );
      socket.emit('friends:recent-played-list', { recent: rows.rows.map(r => ({ id: r.id, username: r.username })) });
    } catch (err) {
      console.error('friends:recent-played error', err);
    }
  });

  socket.on('friends:dm-send', async ({ toUserId, text }) => {
    const me = socket.data.userId;
    if (!me || !text || !text.trim()) return;
    const clean = censorText(text.trim().slice(0, 500));
    try {
      const blocked = await pool.query(
        `SELECT 1 FROM blocked_users WHERE (user_id=$1 AND blocked_user_id=$2) OR (user_id=$2 AND blocked_user_id=$1)`,
        [me, toUserId]
      );
      if (blocked.rows.length) return socket.emit('friends:error', { message: 'You can\'t message this person.' });

      const result = await pool.query(
        'INSERT INTO messages (from_user_id, to_user_id, text) VALUES ($1,$2,$3) RETURNING id, created_at',
        [me, toUserId, clean]
      );
      const payload = { id: result.rows[0].id, fromUserId: me, fromUsername: socket.data.username, text: clean, ts: result.rows[0].created_at };
      socket.emit('friends:dm-sent', payload);
      emitToUser(toUserId, 'friends:dm-received', payload);
    } catch (err) {
      console.error('dm-send error', err);
    }
  });

  socket.on('friends:dm-history', async ({ withUserId }) => {
    const me = socket.data.userId;
    if (!me) return;
    try {
      const result = await pool.query(
        `SELECT id, from_user_id, to_user_id, text, created_at FROM messages
         WHERE (from_user_id=$1 AND to_user_id=$2) OR (from_user_id=$2 AND to_user_id=$1)
         ORDER BY created_at ASC LIMIT 200`,
        [me, withUserId]
      );
      socket.emit('friends:dm-history', { withUserId, messages: result.rows });
    } catch (err) {
      console.error('dm-history error', err);
    }
  });

  socket.on('disconnect', () => {
    if (socket.data.userId) markOffline(socket.data.userId, socket.id);
  });

  socket.on('create-room', ({ name, token, isPublic, wordPack, customWords, difficulty, speedRoundEnabled, teamMode }) => {
    const code = makeRoomCode();
    const room = {
      code, players: [], hostToken: token, state: 'lobby', currentDrawerIndex: -1,
      currentWord: null, maskedWord: null, roundNumber: 0, totalRounds: 0, timer: null, timeLeft: 0,
      wordOptions: [], drawingHistory: [], groupCounter: 0, currentGroupId: null, hintsSent: 0,
      wordPack: ['english', 'arabic', 'custom'].includes(wordPack) ? wordPack : 'english',
      customWords: [], usedWords: new Set(), firstGuesserToken: null,
      isPublic: !!isPublic, teamMode: !!teamMode,
      speedRoundEnabled: speedRoundEnabled !== false, speedRoundDone: false, isSpeedRound: false,
      difficultyFilter: ['easy', 'medium', 'hard', 'mixed'].includes(difficulty) ? difficulty : 'mixed'
    };
    if (room.wordPack === 'custom') {
      const cleaned = (customWords || []).map(x => String(x).trim()).filter(x => x.length >= 2 && x.length <= 24);
      room.customWords = cleaned.length >= 5 ? cleaned : [];
      if (!room.customWords.length) room.wordPack = 'english'; // fallback if custom list was too short
    }
    room.players.push(newPlayer(token, socket.id, name));
    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.token = token;
    socket.emit('room-joined', {
      code, you: token, hostToken: room.hostToken, players: publicPlayers(room),
      wordPack: room.wordPack, gameState: room.state, teamMode: room.teamMode, isPublic: room.isPublic,
      difficulty: room.difficultyFilter, speedRoundEnabled: room.speedRoundEnabled
    });
  });

  socket.on('join-room', ({ name, code, token }) => {
    code = (code || '').trim().toUpperCase();
    const room = rooms[code];
    if (!room) return socket.emit('join-error', { message: 'Room not found. Check the code and try again.' });

    const existing = room.players.find(p => p.token === token);
    if (existing) {
      if (existing.leaveTimer) { clearTimeout(existing.leaveTimer); existing.leaveTimer = null; }
      existing.id = socket.id;
      existing.connected = true;
      if (name) existing.name = name.slice(0, 16);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.token = token;
      sendResumeState(socket, room, existing);
      broadcastPlayers(room);
      return;
    }

    if (connectedCount(room) >= MAX_PLAYERS) return socket.emit('join-error', { message: 'This room is full.' });
    if (room.state !== 'lobby') return socket.emit('join-error', { message: 'This game already started. Ask for a new room code.' });

    room.players.push(newPlayer(token, socket.id, name));
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.token = token;
    socket.emit('room-joined', {
      code, you: token, hostToken: room.hostToken, players: publicPlayers(room),
      wordPack: room.wordPack, gameState: room.state, teamMode: room.teamMode, isPublic: room.isPublic,
      difficulty: room.difficultyFilter, speedRoundEnabled: room.speedRoundEnabled
    });
    broadcastPlayers(room);
  });

  socket.on('list-public-rooms', () => {
    socket.emit('public-rooms-list', { rooms: publicRoomsList() });
  });

  socket.on('start-game', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostToken !== socket.data.token) return;
    if (connectedCount(room) < 2) return socket.emit('join-error', { message: 'Need at least 2 players to start.' });
    room.totalRounds = connectedCount(room) * ROUNDS_PER_PLAYER;
    room.currentDrawerIndex = -1;
    room.roundNumber = 0;
    room.usedWords = new Set();
    room.speedRoundDone = false;
    room.isSpeedRound = false;
    if (room.teamMode) assignTeams(room);
    room.players.forEach(p => { p.score = 0; p.streak = 0; p.fastestCount = 0; p.pointsAsDrawer = 0; });
    startChoosing(room);
  });

  socket.on('word-chosen', ({ word }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'choosing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.token !== socket.data.token) return;
    const found = room.wordOptions.find(o => o.word === word);
    if (!found) return;
    startDrawing(room, found.word, found.difficulty);
  });

  function nextGroupId(room) { room.groupCounter++; return room.groupCounter; }

  socket.on('draw-start', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.token !== socket.data.token) return;
    room.currentGroupId = nextGroupId(room);
  });

  socket.on('draw-end', () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    room.currentGroupId = null;
  });

  socket.on('draw-data', data => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.token !== socket.data.token) return;
    if (!room.currentGroupId) room.currentGroupId = nextGroupId(room);
    const entry = { type: 'stroke', groupId: room.currentGroupId, from: data.from, to: data.to, color: data.color, size: data.size };
    room.drawingHistory.push(entry);
    if (room.drawingHistory.length > 6000) room.drawingHistory.shift();
    socket.to(room.code).emit('draw-data', entry);
  });

  socket.on('draw-shape', data => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.token !== socket.data.token) return;
    const entry = { type: 'shape', groupId: nextGroupId(room), shape: data.shape, x1: data.x1, y1: data.y1, x2: data.x2, y2: data.y2, color: data.color, size: data.size };
    room.drawingHistory.push(entry);
    socket.to(room.code).emit('draw-shape', entry);
  });

  socket.on('draw-fill', data => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.token !== socket.data.token) return;
    const entry = { type: 'fill', groupId: nextGroupId(room), x: data.x, y: data.y, color: data.color };
    room.drawingHistory.push(entry);
    socket.to(room.code).emit('draw-fill', entry);
  });

  socket.on('undo', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.token !== socket.data.token) return;
    if (!room.drawingHistory.length) return;
    const lastGroup = room.drawingHistory[room.drawingHistory.length - 1].groupId;
    room.drawingHistory = room.drawingHistory.filter(e => e.groupId !== lastGroup);
    io.to(room.code).emit('canvas-sync', { history: room.drawingHistory });
  });

  socket.on('clear-canvas', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.token !== socket.data.token) return;
    room.drawingHistory = [];
    io.to(room.code).emit('clear-canvas');
  });

  socket.on('typing', () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const player = room.players.find(p => p.token === socket.data.token);
    if (!player) return;
    socket.to(room.code).emit('typing', { name: player.name });
  });

  socket.on('reaction', ({ emoji }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing') return;
    const player = room.players.find(p => p.token === socket.data.token);
    if (!player) return;
    const allowed = ['😂', '🔥', '👏', '😮', '❤️', '🤔'];
    if (!allowed.includes(emoji)) return;
    io.to(room.code).emit('reaction', { emoji, name: player.name });
  });

  socket.on('guess', ({ text }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing' || !text) return;
    const player = room.players.find(p => p.token === socket.data.token);
    const drawer = currentDrawer(room);
    if (!player || !drawer || player.token === drawer.token || player.guessedThisRound) return;

    const clean = text.trim().toLowerCase();
    if (clean === room.currentWord.toLowerCase()) {
      player.guessedThisRound = true;
      const mult = DIFFICULTY_MULT[room.currentDifficulty] || 1;
      const speedMult = room.isSpeedRound ? 2 : 1;
      let points = Math.round(Math.max(10, Math.round(100 * (room.timeLeft / room.roundSeconds))) * mult * speedMult);
      let fastest = false;
      if (!room.firstGuesserToken) {
        room.firstGuesserToken = player.token;
        points += FASTEST_BONUS;
        player.fastestCount++;
        fastest = true;
      }
      player.streak++;
      const streakBonus = player.streak >= 2 ? Math.min(player.streak * STREAK_BONUS_PER, STREAK_BONUS_CAP) : 0;
      points += streakBonus;

      player.score += points;
      const drawerPoints = Math.round(15 * mult * speedMult);
      drawer.score += drawerPoints;
      drawer.pointsAsDrawer += drawerPoints;

      const tag = fastest ? '🥇 ' : '';
      io.to(room.code).emit('system-message', { text: `${tag}${player.name} guessed the word! (+${points})` });
      socket.emit('guess-result', { correct: true, points, fastest, streak: player.streak, timeLeft: room.timeLeft });
      broadcastPlayers(room);

      const everyoneGuessed = room.players.filter(p => p.connected && p.token !== drawer.token).every(p => p.guessedThisRound);
      if (everyoneGuessed) endRound(room, 'all-guessed');
    } else {
      io.to(room.code).emit('chat-message', { name: player.name, text: censorText(text) });
    }
  });

  socket.on('play-again', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostToken !== socket.data.token) return;
    resetGame(room);
  });

  socket.on('leave-room', () => handleDisconnect(socket, true));
  socket.on('disconnect', () => handleDisconnect(socket, false));

  function handleDisconnect(socket, intentional) {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) { socket.data.roomCode = null; return; }
    const player = room.players.find(p => p.token === socket.data.token);
    if (!player) { if (intentional) socket.data.roomCode = null; return; }

    if (intentional) {
      room.players = room.players.filter(p => p.token !== socket.data.token);
      socket.leave(code);
      socket.data.roomCode = null;
      if (room.players.length === 0) { clearRoomTimer(room); delete rooms[code]; return; }
    } else {
      player.connected = false;
      player.leaveTimer = setTimeout(() => {
        room.players = room.players.filter(p => p.token !== player.token);
        if (room.players.length === 0) { clearRoomTimer(room); delete rooms[code]; }
        else broadcastPlayers(room);
      }, RECONNECT_GRACE_MS);
    }

    if (room.hostToken === socket.data.token) {
      const nextHost = room.players.find(p => p.connected);
      if (nextHost) room.hostToken = nextHost.token;
    }

    const wasDrawer = currentDrawer(room) && currentDrawer(room).token === socket.data.token;
    broadcastPlayers(room);

    if (connectedCount(room) === 0) { clearRoomTimer(room); return; }
    if (wasDrawer && (room.state === 'drawing' || room.state === 'choosing')) endRound(room, 'drawer-left');
  }
});

initSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Doodle Duel server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
