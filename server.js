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

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const ROUND_SECONDS = 80;
const ROUNDS_PER_PLAYER = 2;
const MAX_PLAYERS = 8;
const CHOOSE_SECONDS = 10;
const HINT_FRACTIONS = [0.6, 0.35, 0.15]; // reveal a letter at these fractions of time remaining

const WORDS = [
  'guitar','elephant','pizza','rainbow','robot','castle','dragon','umbrella','bicycle','volcano',
  'penguin','sandwich','rocket','ghost','octopus','waterfall','cactus','lighthouse','skateboard','dinosaur',
  'butterfly','snowman','pirate','telescope','mushroom','kangaroo','campfire','helicopter','jellyfish','pumpkin',
  'wizard','tornado','sunglasses','backpack','fountain','saxophone','pretzel','cupcake','anchor','compass',
  'igloo','mermaid','tractor','windmill','beehive','scarecrow','submarine','waffle','flamingo','koala',
  'astronaut','campground','lantern','peacock','avalanche','bonfire','canoe','drum','earthquake','feather',
  'glacier','hammock','iceberg','jukebox','kite','lava','moose','nest','oasis','pancake',
  'quicksand','raccoon','saddle','treehouse','unicorn','vampire','walrus','xylophone','yeti','zeppelin',
  'chess','fireworks','harmonica','jigsaw','labyrinth','mosaic','narwhal','origami','pyramid','quill',
  'satellite','trampoline','volcano eruption','wheelbarrow','yo-yo','zipline','snorkel','periscope','popcorn','marshmallow'
];

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

function publicPlayers(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
    isDrawer: room.state === 'drawing' || room.state === 'choosing'
      ? room.players[room.currentDrawerIndex] && room.players[room.currentDrawerIndex].id === p.id
      : false,
    guessed: !!p.guessedThisRound
  }));
}

function broadcastPlayers(room) {
  io.to(room.code).emit('players-update', {
    players: publicPlayers(room),
    hostId: room.hostId
  });
}

function maskWord(word) {
  return word.split('').map(ch => (ch === ' ' ? ' ' : '_')).join('');
}

function pickWordOptions() {
  const pool = [...WORDS];
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

function startChoosing(room) {
  clearRoomTimer(room);
  room.roundNumber++;
  if (room.roundNumber > room.totalRounds || connectedCount(room) < 2) {
    return endGame(room);
  }

  // advance to next connected drawer
  let attempts = 0;
  do {
    room.currentDrawerIndex = (room.currentDrawerIndex + 1) % room.players.length;
    attempts++;
  } while (!room.players[room.currentDrawerIndex].connected && attempts <= room.players.length);

  room.players.forEach(p => (p.guessedThisRound = false));
  room.state = 'choosing';
  room.wordOptions = pickWordOptions();
  room.drawingHistory = [];
  room.hintsSent = 0;

  const drawer = currentDrawer(room);

  io.to(room.code).emit('choosing', {
    drawerId: drawer.id,
    drawerName: drawer.name,
    roundNumber: room.roundNumber,
    totalRounds: room.totalRounds,
    chooseSeconds: CHOOSE_SECONDS
  });
  io.to(drawer.id).emit('choose-word', { options: room.wordOptions });

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
  room.maskedWord = maskWord(word);
  room.timeLeft = ROUND_SECONDS;
  room.drawingHistory = [];
  const drawer = currentDrawer(room);

  io.to(room.code).emit('round-start', {
    drawerId: drawer.id,
    drawerName: drawer.name,
    maskedWord: room.maskedWord,
    timeLeft: room.timeLeft,
    roundNumber: room.roundNumber,
    totalRounds: room.totalRounds
  });
  io.to(drawer.id).emit('your-word', { word });
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
  io.to(room.code).emit('game-end', {
    players: final.map(p => ({ id: p.id, name: p.name, score: p.score }))
  });
}

function resetGame(room) {
  clearRoomTimer(room);
  room.state = 'lobby';
  room.currentDrawerIndex = -1;
  room.roundNumber = 0;
  room.currentWord = null;
  room.maskedWord = null;
  room.players.forEach(p => (p.score = 0, p.guessedThisRound = false));
  broadcastPlayers(room);
  io.to(room.code).emit('back-to-lobby');
}

io.on('connection', socket => {
  socket.on('create-room', ({ name }) => {
    const code = makeRoomCode();
    const room = {
      code,
      players: [],
      hostId: socket.id,
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
      hintsSent: 0
    };
    room.players.push({ id: socket.id, name: (name || 'Player').slice(0, 16), score: 0, connected: true, guessedThisRound: false });
    rooms[code] = room;
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('room-joined', { code, you: socket.id, hostId: room.hostId, players: publicPlayers(room) });
  });

  socket.on('join-room', ({ name, code }) => {
    code = (code || '').trim().toUpperCase();
    const room = rooms[code];
    if (!room) return socket.emit('join-error', { message: 'Room not found. Check the code and try again.' });
    if (connectedCount(room) >= MAX_PLAYERS) return socket.emit('join-error', { message: 'This room is full.' });

    room.players.push({ id: socket.id, name: (name || 'Player').slice(0, 16), score: 0, connected: true, guessedThisRound: false });
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('room-joined', { code, you: socket.id, hostId: room.hostId, players: publicPlayers(room) });
    broadcastPlayers(room);

    if (room.state === 'drawing' && room.maskedWord) {
      socket.emit('round-start', {
        drawerId: currentDrawer(room).id,
        drawerName: currentDrawer(room).name,
        maskedWord: room.maskedWord,
        timeLeft: room.timeLeft,
        roundNumber: room.roundNumber,
        totalRounds: room.totalRounds
      });
      room.drawingHistory.forEach(stroke => socket.emit('draw-data', stroke));
    }
  });

  socket.on('start-game', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (connectedCount(room) < 2) return socket.emit('join-error', { message: 'Need at least 2 players to start.' });
    room.totalRounds = connectedCount(room) * ROUNDS_PER_PLAYER;
    room.currentDrawerIndex = -1;
    room.roundNumber = 0;
    room.players.forEach(p => (p.score = 0));
    startChoosing(room);
  });

  socket.on('word-chosen', ({ word }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'choosing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.id !== socket.id) return;
    if (!room.wordOptions.includes(word)) return;
    startDrawing(room, word);
  });

  socket.on('draw-data', data => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.id !== socket.id) return;
    room.drawingHistory.push(data);
    if (room.drawingHistory.length > 4000) room.drawingHistory.shift();
    socket.to(room.code).emit('draw-data', data);
  });

  socket.on('clear-canvas', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing') return;
    const drawer = currentDrawer(room);
    if (!drawer || drawer.id !== socket.id) return;
    room.drawingHistory = [];
    io.to(room.code).emit('clear-canvas');
  });

  socket.on('guess', ({ text }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.state !== 'drawing' || !text) return;
    const player = room.players.find(p => p.id === socket.id);
    const drawer = currentDrawer(room);
    if (!player || !drawer || player.id === drawer.id || player.guessedThisRound) return;

    const clean = text.trim().toLowerCase();
    if (clean === room.currentWord.toLowerCase()) {
      player.guessedThisRound = true;
      const points = Math.max(10, Math.round(100 * (room.timeLeft / ROUND_SECONDS)));
      player.score += points;
      drawer.score += 15;
      io.to(room.code).emit('system-message', { text: `${player.name} guessed the word! (+${points})` });
      socket.emit('guess-result', { correct: true, points });
      broadcastPlayers(room);

      const everyoneGuessed = room.players
        .filter(p => p.connected && p.id !== drawer.id)
        .every(p => p.guessedThisRound);
      if (everyoneGuessed) endRound(room, 'all-guessed');
    } else {
      io.to(room.code).emit('chat-message', { name: player.name, text });
    }
  });

  socket.on('play-again', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.hostId !== socket.id) return;
    resetGame(room);
  });

  socket.on('leave-room', () => handleDisconnect(socket));
  socket.on('disconnect', () => handleDisconnect(socket));

  function handleDisconnect(socket) {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.connected = false;

    if (room.hostId === socket.id) {
      const nextHost = room.players.find(p => p.connected);
      if (nextHost) room.hostId = nextHost.id;
    }

    const wasDrawer = currentDrawer(room) && currentDrawer(room).id === socket.id;
    broadcastPlayers(room);

    if (connectedCount(room) === 0) {
      clearRoomTimer(room);
      setTimeout(() => {
        if (rooms[code] && connectedCount(rooms[code]) === 0) delete rooms[code];
      }, 60000);
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
