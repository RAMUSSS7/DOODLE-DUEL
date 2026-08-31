const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// NOTE: origin is wide open here for easy testing/deployment.
// Before shipping publicly, restrict this to your CrazyGames game URL.
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(__dirname));

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
  let pool = getWordPool(room).filter(e => !room.usedWords.has(e.word));
  if (pool.length < 3) { room.usedWords.clear(); pool = getWordPool(room).slice(); }
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
    if (!room.speedRoundDone && connectedCount(room) >= 2) {
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
  io.to(room.code).emit('back-to-lobby', { wordPack: room.wordPack, teamMode: room.teamMode, isPublic: room.isPublic });
}

function sendResumeState(socket, room, player) {
  socket.emit('room-joined', {
    code: room.code, you: player.token, hostToken: room.hostToken,
    players: publicPlayers(room), wordPack: room.wordPack, gameState: room.state,
    teamMode: room.teamMode, isPublic: room.isPublic
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

io.on('connection', socket => {
  socket.on('create-room', ({ name, token, isPublic }) => {
    const code = makeRoomCode();
    const room = {
      code, players: [], hostToken: token, state: 'lobby', currentDrawerIndex: -1,
      currentWord: null, maskedWord: null, roundNumber: 0, totalRounds: 0, timer: null, timeLeft: 0,
      wordOptions: [], drawingHistory: [], groupCounter: 0, currentGroupId: null, hintsSent: 0,
      wordPack: 'english', customWords: [], usedWords: new Set(), firstGuesserToken: null,
      isPublic: !!isPublic, teamMode: false, speedRoundDone: false, isSpeedRound: false
    };
    room.players.push(newPlayer(token, socket.id, name));
    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.token = token;
    socket.emit('room-joined', {
      code, you: token, hostToken: room.hostToken, players: publicPlayers(room),
      wordPack: room.wordPack, gameState: room.state, teamMode: room.teamMode, isPublic: room.isPublic
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
      wordPack: room.wordPack, gameState: room.state, teamMode: room.teamMode, isPublic: room.isPublic
    });
    broadcastPlayers(room);
  });

  socket.on('list-public-rooms', () => {
    socket.emit('public-rooms-list', { rooms: publicRoomsList() });
  });

  socket.on('set-word-pack', ({ pack, customWords }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostToken !== socket.data.token || room.state !== 'lobby') return;
    if (!['english', 'arabic', 'custom'].includes(pack)) return;
    room.wordPack = pack;
    if (pack === 'custom') {
      const cleaned = (customWords || []).map(x => String(x).trim()).filter(x => x.length >= 2 && x.length <= 24);
      if (cleaned.length < 5) return socket.emit('join-error', { message: 'Add at least 5 custom words.' });
      room.customWords = cleaned;
    }
    room.usedWords = new Set();
    io.to(room.code).emit('word-pack-update', { wordPack: room.wordPack, customCount: room.customWords.length });
  });

  socket.on('set-team-mode', ({ enabled }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostToken !== socket.data.token || room.state !== 'lobby') return;
    room.teamMode = !!enabled;
    if (room.teamMode) assignTeams(room);
    else room.players.forEach(p => (p.team = null));
    broadcastPlayers(room);
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
      io.to(room.code).emit('chat-message', { name: player.name, text });
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
    if (!room) return;
    const player = room.players.find(p => p.token === socket.data.token);
    if (!player) return;

    if (intentional) {
      room.players = room.players.filter(p => p.token !== socket.data.token);
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

server.listen(PORT, () => {
  console.log(`Doodle Duel server running on port ${PORT}`);
});
