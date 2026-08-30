const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// NOTE: origin is wide open here for easy testing/deployment.
// Before shipping publicly, restrict this to your CrazyGames game URL
// and your own domain, e.g. origin: ["https://www.crazygames.com"]
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const ROUND_SECONDS = 80;
const ROUNDS_PER_PLAYER = 2;
const MAX_PLAYERS = 8;
const CHOOSE_SECONDS = 10;
const HINT_FRACTIONS = [0.6, 0.35, 0.15]; // reveal a letter at these fractions of time remaining
const FASTEST_BONUS = 25;
const STREAK_BONUS_PER = 5;
const STREAK_BONUS_CAP = 25;
const RECONNECT_GRACE_MS = 120000; // keep a disconnected player's seat for 2 minutes

const WORD_PACKS = {
  english: [
    'guitar','elephant','pizza','rainbow','robot','castle','dragon','umbrella','bicycle','volcano',
    'penguin','sandwich','rocket','ghost','octopus','waterfall','cactus','lighthouse','skateboard','dinosaur',
    'butterfly','snowman','pirate','telescope','mushroom','kangaroo','campfire','helicopter','jellyfish','pumpkin',
    'wizard','tornado','sunglasses','backpack','fountain','saxophone','pretzel','cupcake','anchor','compass',
    'igloo','mermaid','tractor','windmill','beehive','scarecrow','submarine','waffle','flamingo','koala',
    'astronaut','campground','lantern','peacock','avalanche','bonfire','canoe','drum','earthquake','feather',
    'glacier','hammock','iceberg','jukebox','kite','lava','moose','nest','oasis','pancake',
    'quicksand','raccoon','saddle','treehouse','unicorn','vampire','walrus','xylophone','yeti','zeppelin',
    'chess','fireworks','harmonica','jigsaw','labyrinth','mosaic','narwhal','origami','pyramid','quill',
    'satellite','trampoline','wheelbarrow','yoyo','zipline','snorkel','periscope','popcorn','marshmallow'
  ],
  arabic: [
    'قطة','كلب','شمس','قمر','بيت','سيارة','تفاحة','موزة','كرة','شجرة',
    'جبل','بحر','سمكة','طائرة','قطار','دراجة','مفتاح','ساعة','كتاب','قلم',
    'كرسي','طاولة','باب','نافذة','ثلج','نار','ماء','ورقة','حذاء','قبعة',
    'نظارة','مظلة','هاتف','حاسوب','تلفاز','كاميرا','ثعبان','أسد','نمر','فيل',
    'زرافة','قرد','دجاجة','بقرة','خروف','حصان','أرنب','سلحفاة','فراشة','نحلة',
    'عنكبوت','تمساح','بطة','بومة','نجمة','سحابة','مطر','برق','رعد','جزيرة',
    'قلعة','برج','جسر','مصباح','مرآة','سرير','وسادة','حقيبة','دمية','بالون',
    'كيك','بيتزا','برغر','عصير','مروحة','دلو','مقص','فرشاة','صابون','مكنسة'
  ]
};

// rooms[code] = room state
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
    token,
    id: socketId,
    name: (name || 'Player').slice(0, 16),
    score: 0,
    connected: true,
    guessedThisRound: false,
    streak: 0,
    fastestCount: 0,
    pointsAsDrawer: 0,
    leaveTimer: null
  };
}

function publicPlayers(room) {
  const drawer = currentDrawer(room);
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
    streak: p.streak,
    isDrawer: (room.state === 'drawing' || room.state === 'choosing') && drawer && drawer.token === p.token,
    guessed: !!p.guessedThisRound
  }));
}

function broadcastPlayers(room) {
  io.to(room.code).emit('players-update', {
    players: publicPlayers(room),
    hostToken: room.hostToken,
    you: null // filled client-side by comparing token
  });
}

function maskWord(word) {
  return word.split('').map(ch => (ch === ' ' ? ' ' : '_')).join('');
}

function getWordPool(room) {
  if (room.wordPack === 'custom' && room.customWords && room.customWords.length >= 5) return room.customWords;
  if (room.wordPack === 'arabic') return WORD_PACKS.arabic;
  return WORD_PACKS.english;
}

function pickWordOptions(room) {
  let pool = getWordPool(room).filter(w => !room.usedWords.has(w));
  if (pool.length < 3) {
    room.usedWords.clear();
    pool = getWordPool(room).slice();
  }
  const options = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    options.push(pool.splice(idx, 1)[0]);
  }
  return options;
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
}

function currentDrawer(room) {
  return room.players[room.currentDrawerIndex] || null;
}

function connectedCount(room) {
  return room.players.filter(p => p.connected).length;
}

function emitToPlayer(player, event, payload) {
  if (player && player.connected) io.to(player.id).emit(event, payload);
}

function startChoosing(room) {
  clearRoomTimer(room);
  room.roundNumber++;
  if (room.roundNumber > room.totalRounds || connectedCount(room) < 2) {
    return endGame(room);
  }

  let attempts = 0;
  do {
    room.currentDrawerIndex = (room.currentDrawerIndex + 1) % room.players.length;
    attempts++;
  } while (!room.players[room.currentDrawerIndex].connected && attempts <= room.players.length);

  room.players.forEach(p => (p.guessedThisRound = false));
  room.state = 'choosing';
  room.wordOptions = pickWordOptions(room);
  room.drawingHistory = [];
  room.hintsSent = 0;
  room.firstGuesserToken = null;

  const drawer = currentDrawer(room);

  io.to(room.code).emit('choosing', {
    drawerId: drawer.id,
    drawerName: drawer.name,
    roundNumber: room.roundNumber,
    totalRounds: room.totalRounds,
    chooseSeconds: CHOOSE_SECONDS
  });
  emitToPlayer(drawer, 'choose-word', { options: room.wordOptions });

  let secondsLeft = CHOOSE_SECONDS;
  room.timer = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearRoomTimer(room);
      const autoWord = room.wordOptions[0];
      startDrawing(room, autoWord);
    }
  }, 1000);
}

function startDrawing(room, word) {
  clearRoomTimer(room);
  room.state = 'drawing';
  room.currentWord = word;
  room.usedWords.add(word);
  room.maskedWord = maskWord(word);
  room.timeLeft = ROUND_SECONDS;
  room.drawingHistory = [];
  room.firstGuesserToken = null;
  const drawer = currentDrawer(room);

  io.to(room.code).emit('round-start', {
    drawerId: drawer.id,
    drawerName: drawer.name,
    maskedWord: room.maskedWord,
    wordLength: word.length,
    timeLeft: room.timeLeft,
    roundNumber: room.roundNumber,
    totalRounds: room.totalRounds
  });
  emitToPlayer(drawer, 'your-word', { word });
  broadcastPlayers(room);

  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(room.code).emit('tick', { timeLeft: room.timeLeft });

    const fraction = room.timeLeft / ROUND_SECONDS;
    if (room.hintsSent < HINT_FRACTIONS.length && fraction <= HINT_FRACTIONS[room.hintsSent]) {
      room.hintsSent++;
      revealHint(room);
    }

    if (room.timeLeft <= 0) {
      endRound(room, 'timeout');
    }
  }, 1000);
}

function revealHint(room) {
  const chars = room.maskedWord.split('');
  const hiddenIdx = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '_') hiddenIdx.push(i);
  }
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

  // reset streak for anyone (connected, not the drawer) who didn't guess this round
  room.players.forEach(p => {
    if (p.connected && (!drawer || p.token !== drawer.token) && !p.guessedThisRound) {
      p.streak = 0;
    }
  });

  io.to(room.code).emit('round-end', {
    word: room.currentWord,
    reason,
    players: publicPlayers(room)
  });
  setTimeout(() => {
    if (rooms[room.code]) startChoosing(room);
  }, 5000);
}

function endGame(room) {
  clearRoomTimer(room);
  room.state = 'gameEnd';
  const final = [...room.players].sort((a, b) => b.score - a.score);
  const bestDrawer = [...room.players].sort((a, b) => b.pointsAsDrawer - a.pointsAsDrawer)[0];
  const fastest = [...room.players].sort((a, b) => b.fastestCount - a.fastestCount)[0];
  io.to(room.code).emit('game-end', {
    players: final.map(p => ({ id: p.id, name: p.name, score: p.score })),
    bestDrawer: bestDrawer && bestDrawer.pointsAsDrawer > 0 ? bestDrawer.name : null,
    fastestGuesser: fastest && fastest.fastestCount > 0 ? fastest.name : null
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
  room.players.forEach(p => {
    p.score = 0;
    p.guessedThisRound = false;
    p.streak = 0;
    p.fastestCount = 0;
    p.pointsAsDrawer = 0;
  });
  broadcastPlayers(room);
  io.to(room.code).emit('back-to-lobby', { wordPack: room.wordPack });
}

function sendResumeState(socket, room, player) {
  socket.emit('room-joined', {
    code: room.code,
    you: player.token,
    hostToken: room.hostToken,
    players: publicPlayers(room),
    wordPack: room.wordPack,
    gameState: room.state
  });

  if (room.state === 'lobby') return;

  if (room.state === 'choosing' || room.state === 'drawing') {
    const drawer = currentDrawer(room);
    socket.emit('choosing', {
      drawerId: drawer.id,
      drawerName: drawer.name,
      roundNumber: room.roundNumber,
      totalRounds: room.totalRounds,
      chooseSeconds: CHOOSE_SECONDS
    });
    if (room.state === 'drawing') {
      socket.emit('round-start', {
        drawerId: drawer.id,
        drawerName: drawer.name,
        maskedWord: room.maskedWord,
        wordLength: room.currentWord ? room.currentWord.length : 0,
        timeLeft: room.timeLeft,
        roundNumber: room.roundNumber,
        totalRounds: room.totalRounds
      });
      room.drawingHistory.forEach(stroke => socket.emit('draw-data', stroke));
      if (drawer.token === player.token) socket.emit('your-word', { word: room.currentWord });
    } else if (drawer.token === player.token) {
      socket.emit('choose-word', { options: room.wordOptions });
    }
  } else if (room.state === 'roundEnd') {
    socket.emit('round-end', { word: room.currentWord, reason: 'resumed', players: publicPlayers(room) });
  } else if (room.state === 'gameEnd') {
    const final = [...room.players].sort((a, b) => b.score - a.score);
    socket.emit('game-end', { players: final.map(p => ({ id: p.id, name: p.name, score: p.score })) });
  }
}

io.on('connection', socket => {
  socket.on('create-room', ({ name, token }) => {
    const code = makeRoomCode();
    const room = {
      code,
      players: [],
      hostToken: token,
      state: 'lobby',
      currentDrawerIndex: -1,
      currentWord: null,
      maskedWord: null,
      roundNumber: 0,
      totalRounds: 0,
      timer: null,
      timeLeft: 0,
      wordOptions: [],
      drawingHistory: [],
      hintsSent: 0,
      wordPack: 'english',
      customWords: [],
      usedWords: new Set(),
      firstGuesserToken: null
    };
    const player = newPlayer(token, socket.id, name);
    room.players.push(player);
    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.token = token;
    socket.emit('room-joined', {
      code, you: token, hostToken: room.hostToken, players: publicPlayers(room), wordPack: room.wordPack, gameState: room.state
    });
  });

  socket.on('join-room', ({ name, code, token }) => {
    code = (code || '').trim().toUpperCase();
    const room = rooms[code];
    if (!room) return socket.emit('join-error', { message: 'Room not found. Check the code and try again.' });

    const existing = room.players.find(p => p.token === token);
    if (existing) {
      // reconnect
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

    const player = newPlayer(token, socket.id, name);
    room.players.push(player);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.token = token;
    socket.emit('room-joined', {
      code, you: token, hostToken: room.hostToken, players: publicPlayers(room), wordPack: room.wordPack, gameState: room.state
    });
    broadcastPlayers(room);
  });

  socket.on('set-word-pack', ({ pack, customWords }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostToken !== socket.data.token || room.state !== 'lobby') return;
    if (!['english', 'arabic', 'custom'].includes(pack)) return;
    room.wordPack = pack;
    if (pack === 'custom') {
      const cleaned = (customWords || [])
        .map(w => String(w).trim())
        .filter(w => w.length >= 2 && w.length <= 24);
      if (cleaned.length < 5) return socket.emit('join-error', { message: 'Add at least 5 custom words.' });
      room.customWords = cleaned;
    }
    room.usedWords = new Set();
    io.to(room.code).emit('word-pack-update', { wordPack: room.wordPack, customCount: room.customWords.length });
  });

  socket.on('start-game', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostToken !== socket.data.token) return;
    if (connectedCount(room) < 2) return socket.emit('join-error', { message: 'Need at least 2 players to start.' });
    room.totalRounds = connectedCount(room) * ROUNDS_PER_PLAYER;
    room.currentDrawerIndex = -1;
    room.roundNumber = 0;
    room.usedWords = new Set();
    room.players.forEach(p => { p.score = 0; p.streak = 0; p.fastestCount = 0; p.pointsAsDrawer = 0; });
    startChoosing(room);
  });

  socket.on('word-chosen', ({ word }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'choosing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.token !== socket.data.token) return;
    if (!room.wordOptions.includes(word)) return;
    startDrawing(room, word);
  });

  socket.on('draw-data', data => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.token !== socket.data.token) return;
    room.drawingHistory.push(data);
    if (room.drawingHistory.length > 4000) room.drawingHistory.shift();
    socket.to(room.code).emit('draw-data', data);
  });

  socket.on('clear-canvas', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.token !== socket.data.token) return;
    room.drawingHistory = [];
    io.to(room.code).emit('clear-canvas');
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
      let points = Math.max(10, Math.round(100 * (room.timeLeft / ROUND_SECONDS)));
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
      drawer.score += 15;
      drawer.pointsAsDrawer += 15;

      const tag = fastest ? '🥇 ' : '';
      io.to(room.code).emit('system-message', { text: `${tag}${player.name} guessed the word! (+${points})` });
      socket.emit('guess-result', { correct: true, points, fastest, streak: player.streak });
      broadcastPlayers(room);

      const everyoneGuessed = room.players
        .filter(p => p.connected && p.token !== drawer.token)
        .every(p => p.guessedThisRound);
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

    if (connectedCount(room) === 0) {
      clearRoomTimer(room);
      return;
    }

    if (wasDrawer && (room.state === 'drawing' || room.state === 'choosing')) {
      endRound(room, 'drawer-left');
    }
  }
});

server.listen(PORT, () => {
  console.log(`Doodle Duel server running on port ${PORT}`);
});
