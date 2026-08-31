const socket = io();

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
let myToken = localStorage.getItem('dd_token');
if (!myToken) { myToken = uuid(); localStorage.setItem('dd_token', myToken); }
const savedName = localStorage.getItem('dd_name') || '';

let hostToken = null;
let isDrawer = false;
let currentColor = '#2c2a24';
let currentSize = 4;
let erasing = false;
let drawing = false;
let lastPoint = null;
let currentTool = 'pen'; // pen | rect | circle | line | fill
let shapeStart = null;

const COLORS = ['#2c2a24', '#ff6b6b', '#ffcf4d', '#5aa9ff', '#4fd6b0', '#a86bff', '#ff9f4d', '#ffffff'];
const REACTIONS = ['😂', '🔥', '👏', '😮', '❤️', '🤔'];

// ---------- Theme ----------
const savedTheme = localStorage.getItem('dd_theme') || 'dark';
if (savedTheme === 'light') document.body.classList.add('theme-light');
document.getElementById('theme-toggle-inline').addEventListener('click', () => {
  document.body.classList.toggle('theme-light');
  localStorage.setItem('dd_theme', document.body.classList.contains('theme-light') ? 'light' : 'dark');
});

// ---------- Sound & motion preferences ----------
let soundEnabled = localStorage.getItem('dd_sound') !== 'off';
let reduceMotion = localStorage.getItem('dd_reduce_motion') === 'on';
document.getElementById('sound-toggle').checked = soundEnabled;
document.getElementById('reduce-motion-toggle').checked = reduceMotion;
document.getElementById('sound-toggle').addEventListener('change', e => {
  soundEnabled = e.target.checked;
  localStorage.setItem('dd_sound', soundEnabled ? 'on' : 'off');
});
document.getElementById('reduce-motion-toggle').addEventListener('change', e => {
  reduceMotion = e.target.checked;
  localStorage.setItem('dd_reduce_motion', reduceMotion ? 'on' : 'off');
});

// ---------- Slide-out menu ----------
const menuDrawer = document.getElementById('menu-drawer');
const menuBackdrop = document.getElementById('menu-backdrop');
document.getElementById('menu-toggle-btn').addEventListener('click', () => {
  menuDrawer.classList.add('open');
  menuBackdrop.classList.remove('hidden');
  updateLeaveRoomVisibility();
});
function closeMenu() {
  menuDrawer.classList.remove('open');
  menuBackdrop.classList.add('hidden');
  showMenuView('main');
}
document.getElementById('menu-close-btn').addEventListener('click', closeMenu);
menuBackdrop.addEventListener('click', closeMenu);

function showMenuView(name) {
  document.querySelectorAll('.menu-view').forEach(v => v.classList.add('hidden'));
  document.getElementById('menu-view-' + name).classList.remove('hidden');
  if (name === 'stats') renderAchievementsGrid();
}
document.querySelectorAll('.menu-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => showMenuView(btn.dataset.view));
});
document.querySelectorAll('.menu-back-btn').forEach(btn => {
  btn.addEventListener('click', () => showMenuView('main'));
});

function updateLeaveRoomVisibility() {
  const inRoom = ['screen-lobby', 'screen-game', 'screen-end'].some(id => document.getElementById(id).classList.contains('active'));
  document.getElementById('menu-leave-room-btn').classList.toggle('hidden', !inRoom);
}
document.getElementById('menu-leave-room-btn').addEventListener('click', () => {
  socket.emit('leave-room');
  localStorage.removeItem('dd_room');
  location.reload();
});

// ---------- Screen helpers ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function showOverlay(id) { document.getElementById(id).classList.remove('hidden'); }
function hideOverlay(id) { document.getElementById(id).classList.add('hidden'); }
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

// ---------- Toast (achievements) ----------
function showToast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 20);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3200);
}

// ---------- Level / XP (local to this browser) ----------
function getXP() { return parseInt(localStorage.getItem('dd_xp') || '0', 10); }
function levelFromXP(xp) { return Math.floor(Math.sqrt(xp / 40)) + 1; }
function renderLevelBadge() {
  const xp = getXP();
  const lvl = levelFromXP(xp);
  const text = `Lv.${lvl} • ${xp} XP`;
  document.getElementById('level-badge').textContent = text;
  const menuLine = document.getElementById('menu-level-line');
  if (menuLine) menuLine.textContent = text;
}
function addXP(amount) {
  const xp = getXP() + Math.max(0, Math.round(amount));
  localStorage.setItem('dd_xp', xp);
  renderLevelBadge();
}

// ---------- Achievements ----------
const ACHIEVEMENTS = [
  { id: 'first_win', icon: '🏆', label: 'First Victory', desc: 'Finish a game in 1st place.' },
  { id: 'streak3', icon: '🔥', label: 'On Fire', desc: 'Guess correctly 3 rounds in a row.' },
  { id: 'fast_guesser', icon: '⚡', label: 'Lightning Guesser', desc: 'Guess a word almost instantly.' },
  { id: 'fill_master', icon: '🪣', label: 'Bucket Master', desc: 'Use the fill tool while drawing.' },
  { id: 'artist', icon: '🖌️', label: 'Shape Artist', desc: 'Use a shape tool while drawing.' }
];
function unlockAchievement(id, label) {
  const list = JSON.parse(localStorage.getItem('dd_achievements') || '[]');
  if (list.includes(id)) return;
  list.push(id);
  localStorage.setItem('dd_achievements', JSON.stringify(list));
  showToast('🏅 Achievement unlocked: ' + label);
}
function renderAchievementsGrid() {
  const unlocked = JSON.parse(localStorage.getItem('dd_achievements') || '[]');
  const grid = document.getElementById('achievements-grid');
  grid.innerHTML = '';
  ACHIEVEMENTS.forEach(a => {
    const isUnlocked = unlocked.includes(a.id);
    const row = document.createElement('div');
    row.className = 'achievement-item' + (isUnlocked ? ' unlocked' : '');
    row.innerHTML = `<span class="ach-icon">${a.icon}</span><span><b>${a.label}</b><br>${a.desc}</span>`;
    grid.appendChild(row);
  });
}

renderLevelBadge();

// ---------- Home screen ----------
const nameInput = document.getElementById('name-input');
const codeInput = document.getElementById('code-input');
const homeError = document.getElementById('home-error');
nameInput.value = savedName;

document.getElementById('goto-settings-btn').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) return (homeError.textContent = 'Type your name first.');
  homeError.textContent = '';
  showScreen('screen-settings');
});
document.getElementById('settings-back-btn').addEventListener('click', () => showScreen('screen-home'));

document.getElementById('create-room-btn').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) { showScreen('screen-home'); homeError.textContent = 'Type your name first.'; return; }
  localStorage.setItem('dd_name', name);
  const wordPack = packSelect.value;
  const customWords = wordPack === 'custom'
    ? document.getElementById('custom-words-input').value.split(',').map(w => w.trim()).filter(Boolean)
    : [];
  if (wordPack === 'custom' && customWords.length < 5) {
    alert('Add at least 5 custom words (separated by commas) or pick a different word pack.');
    return;
  }
  const difficulty = document.querySelector('input[name="difficulty"]:checked').value;
  const speedRoundEnabled = document.getElementById('speed-round-checkbox').checked;
  const teamMode = document.getElementById('team-mode-checkbox').checked;
  const isPublic = document.getElementById('public-room-checkbox').checked;
  socket.emit('create-room', { name, token: myToken, isPublic, wordPack, customWords, difficulty, speedRoundEnabled, teamMode });
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

// ---------- Word pack UI helpers (used on the settings screen) ----------
const packSelect = document.getElementById('wordpack-select');
const customBox = document.getElementById('custom-words-box');
packSelect.addEventListener('change', () => customBox.classList.toggle('hidden', packSelect.value !== 'custom'));

// ---------- Browse public rooms ----------
document.getElementById('browse-rooms-btn').addEventListener('click', () => {
  socket.emit('list-public-rooms');
  showOverlay('browse-overlay');
});
document.getElementById('browse-close-btn').addEventListener('click', () => hideOverlay('browse-overlay'));
socket.on('public-rooms-list', ({ rooms }) => {
  const list = document.getElementById('public-rooms-list');
  list.innerHTML = '';
  if (!rooms.length) {
    list.innerHTML = '<p class="hint-text">No public rooms right now. Create your own!</p>';
    return;
  }
  rooms.forEach(r => {
    const row = document.createElement('div');
    row.className = 'public-room-row';
    row.innerHTML = `<span>${escapeHtml(r.host)}'s room <b>${r.code}</b> (${r.count}/8)</span>`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary btn-small';
    btn.textContent = 'Join';
    btn.addEventListener('click', () => {
      const name = nameInput.value.trim() || 'Player';
      localStorage.setItem('dd_name', name);
      socket.emit('join-room', { name, code: r.code, token: myToken });
      hideOverlay('browse-overlay');
    });
    row.appendChild(btn);
    list.appendChild(row);
  });
});

// ---------- Auto-reconnect ----------
function attemptAutoRejoin() {
  const room = localStorage.getItem('dd_room');
  const name = localStorage.getItem('dd_name');
  if (room && name) {
    document.getElementById('reconnect-msg').classList.remove('hidden');
    socket.emit('join-room', { name, code: room, token: myToken });
  }
}
socket.on('connect', () => attemptAutoRejoin());

// ---------- Lobby ----------
socket.on('room-joined', ({ code, hostToken: hT, players, wordPack, gameState, teamMode, isPublic, difficulty, speedRoundEnabled }) => {
  hostToken = hT;
  localStorage.setItem('dd_room', code);
  document.getElementById('room-code-display').textContent = code;
  document.getElementById('reconnect-msg').classList.add('hidden');
  document.getElementById('public-room-lobby-tag').classList.toggle('hidden', !isPublic);
  renderSettingsSummary(wordPack, teamMode, difficulty, speedRoundEnabled);
  if (gameState === 'lobby') showScreen('screen-lobby');
  renderPlayerList(players);
});

document.getElementById('start-game-btn').addEventListener('click', () => socket.emit('start-game'));
document.getElementById('leave-room-btn').addEventListener('click', () => {
  socket.emit('leave-room');
  localStorage.removeItem('dd_room');
  location.reload();
});

socket.on('back-to-lobby', ({ wordPack, teamMode, difficulty, speedRoundEnabled }) => {
  showScreen('screen-lobby');
  renderSettingsSummary(wordPack, teamMode, difficulty, speedRoundEnabled);
});

function renderSettingsSummary(wordPack, teamMode, difficulty, speedRoundEnabled) {
  const packLabel = { english: '📖 English', arabic: '📖 العربية', custom: '📖 Custom words' }[wordPack] || '📖 English';
  const diffLabel = { mixed: '🎲 Mixed', easy: '🟢 Easy', medium: '🟡 Medium', hard: '🔴 Hard' }[difficulty] || '🎲 Mixed';
  const speedLabel = speedRoundEnabled ? '⚡ Speed round: On' : '⚡ Speed round: Off';
  const teamLabel = teamMode ? '👥 Team mode: On' : '👥 Team mode: Off';
  document.getElementById('lobby-settings-summary').textContent = `${packLabel} • ${diffLabel} • ${speedLabel} • ${teamLabel}`;
}

socket.on('players-update', ({ players, hostToken: hT, teamMode, teams }) => {
  hostToken = hT;
  renderPlayerList(players, teamMode, teams);
  const iAmHost = myToken === hostToken;
  document.getElementById('start-game-btn').style.display = iAmHost ? 'block' : 'none';
  document.getElementById('lobby-hint').style.display = iAmHost ? 'none' : 'block';
  document.getElementById('lobby-count').textContent = `(${players.length})`;
});

function renderPlayerList(players, teamMode, teams) {
  const lists = [document.getElementById('lobby-player-list'), document.getElementById('game-player-list')];
  lists.forEach(list => {
    if (!list) return;
    list.innerHTML = '';
    players.forEach((p, i) => {
      const li = document.createElement('li');
      if (p.isDrawer) li.classList.add('is-drawer');
      if (p.guessed) li.classList.add('has-guessed');
      if (!p.connected) li.classList.add('disconnected');
      if (p.team) li.classList.add('team-' + p.team);
      const dot = `<span class="avatar-dot" style="background:${COLORS[i % COLORS.length]}"></span>`;
      const streakTag = p.streak >= 2 ? ` <span class="streak-tag">🔥${p.streak}</span>` : '';
      const offlineTag = !p.connected ? ' <span class="offline-tag">(reconnecting…)</span>' : '';
      const teamTag = p.team ? ` <span class="team-tag team-tag-${p.team}">${p.team}</span>` : '';
      li.innerHTML = `<span class="p-name">${dot}${escapeHtml(p.name)}${teamTag}${streakTag}${offlineTag}</span><span class="p-score">${p.score}</span>`;
      list.appendChild(li);
    });
  });
  const teamBar = document.getElementById('team-score-bar');
  if (teamMode && teams) {
    teamBar.classList.remove('hidden');
    teamBar.innerHTML = `<div class="team-score team-score-A">Team A: ${teams.A}</div><div class="team-score team-score-B">Team B: ${teams.B}</div>`;
  } else {
    teamBar.classList.add('hidden');
  }
}

// ---------- Typing indicator ----------
const typingMap = new Map();
let lastTypingEmit = 0;
document.getElementById('guess-input').addEventListener('input', () => {
  const now = Date.now();
  if (now - lastTypingEmit > 1200) { socket.emit('typing'); lastTypingEmit = now; }
});
socket.on('typing', ({ name }) => { typingMap.set(name, Date.now()); renderTyping(); });
setInterval(() => {
  const now = Date.now();
  let changed = false;
  typingMap.forEach((t, name) => { if (now - t > 2500) { typingMap.delete(name); changed = true; } });
  if (changed) renderTyping();
}, 1000);
function renderTyping() {
  const names = [...typingMap.keys()];
  const el = document.getElementById('typing-indicator');
  el.textContent = names.length ? `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…` : '';
}

// ---------- Choosing word ----------
socket.on('choosing', ({ drawerId, drawerName, roundNumber, totalRounds, chooseSeconds, isSpeedRound }) => {
  showScreen('screen-game');
  resizeCanvas();
  isDrawer = drawerId === socket.id;
  document.getElementById('round-label').textContent = isSpeedRound ? '⚡ SPEED ROUND' : `${roundNumber}/${totalRounds}`;
  document.getElementById('chat-log').innerHTML = '';
  hideOverlay('roundend-overlay');
  clearCanvasLocal();
  strokeHistory = [];

  document.getElementById('choose-heading').textContent = isDrawer ? 'Pick a word to draw' : `${drawerName} is choosing a word…`;
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
  const diffLabel = { easy: '🟢 easy', medium: '🟡 medium', hard: '🔴 hard' };
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.innerHTML = `${escapeHtml(opt.word)} <span class="diff-tag">${diffLabel[opt.difficulty] || ''}</span>`;
    btn.addEventListener('click', () => {
      socket.emit('word-chosen', { word: opt.word });
      hideOverlay('choose-overlay');
    });
    box.appendChild(btn);
  });
});

// ---------- Round start / drawing ----------
let timeLeftGlobal = 0;
socket.on('round-start', ({ drawerId, drawerName, maskedWord, wordLength, timeLeft, roundNumber, totalRounds, isSpeedRound }) => {
  hideOverlay('choose-overlay');
  hideOverlay('roundend-overlay');
  resizeCanvas();
  isDrawer = drawerId === socket.id;
  timeLeftGlobal = timeLeft;
  document.getElementById('round-label').textContent = isSpeedRound ? '⚡ SPEED ROUND' : `${roundNumber}/${totalRounds}`;
  document.getElementById('word-display').textContent = maskedWord.split('').join(' ');
  setTimerFill(timeLeft, isSpeedRound ? 30 : 80);

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

socket.on('your-word', ({ word }) => { document.getElementById('word-display').textContent = word.toUpperCase(); });
socket.on('word-hint', ({ maskedWord }) => { if (!isDrawer) document.getElementById('word-display').textContent = maskedWord.split('').join(' '); });
socket.on('tick', ({ timeLeft }) => { timeLeftGlobal = timeLeft; setTimerFill(timeLeft); if (timeLeft <= 10 && timeLeft > 0) playTick(); });

function setTimerFill(timeLeft, total) {
  total = total || 80;
  const pct = Math.max(0, Math.min(100, (timeLeft / total) * 100));
  document.getElementById('timer-fill').style.width = pct + '%';
}

// ---------- Round end ----------
socket.on('round-end', ({ word, players, teams }) => {
  renderPlayerList(players, teams != null, teams);
  document.getElementById('revealed-word').textContent = word.toUpperCase();
  showOverlay('roundend-overlay');
  document.getElementById('toolbar').classList.add('hidden');
  document.getElementById('reaction-bar').classList.add('hidden');
});

// ---------- Game end ----------
socket.on('game-end', ({ players, bestDrawer, fastestGuesser, teamMode, teams }) => {
  hideOverlay('roundend-overlay');
  hideOverlay('choose-overlay');
  showScreen('screen-end');
  localStorage.removeItem('dd_room');
  const board = document.getElementById('final-scoreboard');
  board.innerHTML = '';
  players.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span><span class="rank">#${i + 1}</span>${escapeHtml(p.name)}${i === 0 ? ' 🏆' : ''}</span><span>${p.score}</span>`;
    board.appendChild(li);
    if (p.token === myToken) {
      addXP(Math.round(p.score / 10) + (i === 0 ? 20 : 0));
      if (i === 0) unlockAchievement('first_win', 'First Victory');
    }
  });
  const badges = document.getElementById('end-badges');
  badges.innerHTML = '';
  if (teamMode && teams) {
    const winner = teams.A === teams.B ? 'Tie!' : (teams.A > teams.B ? 'Team A' : 'Team B');
    badges.innerHTML += `<div class="badge">🏳️ Team A: ${teams.A} vs Team B: ${teams.B} — ${escapeHtml(winner)}</div>`;
  }
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
socket.on('guess-result', ({ correct, points, fastest, streak, timeLeft }) => {
  if (correct) {
    let msg = `🎉 You guessed it! +${points} points`;
    if (fastest) msg += ' — Fastest! 🥇';
    if (streak >= 2) msg += ` — 🔥 ${streak} streak!`;
    addChat(msg, true);
    if (streak >= 3) unlockAchievement('streak3', 'On Fire (3 streak)');
    if (fastest && timeLeft >= 65) unlockAchievement('fast_guesser', 'Lightning Guesser');
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
let strokeHistory = []; // local mirror for redraw after resize

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  canvas.width = rect.width;
  canvas.height = rect.height;
  clearCanvasLocal();
  strokeHistory.forEach(renderEntry);
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('resize', () => {
  if (soloPracticeEditor && document.getElementById('screen-solo-practice').classList.contains('active')) soloPracticeEditor.resize();
  if (soloBdEditor && document.getElementById('screen-solo-botdrawer').classList.contains('active')) soloBdEditor.resize();
});
setTimeout(resizeCanvas, 50);

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const evt = e.touches ? e.touches[0] : e;
  return { x: (evt.clientX - rect.left) / rect.width, y: (evt.clientY - rect.top) / rect.height };
}

function localDraw(from, to, color, size) {
  ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
  ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
  ctx.stroke();
}

function drawShapeOnCanvas(shape, x1, y1, x2, y2, color, size) {
  const X1 = x1 * canvas.width, Y1 = y1 * canvas.height, X2 = x2 * canvas.width, Y2 = y2 * canvas.height;
  ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (shape === 'line') { ctx.moveTo(X1, Y1); ctx.lineTo(X2, Y2); }
  else if (shape === 'rect') { ctx.rect(Math.min(X1, X2), Math.min(Y1, Y2), Math.abs(X2 - X1), Math.abs(Y2 - Y1)); }
  else if (shape === 'circle') {
    const rx = Math.abs(X2 - X1) / 2, ry = Math.abs(Y2 - Y1) / 2;
    const cx = Math.min(X1, X2) + rx, cy = Math.min(Y1, Y2) + ry;
    ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
  }
  ctx.stroke();
}

function floodFill(nx, ny, fillColorHex) {
  const x0 = Math.floor(nx * canvas.width), y0 = Math.floor(ny * canvas.height);
  if (x0 < 0 || y0 < 0 || x0 >= canvas.width || y0 >= canvas.height) return;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  const w = canvas.width, h = canvas.height;
  const idx = (x, y) => (y * w + x) * 4;
  const startIdx = idx(x0, y0);
  const target = [data[startIdx], data[startIdx + 1], data[startIdx + 2], data[startIdx + 3]];
  const fill = hexToRgba(fillColorHex);
  if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2]) return;
  const matches = (i) => Math.abs(data[i] - target[0]) < 40 && Math.abs(data[i + 1] - target[1]) < 40 && Math.abs(data[i + 2] - target[2]) < 40;
  const stack = [[x0, y0]];
  let guard = 0;
  while (stack.length && guard < 400000) {
    guard++;
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = idx(x, y);
    if (!matches(i)) continue;
    data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = 255;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  ctx.putImageData(img, 0, 0);
}
function hexToRgba(hex) {
  const v = hex.replace('#', '');
  const bigint = parseInt(v.length === 3 ? v.split('').map(c => c + c).join('') : v, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255, 255];
}

function renderEntry(entry) {
  if (entry.type === 'stroke') localDraw(entry.from, entry.to, entry.color, entry.size);
  else if (entry.type === 'shape') drawShapeOnCanvas(entry.shape, entry.x1, entry.y1, entry.x2, entry.y2, entry.color, entry.size);
  else if (entry.type === 'fill') floodFill(entry.x, entry.y, entry.color);
}

function startDraw(e) {
  if (!isDrawer) return;
  const pos = getPos(e);
  if (currentTool === 'fill') {
    const color = erasing ? '#faf3e2' : currentColor;
    floodFill(pos.x, pos.y, color);
    strokeHistory.push({ type: 'fill', x: pos.x, y: pos.y, color });
    socket.emit('draw-fill', { x: pos.x, y: pos.y, color });
    return;
  }
  drawing = true;
  lastPoint = pos;
  if (currentTool === 'pen') socket.emit('draw-start');
  else shapeStart = pos;
}
function moveDraw(e) {
  if (!isDrawer || !drawing) return;
  e.preventDefault();
  const pos = getPos(e);
  if (currentTool === 'pen') {
    const color = erasing ? '#faf3e2' : currentColor;
    localDraw(lastPoint, pos, color, currentSize);
    strokeHistory.push({ type: 'stroke', from: lastPoint, to: pos, color, size: currentSize });
    socket.emit('draw-data', { from: lastPoint, to: pos, color, size: currentSize });
    lastPoint = pos;
  } else {
    // live shape preview: redraw everything + preview shape
    clearCanvasLocal();
    strokeHistory.forEach(renderEntry);
    drawShapeOnCanvas(currentTool, shapeStart.x, shapeStart.y, pos.x, pos.y, currentColor, currentSize);
  }
}
function endDraw(e) {
  if (isDrawer && drawing && currentTool !== 'pen' && shapeStart) {
    const pos = getPos(e && e.changedTouches ? e.changedTouches[0] : e || {});
    const finalPos = (e && (e.clientX || e.changedTouches)) ? pos : shapeStart;
    const entry = { type: 'shape', shape: currentTool, x1: shapeStart.x, y1: shapeStart.y, x2: finalPos.x, y2: finalPos.y, color: currentColor, size: currentSize };
    strokeHistory.push(entry);
    socket.emit('draw-shape', { shape: entry.shape, x1: entry.x1, y1: entry.y1, x2: entry.x2, y2: entry.y2, color: entry.color, size: entry.size });
  }
  if (isDrawer && currentTool === 'pen' && drawing) socket.emit('draw-end');
  drawing = false; lastPoint = null; shapeStart = null;
}

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', moveDraw);
window.addEventListener('mouseup', endDraw);
canvas.addEventListener('touchstart', e => { e.preventDefault(); startDraw(e); }, { passive: false });
canvas.addEventListener('touchmove', moveDraw, { passive: false });
canvas.addEventListener('touchend', endDraw);

socket.on('draw-data', entry => { strokeHistory.push(entry); renderEntry(entry); });
socket.on('draw-shape', entry => { strokeHistory.push(entry); renderEntry(entry); });
socket.on('draw-fill', entry => { strokeHistory.push(entry); renderEntry(entry); });
socket.on('clear-canvas', () => { strokeHistory = []; clearCanvasLocal(); });
socket.on('canvas-sync', ({ history }) => { strokeHistory = history || []; clearCanvasLocal(); strokeHistory.forEach(renderEntry); });

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
    currentColor = c; erasing = false;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    document.getElementById('eraser-btn').classList.remove('active');
  });
  swatchBox.appendChild(sw);
});

function setTool(tool, btnId) {
  currentTool = tool;
  erasing = false;
  document.querySelectorAll('.tool-btn.tool-select').forEach(b => b.classList.remove('active'));
  if (btnId) document.getElementById(btnId).classList.add('active');
  document.getElementById('eraser-btn').classList.remove('active');
  if (tool === 'fill') unlockAchievement('fill_master', 'Bucket Master');
  if (tool === 'rect' || tool === 'circle' || tool === 'line') unlockAchievement('artist', 'Shape Artist');
}
document.getElementById('tool-pen').addEventListener('click', () => setTool('pen', 'tool-pen'));
document.getElementById('tool-rect').addEventListener('click', () => setTool('rect', 'tool-rect'));
document.getElementById('tool-circle').addEventListener('click', () => setTool('circle', 'tool-circle'));
document.getElementById('tool-line').addEventListener('click', () => setTool('line', 'tool-line'));
document.getElementById('tool-fill').addEventListener('click', () => setTool('fill', 'tool-fill'));

document.getElementById('brush-small').addEventListener('click', () => { currentSize = 4; setActiveBrush('brush-small'); });
document.getElementById('brush-large').addEventListener('click', () => { currentSize = 14; setActiveBrush('brush-large'); });
function setActiveBrush(id) {
  document.getElementById('brush-small').classList.toggle('active', id === 'brush-small');
  document.getElementById('brush-large').classList.toggle('active', id === 'brush-large');
}
document.getElementById('eraser-btn').addEventListener('click', () => {
  erasing = !erasing;
  currentTool = 'pen';
  document.querySelectorAll('.tool-btn.tool-select').forEach(b => b.classList.remove('active'));
  document.getElementById('eraser-btn').classList.toggle('active', erasing);
});
document.getElementById('clear-btn').addEventListener('click', () => {
  strokeHistory = [];
  clearCanvasLocal();
  socket.emit('clear-canvas');
});
document.getElementById('undo-btn').addEventListener('click', () => socket.emit('undo'));

// ---------- Confetti + sounds ----------
function launchConfetti() {
  if (reduceMotion) return;
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
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playWinJingle() {
  if (!soundEnabled) return;
  try {
    const ctx2 = getAudioCtx();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const o = ctx2.createOscillator(); const g = ctx2.createGain();
      o.type = 'triangle'; o.frequency.value = freq; g.gain.value = 0.12;
      o.connect(g); g.connect(ctx2.destination);
      const start = ctx2.currentTime + i * 0.15;
      o.start(start); g.gain.exponentialRampToValueAtTime(0.001, start + 0.4); o.stop(start + 0.4);
    });
  } catch (e) {}
}
let lastTickPlayed = 0;
function playTick() {
  if (!soundEnabled) return;
  const now = Date.now();
  if (now - lastTickPlayed < 900) return;
  lastTickPlayed = now;
  try {
    const ctx2 = getAudioCtx();
    const o = ctx2.createOscillator(); const g = ctx2.createGain();
    o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.05;
    o.connect(g); g.connect(ctx2.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.001, ctx2.currentTime + 0.08); o.stop(ctx2.currentTime + 0.08);
  } catch (e) {}
}

// =====================================================================
// SOLO PLAY MODE — no server room needed, everything runs in the browser.
// =====================================================================
let wordBank = null;
async function ensureWordBank() {
  if (wordBank) return wordBank;
  const res = await fetch('/api/words');
  wordBank = await res.json();
  return wordBank;
}
function pickSoloWord(pack, difficulty) {
  const pool = (wordBank && wordBank[pack]) || (wordBank ? wordBank.english : []);
  const filtered = (!difficulty || difficulty === 'mixed') ? pool : pool.filter(w => w.difficulty === difficulty);
  const list = filtered.length ? filtered : pool;
  return list[Math.floor(Math.random() * list.length)];
}
function currentSoloPackDiff() {
  return {
    pack: document.getElementById('solo-wordpack-select').value,
    diff: document.querySelector('input[name="solo-difficulty"]:checked').value
  };
}

document.getElementById('goto-solo-btn').addEventListener('click', async () => {
  await ensureWordBank();
  showScreen('screen-solo-hub');
});
document.getElementById('solo-hub-back-btn').addEventListener('click', () => showScreen('screen-home'));

document.querySelectorAll('.solo-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    const { pack, diff } = currentSoloPackDiff();
    if (mode === 'practice') startSoloPractice(pack, diff);
    else if (mode === 'rush') startSoloRush(pack, diff, false);
    else if (mode === 'bot-guesses') startSoloRush(pack, diff, true);
    else if (mode === 'bot-drawer') startSoloBotDrawer(pack, diff);
  });
});

// ---------- Reusable local drawing canvas (used by two solo modes) ----------
const SOLO_COLORS = ['#2c2a24', '#ff6b6b', '#ffcf4d', '#5aa9ff', '#4fd6b0', '#a86bff', '#ff9f4d', '#ffffff'];

function setupDrawingCanvas(ids) {
  const canvas = document.getElementById(ids.canvasId);
  const ctx = canvas.getContext('2d');
  const state = { tool: 'pen', color: '#2c2a24', size: 4, erasing: false, drawing: false, lastPoint: null, shapeStart: null, history: [] };

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width; canvas.height = rect.height;
    redrawAll();
  }
  function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#faf3e2'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  function redrawAll() { clear(); state.history.forEach(renderEntry); }

  function localDraw(from, to, color, size) {
    ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(from.x * canvas.width, from.y * canvas.height); ctx.lineTo(to.x * canvas.width, to.y * canvas.height); ctx.stroke();
  }
  function drawShapeOnCanvas(shape, x1, y1, x2, y2, color, size) {
    const X1 = x1 * canvas.width, Y1 = y1 * canvas.height, X2 = x2 * canvas.width, Y2 = y2 * canvas.height;
    ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (shape === 'line') { ctx.moveTo(X1, Y1); ctx.lineTo(X2, Y2); }
    else if (shape === 'rect') { ctx.rect(Math.min(X1, X2), Math.min(Y1, Y2), Math.abs(X2 - X1), Math.abs(Y2 - Y1)); }
    else if (shape === 'circle') {
      const rx = Math.abs(X2 - X1) / 2, ry = Math.abs(Y2 - Y1) / 2;
      const cx = Math.min(X1, X2) + rx, cy = Math.min(Y1, Y2) + ry;
      ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  }
  function floodFill(nx, ny, fillColorHex) {
    const x0 = Math.floor(nx * canvas.width), y0 = Math.floor(ny * canvas.height);
    if (x0 < 0 || y0 < 0 || x0 >= canvas.width || y0 >= canvas.height) return;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data; const w = canvas.width, h = canvas.height;
    const idx = (x, y) => (y * w + x) * 4;
    const startIdx = idx(x0, y0);
    const target = [data[startIdx], data[startIdx + 1], data[startIdx + 2]];
    const fill = hexToRgba(fillColorHex);
    if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2]) return;
    const matches = (i) => Math.abs(data[i] - target[0]) < 40 && Math.abs(data[i + 1] - target[1]) < 40 && Math.abs(data[i + 2] - target[2]) < 40;
    const stack = [[x0, y0]]; let guard = 0;
    while (stack.length && guard < 400000) {
      guard++;
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = idx(x, y);
      if (!matches(i)) continue;
      data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = 255;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    ctx.putImageData(img, 0, 0);
  }
  function hexToRgba(hex) {
    const v = hex.replace('#', '');
    const bigint = parseInt(v.length === 3 ? v.split('').map(c => c + c).join('') : v, 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255, 255];
  }
  function renderEntry(entry) {
    if (entry.type === 'stroke') localDraw(entry.from, entry.to, entry.color, entry.size);
    else if (entry.type === 'shape') drawShapeOnCanvas(entry.shape, entry.x1, entry.y1, entry.x2, entry.y2, entry.color, entry.size);
    else if (entry.type === 'fill') floodFill(entry.x, entry.y, entry.color);
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const evt = e.touches ? e.touches[0] : e;
    return { x: (evt.clientX - rect.left) / rect.width, y: (evt.clientY - rect.top) / rect.height };
  }
  function start(e) {
    const pos = getPos(e);
    if (state.tool === 'fill') {
      const color = state.erasing ? '#faf3e2' : state.color;
      floodFill(pos.x, pos.y, color);
      state.history.push({ type: 'fill', x: pos.x, y: pos.y, color });
      return;
    }
    state.drawing = true; state.lastPoint = pos;
    if (state.tool !== 'pen') state.shapeStart = pos;
  }
  function move(e) {
    if (!state.drawing) return;
    e.preventDefault();
    const pos = getPos(e);
    if (state.tool === 'pen') {
      const color = state.erasing ? '#faf3e2' : state.color;
      localDraw(state.lastPoint, pos, color, state.size);
      state.history.push({ type: 'stroke', from: state.lastPoint, to: pos, color, size: state.size });
      state.lastPoint = pos;
    } else {
      redrawAll();
      drawShapeOnCanvas(state.tool, state.shapeStart.x, state.shapeStart.y, pos.x, pos.y, state.color, state.size);
    }
  }
  function end(e) {
    if (state.drawing && state.tool !== 'pen' && state.shapeStart) {
      const evt = (e && e.changedTouches) ? e.changedTouches[0] : e;
      const pos = (evt && evt.clientX != null) ? getPos(evt) : state.shapeStart;
      state.history.push({ type: 'shape', shape: state.tool, x1: state.shapeStart.x, y1: state.shapeStart.y, x2: pos.x, y2: pos.y, color: state.color, size: state.size });
    }
    state.drawing = false; state.lastPoint = null; state.shapeStart = null;
  }
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); start(e); }, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  const swatchBox = document.getElementById(ids.swatchContainerId);
  SOLO_COLORS.forEach((c, i) => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (i === 0 ? ' active' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => {
      state.color = c; state.erasing = false;
      swatchBox.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      document.getElementById(ids.eraserBtnId).classList.remove('active');
    });
    swatchBox.appendChild(sw);
  });
  document.querySelectorAll(ids.toolButtonSelector).forEach(btn => {
    btn.addEventListener('click', () => {
      state.tool = btn.dataset[ids.toolDataKey];
      state.erasing = false;
      document.querySelectorAll(ids.toolButtonSelector).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(ids.eraserBtnId).classList.remove('active');
    });
  });
  document.getElementById(ids.brushSmallId).addEventListener('click', () => { state.size = 4; document.getElementById(ids.brushSmallId).classList.add('active'); document.getElementById(ids.brushLargeId).classList.remove('active'); });
  document.getElementById(ids.brushLargeId).addEventListener('click', () => { state.size = 14; document.getElementById(ids.brushLargeId).classList.add('active'); document.getElementById(ids.brushSmallId).classList.remove('active'); });
  document.getElementById(ids.eraserBtnId).addEventListener('click', () => {
    state.erasing = !state.erasing; state.tool = 'pen';
    document.querySelectorAll(ids.toolButtonSelector).forEach(b => b.classList.remove('active'));
    document.getElementById(ids.eraserBtnId).classList.toggle('active', state.erasing);
  });
  document.getElementById(ids.undoBtnId).addEventListener('click', () => {
    if (!state.history.length) return;
    state.history.pop();
    redrawAll();
  });
  document.getElementById(ids.clearBtnId).addEventListener('click', () => { state.history = []; clear(); });

  return { canvas, ctx, state, resize, clear, redrawAll, getDataURL: () => canvas.toDataURL('image/png') };
}

// ---------- 🅰️ Draw Practice ----------
let soloPracticeEditor = null, soloPracticeWord = null, soloPracticeTimer = null;
function startSoloPractice(pack, diff) {
  soloPracticeWord = pickSoloWord(pack, diff);
  document.getElementById('solo-practice-word').textContent = `Draw: ${'•'.repeat(soloPracticeWord.word.length)} (${soloPracticeWord.difficulty})`;
  showScreen('screen-solo-practice');
  if (!soloPracticeEditor) {
    soloPracticeEditor = setupDrawingCanvas({
      canvasId: 'solo-practice-canvas', swatchContainerId: 'solo-practice-swatches',
      toolButtonSelector: '#solo-practice-toolbar [data-solo-tool]', toolDataKey: 'soloTool',
      brushSmallId: 'solo-brush-small', brushLargeId: 'solo-brush-large',
      eraserBtnId: 'solo-eraser-btn', undoBtnId: 'solo-undo-btn', clearBtnId: 'solo-clear-btn'
    });
  }
  soloPracticeEditor.state.history = [];
  setTimeout(() => { soloPracticeEditor.resize(); }, 50);
  let timeLeft = 60;
  clearInterval(soloPracticeTimer);
  document.getElementById('solo-practice-timer-fill').style.width = '100%';
  soloPracticeTimer = setInterval(() => {
    timeLeft--;
    document.getElementById('solo-practice-timer-fill').style.width = Math.max(0, Math.min(100, (timeLeft / 60) * 100)) + '%';
    if (timeLeft <= 0) { clearInterval(soloPracticeTimer); revealPracticeWord(); }
  }, 1000);
}
function revealPracticeWord() { document.getElementById('solo-practice-word').textContent = `Word: ${soloPracticeWord.word.toUpperCase()}`; }
document.getElementById('solo-practice-reveal-btn').addEventListener('click', revealPracticeWord);
document.getElementById('solo-practice-download-btn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = soloPracticeEditor.getDataURL();
  a.download = `doodle-${soloPracticeWord.word}.png`;
  a.click();
});
document.getElementById('solo-practice-next-btn').addEventListener('click', () => {
  clearInterval(soloPracticeTimer);
  const { pack, diff } = currentSoloPackDiff();
  startSoloPractice(pack, diff);
});
document.getElementById('solo-practice-exit-btn').addEventListener('click', () => {
  clearInterval(soloPracticeTimer);
  showScreen('screen-solo-hub');
});

// ---------- 🅱️ Guess Rush & 🅲 Bot Draws, You Guess (shared mechanic) ----------
let soloRushWord = null, soloRushTimer = null, soloRushScore = 0, soloRushStreak = 0;
let soloRushMaskedWord = '', soloRushHintsSent = 0, soloRushTimeLeft = 0, soloRushTotal = 45;
let soloRushIsBotVisual = false, soloBotAnimTimer = null;

function startSoloRush(pack, diff, botVisual) {
  soloRushIsBotVisual = botVisual;
  document.getElementById('solo-rush-title').textContent = botVisual ? '🅲 Bot Draws, You Guess' : '🅱️ Guess Rush';
  document.getElementById('solo-bot-canvas-wrap').classList.toggle('hidden', !botVisual);
  soloRushScore = 0; soloRushStreak = 0;
  document.getElementById('solo-rush-score').textContent = soloRushScore;
  document.getElementById('solo-rush-streak').textContent = soloRushStreak;
  const bestKey = botVisual ? 'dd_solo_bot_best' : 'dd_solo_rush_best';
  document.getElementById('solo-rush-best').textContent = localStorage.getItem(bestKey) || 0;
  showScreen('screen-solo-rush');
  nextSoloRushWord(pack, diff);
}
function nextSoloRushWord(pack, diff) {
  soloRushWord = pickSoloWord(pack, diff);
  soloRushMaskedWord = soloRushWord.word.split('').map(c => (c === ' ' ? ' ' : '_')).join('');
  soloRushHintsSent = 0;
  soloRushTotal = soloRushWord.difficulty === 'hard' ? 70 : soloRushWord.difficulty === 'easy' ? 40 : 55;
  soloRushTimeLeft = soloRushTotal;
  document.getElementById('solo-rush-word').textContent = soloRushMaskedWord.split('').join(' ');
  document.getElementById('solo-rush-feedback').textContent = '';
  document.getElementById('solo-rush-input').value = '';
  clearInterval(soloRushTimer);
  document.getElementById('solo-rush-timer-fill').style.width = '100%';
  if (soloRushIsBotVisual) startBotScribble();
  soloRushTimer = setInterval(() => {
    soloRushTimeLeft--;
    document.getElementById('solo-rush-timer-fill').style.width = Math.max(0, Math.min(100, (soloRushTimeLeft / soloRushTotal) * 100)) + '%';
    const frac = soloRushTimeLeft / soloRushTotal;
    const fractions = [0.6, 0.35, 0.15];
    if (soloRushHintsSent < fractions.length && frac <= fractions[soloRushHintsSent]) { soloRushHintsSent++; revealSoloHint(); }
    if (soloRushTimeLeft <= 0) {
      clearInterval(soloRushTimer); stopBotScribble();
      soloRushStreak = 0;
      document.getElementById('solo-rush-streak').textContent = soloRushStreak;
      document.getElementById('solo-rush-feedback').textContent = `⏰ Time's up! The word was ${soloRushWord.word.toUpperCase()}`;
      setTimeout(() => nextSoloRushWord(pack, diff), 1800);
    }
  }, 1000);
}
function revealSoloHint() {
  const chars = soloRushMaskedWord.split('');
  const hidden = [];
  for (let i = 0; i < chars.length; i++) if (chars[i] === '_') hidden.push(i);
  if (!hidden.length) return;
  const idx = hidden[Math.floor(Math.random() * hidden.length)];
  chars[idx] = soloRushWord.word[idx];
  soloRushMaskedWord = chars.join('');
  document.getElementById('solo-rush-word').textContent = soloRushMaskedWord.split('').join(' ');
}
document.getElementById('solo-rush-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('solo-rush-input');
  const text = input.value.trim().toLowerCase();
  input.value = '';
  if (!soloRushWord) return;
  const { pack, diff } = currentSoloPackDiff();
  if (text === soloRushWord.word.toLowerCase()) {
    clearInterval(soloRushTimer); stopBotScribble();
    const mult = { easy: 1, medium: 1.25, hard: 1.5 }[soloRushWord.difficulty] || 1;
    const base = Math.max(10, Math.round(100 * (soloRushTimeLeft / soloRushTotal)));
    soloRushStreak++;
    const streakBonus = soloRushStreak >= 2 ? Math.min(soloRushStreak * 5, 25) : 0;
    const points = Math.round(base * mult) + streakBonus;
    soloRushScore += points;
    document.getElementById('solo-rush-score').textContent = soloRushScore;
    document.getElementById('solo-rush-streak').textContent = soloRushStreak;
    document.getElementById('solo-rush-feedback').textContent = `🎉 Correct! +${points}${soloRushStreak >= 2 ? ' (🔥 streak ' + soloRushStreak + ')' : ''}`;
    const bestKey = soloRushIsBotVisual ? 'dd_solo_bot_best' : 'dd_solo_rush_best';
    const best = parseInt(localStorage.getItem(bestKey) || '0', 10);
    if (soloRushScore > best) { localStorage.setItem(bestKey, soloRushScore); document.getElementById('solo-rush-best').textContent = soloRushScore; }
    if (soloRushStreak >= 3) unlockAchievement('streak3', 'On Fire (3 streak)');
    setTimeout(() => nextSoloRushWord(pack, diff), 1200);
  } else {
    document.getElementById('solo-rush-feedback').textContent = `❌ "${escapeHtml(text)}" isn't it — keep trying!`;
  }
});
document.getElementById('solo-rush-exit-btn').addEventListener('click', () => {
  clearInterval(soloRushTimer); stopBotScribble();
  showScreen('screen-solo-hub');
});

function startBotScribble() {
  clearInterval(soloBotAnimTimer);
  setTimeout(() => {
    const canvas = document.getElementById('solo-bot-canvas');
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width; canvas.height = rect.height;
    ctx.fillStyle = '#faf3e2'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    let last = null;
    soloBotAnimTimer = setInterval(() => {
      const p = { x: Math.random() * canvas.width, y: Math.random() * canvas.height };
      if (last) {
        ctx.strokeStyle = '#2c2a24'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      last = p;
    }, 220);
  }, 60);
}
function stopBotScribble() { clearInterval(soloBotAnimTimer); }

// ---------- 🅲 You Draw, Bot Guesses ----------
let soloBdEditor = null, soloBdWord = null, soloBdTimer = null, soloBdTimeLeft = 0, soloBdTotal = 60, soloBdGuessScheduled = false;

function startSoloBotDrawer(pack, diff) {
  soloBdWord = pickSoloWord(pack, diff);
  document.getElementById('solo-bd-word').textContent = `Draw: ${soloBdWord.word.toUpperCase()} (${soloBdWord.difficulty})`;
  document.getElementById('solo-bd-bot-status').textContent = '🤖 Watching you draw…';
  showScreen('screen-solo-botdrawer');
  if (!soloBdEditor) {
    soloBdEditor = setupDrawingCanvas({
      canvasId: 'solo-bd-canvas', swatchContainerId: 'solo-bd-swatches',
      toolButtonSelector: '#solo-bd-toolbar [data-solobd-tool]', toolDataKey: 'solobdTool',
      brushSmallId: 'solo-bd-brush-small', brushLargeId: 'solo-bd-brush-large',
      eraserBtnId: 'solo-bd-eraser-btn', undoBtnId: 'solo-bd-undo-btn', clearBtnId: 'solo-bd-clear-btn'
    });
  }
  soloBdEditor.state.history = [];
  setTimeout(() => { soloBdEditor.resize(); }, 50);
  soloBdTotal = soloBdWord.difficulty === 'hard' ? 75 : soloBdWord.difficulty === 'easy' ? 45 : 60;
  soloBdTimeLeft = soloBdTotal;
  document.getElementById('solo-bd-timer-fill').style.width = '100%';
  soloBdGuessScheduled = false;
  clearInterval(soloBdTimer);
  soloBdTimer = setInterval(() => {
    soloBdTimeLeft--;
    document.getElementById('solo-bd-timer-fill').style.width = Math.max(0, Math.min(100, (soloBdTimeLeft / soloBdTotal) * 100)) + '%';
    maybeBotGuess();
    if (soloBdTimeLeft <= 0) {
      clearInterval(soloBdTimer);
      if (!soloBdGuessScheduled) document.getElementById('solo-bd-bot-status').textContent = `🤖 I give up! Was it "${soloBdWord.word}"?`;
    }
  }, 1000);
}
function maybeBotGuess() {
  if (soloBdGuessScheduled || !soloBdEditor) return;
  const elapsedFrac = 1 - (soloBdTimeLeft / soloBdTotal);
  const strokes = soloBdEditor.state.history.length;
  const chance = Math.min(0.9, elapsedFrac * 0.6 + Math.min(strokes / 40, 1) * 0.4);
  if (Math.random() < chance * 0.25) {
    soloBdGuessScheduled = true;
    document.getElementById('solo-bd-bot-status').textContent = '🤖 Thinking…';
    setTimeout(() => {
      document.getElementById('solo-bd-bot-status').innerHTML = `🤖 I think it's… <b>${soloBdWord.word.toUpperCase()}</b>! 🎉`;
    }, 900);
  }
}
document.getElementById('solo-bd-next-btn').addEventListener('click', () => {
  clearInterval(soloBdTimer);
  const { pack, diff } = currentSoloPackDiff();
  startSoloBotDrawer(pack, diff);
});
document.getElementById('solo-bd-exit-btn').addEventListener('click', () => {
  clearInterval(soloBdTimer);
  showScreen('screen-solo-hub');
});
