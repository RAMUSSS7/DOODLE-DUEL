const socket = io();

// ---------- Persistent identity (for auto-reconnect) ----------
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
let myToken = localStorage.getItem('dd_token');
if (!myToken) { myToken = uuid(); localStorage.setItem('dd_token', myToken); }
const savedRoom = localStorage.getItem('dd_room');
const savedName = localStorage.getItem('dd_name') || '';

let hostToken = null;
let roomCode = null;
let isDrawer = false;
let currentWordLength = 0;
let currentColor = '#2c2a24';
let currentSize = 4;
let erasing = false;
let drawing = false;
let lastPoint = null;
let myScoreCache = 0;

const COLORS = ['#2c2a24', '#ff6b6b', '#ffcf4d', '#5aa9ff', '#4fd6b0', '#a86bff', '#ff9f4d', '#ffffff'];
const REACTIONS = ['😂', '🔥', '👏', '😮', '❤️', '🤔'];

// ---------- Screen helpers ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function showOverlay(id) { document.getElementById(id).classList.remove('hidden'); }
function hideOverlay(id) { document.getElementById(id).classList.add('hidden'); }

// ---------- Home screen ----------
const nameInput = document.getElementById('name-input');
const codeInput = document.getElementById('code-input');
const homeError = document.getElementById('home-error');
nameInput.value = savedName;

document.getElementById('create-room-btn').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) return (homeError.textContent = 'Type your name first.');
  homeError.textContent = '';
  localStorage.setItem('dd_name', name);
  socket.emit('create-room', { name, token: myToken });
});

document.getElementById('join-room-btn').addEventListener('click', () => {
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  if (!name) return (homeError.textContent = 'Type your name first.');
  if (!code) return (homeError.textContent = 'Type a room code.');
  homeError.textContent = '';
  localStorage.setItem('dd_name', name);
  socket.emit('join-room', { name, code, token: myToken });
});

socket.on('join-error', ({ message }) => {
  homeError.textContent = message;
  document.getElementById('reconnect-msg').classList.add('hidden');
});

// ---------- Auto-reconnect on load / socket reconnect ----------
function attemptAutoRejoin() {
  const room = localStorage.getItem('dd_room');
  const name = localStorage.getItem('dd_name');
  if (room && name) {
    document.getElementById('reconnect-msg').classList.remove('hidden');
    socket.emit('join-room', { name, code: room, token: myToken });
  }
}
socket.on('connect', () => {
  attemptAutoRejoin();
});

// ---------- Lobby ----------
socket.on('room-joined', ({ code, you, hostToken: hT, players, wordPack, gameState }) => {
  hostToken = hT;
  roomCode = code;
  localStorage.setItem('dd_room', code);
  document.getElementById('room-code-display').textContent = code;
  document.getElementById('reconnect-msg').classList.add('hidden');
  setWordPackUI(wordPack);
  if (gameState === 'lobby') showScreen('screen-lobby');
  renderPlayerList(players);
});

document.getElementById('start-game-btn').addEventListener('click', () => {
  socket.emit('start-game');
});

document.getElementById('leave-room-btn').addEventListener('click', () => {
  socket.emit('leave-room');
  localStorage.removeItem('dd_room');
  location.reload();
});

socket.on('back-to-lobby', ({ wordPack }) => {
  showScreen('screen-lobby');
  setWordPackUI(wordPack);
});

socket.on('players-update', ({ players, hostToken: hT }) => {
  hostToken = hT;
  renderPlayerList(players);
  const iAmHost = myToken === hostToken;
  document.getElementById('start-game-btn').style.display = iAmHost ? 'block' : 'none';
  document.getElementById('lobby-hint').style.display = iAmHost ? 'none' : 'block';
  document.getElementById('lobby-count').textContent = `(${players.length})`;
  document.getElementById('wordpack-picker').style.display = iAmHost ? 'block' : 'none';
});

function renderPlayerList(players) {
  const lists = [document.getElementById('lobby-player-list'), document.getElementById('game-player-list')];
  lists.forEach(list => {
    if (!list) return;
    list.innerHTML = '';
    players.forEach((p, i) => {
      const li = document.createElement('li');
      if (p.isDrawer) li.classList.add('is-drawer');
      if (p.guessed) li.classList.add('has-guessed');
      if (!p.connected) li.classList.add('disconnected');
      const dot = `<span class="avatar-dot" style="background:${COLORS[i % COLORS.length]}"></span>`;
      const streakTag = p.streak >= 2 ? ` <span class="streak-tag">🔥${p.streak}</span>` : '';
      const offlineTag = !p.connected ? ' <span class="offline-tag">(reconnecting…)</span>' : '';
      li.innerHTML = `<span class="p-name">${dot}${escapeHtml(p.name)}${streakTag}${offlineTag}</span><span class="p-score">${p.score}</span>`;
      list.appendChild(li);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Word pack picker (host only, lobby only) ----------
const packSelect = document.getElementById('wordpack-select');
const customBox = document.getElementById('custom-words-box');
packSelect.addEventListener('change', () => {
  customBox.classList.toggle('hidden', packSelect.value !== 'custom');
});
document.getElementById('save-wordpack-btn').addEventListener('click', () => {
  const pack = packSelect.value;
  const customWords = document.getElementById('custom-words-input').value
    .split(',').map(w => w.trim()).filter(Boolean);
  socket.emit('set-word-pack', { pack, customWords });
});
socket.on('word-pack-update', ({ wordPack }) => setWordPackUI(wordPack));
function setWordPackUI(pack) {
  if (!pack) return;
  packSelect.value = pack;
  customBox.classList.toggle('hidden', pack !== 'custom');
}

// ---------- Choosing word ----------
socket.on('choosing', ({ drawerId, drawerName, roundNumber, totalRounds, chooseSeconds }) => {
  showScreen('screen-game');
  resizeCanvas();
  isDrawer = drawerId === socket.id;
  document.getElementById('round-label').textContent = `${roundNumber}/${totalRounds}`;
  document.getElementById('chat-log').innerHTML = '';
  hideOverlay('roundend-overlay');
  clearCanvasLocal();

  document.getElementById('choose-heading').textContent = isDrawer
    ? 'Pick a word to draw'
    : `${drawerName} is choosing a word…`;
  document.getElementById('choose-options').innerHTML = '';
  document.getElementById('toolbar').classList.add('hidden');
  document.getElementById('reaction-bar').classList.add('hidden');
  document.getElementById('drawer-banner').classList.add('hidden');

  let t = chooseSeconds;
  document.getElementById('choose-timer').textContent = t;
  clearInterval(window._chooseTimer);
  window._chooseTimer = setInterval(() => {
    t--;
    document.getElementById('choose-timer').textContent = Math.max(t, 0);
    if (t <= 0) clearInterval(window._chooseTimer);
  }, 1000);

  showOverlay('choose-overlay');
});

socket.on('choose-word', ({ options }) => {
  const box = document.getElementById('choose-options');
  box.innerHTML = '';
  options.forEach(word => {
    const btn = document.createElement('button');
    btn.textContent = word;
    btn.addEventListener('click', () => {
      socket.emit('word-chosen', { word });
      hideOverlay('choose-overlay');
    });
    box.appendChild(btn);
  });
});

// ---------- Round start / drawing ----------
socket.on('round-start', ({ drawerId, drawerName, maskedWord, wordLength, timeLeft, roundNumber, totalRounds }) => {
  hideOverlay('choose-overlay');
  hideOverlay('roundend-overlay');
  resizeCanvas();
  isDrawer = drawerId === socket.id;
  currentWordLength = wordLength;
  document.getElementById('round-label').textContent = `${roundNumber}/${totalRounds}`;
  document.getElementById('word-display').textContent = maskedWord.split('').join(' ');
  setTimerFill(timeLeft);

  const banner = document.getElementById('drawer-banner');
  const toolbar = document.getElementById('toolbar');
  const reactionBar = document.getElementById('reaction-bar');
  const canvas = document.getElementById('draw-canvas');
  if (isDrawer) {
    banner.classList.add('hidden');
    toolbar.classList.remove('hidden');
    reactionBar.classList.add('hidden');
    canvas.style.cursor = 'crosshair';
  } else {
    banner.textContent = `${drawerName} is drawing…`;
    banner.classList.remove('hidden');
    toolbar.classList.add('hidden');
    reactionBar.classList.remove('hidden');
    canvas.style.cursor = 'default';
  }
});

socket.on('your-word', ({ word }) => {
  document.getElementById('word-display').textContent = word.toUpperCase();
});

socket.on('word-hint', ({ maskedWord }) => {
  if (!isDrawer) document.getElementById('word-display').textContent = maskedWord.split('').join(' ');
});

socket.on('tick', ({ timeLeft }) => setTimerFill(timeLeft));

function setTimerFill(timeLeft) {
  const pct = Math.max(0, Math.min(100, (timeLeft / 80) * 100));
  document.getElementById('timer-fill').style.width = pct + '%';
}

// ---------- Round end ----------
socket.on('round-end', ({ word, players }) => {
  renderPlayerList(players);
  document.getElementById('revealed-word').textContent = word.toUpperCase();
  showOverlay('roundend-overlay');
  document.getElementById('toolbar').classList.add('hidden');
  document.getElementById('reaction-bar').classList.add('hidden');
});

// ---------- Game end ----------
socket.on('game-end', ({ players, bestDrawer, fastestGuesser }) => {
  showScreen('screen-end');
  localStorage.removeItem('dd_room');
  const board = document.getElementById('final-scoreboard');
  board.innerHTML = '';
  players.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span><span class="rank">#${i + 1}</span>${escapeHtml(p.name)}${i === 0 ? ' 🏆' : ''}</span><span>${p.score}</span>`;
    board.appendChild(li);
  });
  const badges = document.getElementById('end-badges');
  badges.innerHTML = '';
  if (bestDrawer) badges.innerHTML += `<div class="badge">🎨 Best Drawer: <b>${escapeHtml(bestDrawer)}</b></div>`;
  if (fastestGuesser) badges.innerHTML += `<div class="badge">⚡ Fastest Guesser: <b>${escapeHtml(fastestGuesser)}</b></div>`;
  launchConfetti();
  playWinJingle();
});

document.getElementById('play-again-btn').addEventListener('click', () => socket.emit('play-again'));
document.getElementById('back-home-btn').addEventListener('click', () => {
  socket.emit('leave-room');
  localStorage.removeItem('dd_room');
  location.reload();
});

// ---------- Chat / guessing ----------
const chatLog = document.getElementById('chat-log');
document.getElementById('guess-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('guess-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('guess', { text });
  input.value = '';
});

socket.on('chat-message', ({ name, text }) => addChat(`<span class="who">${escapeHtml(name)}:</span>${escapeHtml(text)}`));
socket.on('system-message', ({ text }) => addChat(escapeHtml(text), true));
socket.on('guess-result', ({ correct, points, fastest, streak }) => {
  if (correct) {
    let msg = `🎉 You guessed it! +${points} points`;
    if (fastest) msg += ' — Fastest! 🥇';
    if (streak >= 2) msg += ` — 🔥 ${streak} streak!`;
    addChat(msg, true);
  }
});

function addChat(html, isSystem) {
  const div = document.createElement('div');
  div.className = 'msg' + (isSystem ? ' system' : '');
  div.innerHTML = html;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ---------- Emoji reactions ----------
const reactionBar = document.getElementById('reaction-bar');
REACTIONS.forEach(emoji => {
  const btn = document.createElement('button');
  btn.className = 'reaction-btn';
  btn.textContent = emoji;
  btn.addEventListener('click', () => socket.emit('reaction', { emoji }));
  reactionBar.appendChild(btn);
});

socket.on('reaction', ({ emoji }) => {
  const paper = document.querySelector('.canvas-paper');
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = (10 + Math.random() * 80) + '%';
  paper.appendChild(el);
  setTimeout(() => el.remove(), 1600);
});

// ---------- Canvas drawing ----------
const canvas = document.getElementById('draw-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const imgData = canvas.width ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
  canvas.width = rect.width;
  canvas.height = rect.height;
  if (imgData) ctx.putImageData(imgData, 0, 0);
  else clearCanvasLocal();
}
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 50);

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const evt = e.touches ? e.touches[0] : e;
  return {
    x: (evt.clientX - rect.left) / rect.width,
    y: (evt.clientY - rect.top) / rect.height
  };
}

function localDraw(from, to, color, size) {
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
  ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
  ctx.stroke();
}

function startDraw(e) {
  if (!isDrawer) return;
  drawing = true;
  lastPoint = getPos(e);
}
function moveDraw(e) {
  if (!isDrawer || !drawing) return;
  e.preventDefault();
  const pos = getPos(e);
  const color = erasing ? '#faf3e2' : currentColor;
  localDraw(lastPoint, pos, color, currentSize);
  socket.emit('draw-data', { from: lastPoint, to: pos, color, size: currentSize });
  lastPoint = pos;
}
function endDraw() { drawing = false; lastPoint = null; }

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', moveDraw);
window.addEventListener('mouseup', endDraw);
canvas.addEventListener('touchstart', e => { e.preventDefault(); startDraw(e); }, { passive: false });
canvas.addEventListener('touchmove', moveDraw, { passive: false });
canvas.addEventListener('touchend', endDraw);

socket.on('draw-data', ({ from, to, color, size }) => localDraw(from, to, color, size));
socket.on('clear-canvas', clearCanvasLocal);

function clearCanvasLocal() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#faf3e2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ---------- Toolbar ----------
const swatchBox = document.getElementById('color-swatches');
COLORS.forEach((c, i) => {
  const sw = document.createElement('div');
  sw.className = 'color-swatch' + (i === 0 ? ' active' : '');
  sw.style.background = c;
  sw.addEventListener('click', () => {
    currentColor = c;
    erasing = false;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    document.getElementById('eraser-btn').classList.remove('active');
  });
  swatchBox.appendChild(sw);
});

document.getElementById('brush-small').addEventListener('click', () => { currentSize = 4; setActiveBrush('brush-small'); });
document.getElementById('brush-large').addEventListener('click', () => { currentSize = 14; setActiveBrush('brush-large'); });
function setActiveBrush(id) {
  document.getElementById('brush-small').classList.toggle('active', id === 'brush-small');
  document.getElementById('brush-large').classList.toggle('active', id === 'brush-large');
}
document.getElementById('eraser-btn').addEventListener('click', () => {
  erasing = !erasing;
  document.getElementById('eraser-btn').classList.toggle('active', erasing);
});
document.getElementById('clear-btn').addEventListener('click', () => {
  clearCanvasLocal();
  socket.emit('clear-canvas');
});

// ---------- Confetti + win sound (no external libraries) ----------
function launchConfetti() {
  const colors = ['#ff6b6b', '#ffcf4d', '#5aa9ff', '#4fd6b0', '#a86bff'];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (2 + Math.random() * 1.5) + 's';
    piece.style.animationDelay = (Math.random() * 0.5) + 's';
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
}

let audioCtx = null;
function playWinJingle() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.value = 0.12;
      o.connect(g); g.connect(audioCtx.destination);
      const startTime = audioCtx.currentTime + i * 0.15;
      o.start(startTime);
      g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);
      o.stop(startTime + 0.4);
    });
  } catch (e) {}
}
