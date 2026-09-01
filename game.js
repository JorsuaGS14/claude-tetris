'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;
const NUT = 8;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#64b5f6', // J - pale blue
  '#ffb74d', // L - orange
  '#b0bec5', // tuerca - gris acero
  '#ffffff', // comodín (wild)
];

// Skins: paleta paralela a COLORS (índices 1..9) + modo de pintado.
const SKINS = {
  retro: {
    mode: 'retro',
    background: null,
    colors: COLORS,
  },
  neon: {
    mode: 'neon',
    background: '#000000',
    colors: [null, '#00e5ff', '#ffea00', '#d500f9', '#00e676', '#ff1744', '#2979ff', '#ff9100', '#b0bec5', '#ffffff'],
  },
  pastel: {
    mode: 'pastel',
    background: '#f4f0fa',
    colors: [null, '#a0e7e5', '#fdffb6', '#d9b8f0', '#b5ead7', '#ffb3ba', '#a2c8f0', '#ffd8a8', '#d0d4d9', '#ffffff'],
  },
  pixel: {
    mode: 'pixel',
    background: '#1a1a12',
    colors: [null, '#4dd0e1', '#ffd54f', '#ba68c8', '#81c784', '#e57373', '#64b5f6', '#ffb74d', '#b0bec5', '#ffffff'],
  },
};

const SPECIAL_EVERY = 5;
const WILD = 9;
const EFFECTS = ['bomb', 'laser', 'wild', 'gravity', 'freeze'];
const EFFECT_LABELS = {
  bomb: 'BOMBA',
  laser: 'RAYO',
  wild: 'TINTE',
  gravity: 'GRAVEDAD',
  freeze: 'CONGELAR',
};
const EFFECT_BADGES = { bomb: 'B', laser: 'L', wild: 'T', gravity: 'G', freeze: 'F' };

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // tuerca (hueco central)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const skinSelect = document.getElementById('skin-select');
const powerupEl = document.getElementById('powerup');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let gridColor, blockHighlight;
let linesSinceSpecial, pendingSpecial, freezeUntil, flash;
let currentSkin = 'retro';

const THEME_KEY = 'tetris-theme';
const SKIN_KEY = 'tetris-skin';

function applySkin(name) {
  if (!SKINS[name]) name = 'retro';
  currentSkin = name;
  localStorage.setItem(SKIN_KEY, name);
  if (skinSelect) skinSelect.value = name;
  if (board) {
    draw();
    drawNext();
  }
}

function initSkin() {
  const saved = localStorage.getItem(SKIN_KEY);
  applySkin(saved && SKINS[saved] ? saved : 'retro');
}

if (skinSelect) {
  skinSelect.addEventListener('change', () => applySkin(skinSelect.value));
}

function readThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  gridColor = styles.getPropertyValue('--grid-color').trim();
  blockHighlight = styles.getPropertyValue('--block-highlight').trim();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.checked = theme === 'light';
  readThemeColors();
  if (board) draw();
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

themeToggle.addEventListener('change', () => {
  const theme = themeToggle.checked ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
});

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 8) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomEffect() {
  return EFFECTS[Math.floor(Math.random() * EFFECTS.length)];
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    linesSinceSpecial += cleared;
    if (linesSinceSpecial >= SPECIAL_EVERY) {
      linesSinceSpecial -= SPECIAL_EVERY;
      pendingSpecial = true;
    }
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function pieceCells() {
  const cells = [];
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c]) cells.push({ x: current.x + c, y: current.y + r });
  return cells;
}

function compactColumns() {
  for (let c = 0; c < COLS; c++) {
    const stack = [];
    for (let r = ROWS - 1; r >= 0; r--) if (board[r][c]) stack.push(board[r][c]);
    for (let r = ROWS - 1; r >= 0; r--) board[r][c] = stack[ROWS - 1 - r] || 0;
  }
}

function applyEffect(effect, cells) {
  const xs = cells.map(p => p.x), ys = cells.map(p => p.y);
  const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
  const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);

  if (effect === 'bomb') {
    for (const { x, y } of cells)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) board[ny][nx] = 0;
        }
  } else if (effect === 'laser') {
    if (Math.random() < 0.5) {
      if (cy >= 0 && cy < ROWS) board[cy].fill(0);
    } else {
      for (let r = 0; r < ROWS; r++) if (cx >= 0 && cx < COLS) board[r][cx] = 0;
    }
  } else if (effect === 'wild') {
    const present = new Set();
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (board[r][c] && board[r][c] !== WILD) present.add(board[r][c]);
    const colors = [...present];
    if (colors.length) {
      const target = colors[Math.floor(Math.random() * colors.length)];
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (board[r][c] === target) board[r][c] = WILD;
    }
  } else if (effect === 'gravity') {
    compactColumns();
  } else if (effect === 'freeze') {
    freezeUntil = performance.now() + 5000;
  }

  flashMessage(EFFECT_LABELS[effect]);
}

function lockPiece() {
  const effect = current.effect;
  const cells = effect ? pieceCells() : null;
  merge();
  if (effect) applyEffect(effect, cells);
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (pendingSpecial) {
    while (next.type === NUT) next = randomPiece();
    next.effect = randomEffect();
    pendingSpecial = false;
  }
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
  updateHUD();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  const effect = (current && current.effect) || (next && next.effect);
  powerupEl.textContent = effect ? EFFECT_LABELS[effect] : '—';
}

function flashMessage(text) {
  flash = { text, until: performance.now() + 1200 };
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const skin = SKINS[currentSkin] || SKINS.retro;
  const color = skin.colors[colorIndex] || COLORS[colorIndex];
  const px = x * size + 1;
  const py = y * size + 1;
  const s = size - 2;
  context.globalAlpha = alpha ?? 1;

  if (skin.mode === 'neon') {
    context.shadowColor = color;
    context.shadowBlur = 12;
    context.fillStyle = color;
    context.fillRect(px, py, s, s);
    context.shadowBlur = 0;
  } else if (skin.mode === 'pastel') {
    context.fillStyle = color;
    if (typeof context.roundRect === 'function') {
      context.beginPath();
      context.roundRect(px, py, s, s, Math.max(3, size * 0.18));
      context.fill();
    } else {
      context.fillRect(x * size + 3, y * size + 3, size - 6, size - 6);
    }
  } else if (skin.mode === 'pixel') {
    context.fillStyle = color;
    context.fillRect(px, py, s, s);
    const h = s / 2;
    context.fillStyle = 'rgba(255, 255, 255, 0.25)';
    context.fillRect(px, py, h, h);
    context.fillRect(px + h, py + h, h, h);
    context.fillStyle = 'rgba(0, 0, 0, 0.28)';
    context.fillRect(px + h, py, h, h);
    context.fillRect(px, py + h, h, h);
  } else {
    context.fillStyle = color;
    context.fillRect(px, py, s, s);
    context.fillStyle = blockHighlight;
    context.fillRect(px, py, s, 4);
  }
  context.globalAlpha = 1;
}

function paintSkinBackground(context, width, height) {
  const skin = SKINS[currentSkin] || SKINS.retro;
  if (skin.background) {
    context.fillStyle = skin.background;
    context.fillRect(0, 0, width, height);
  }
}

function drawNutHole(context, cellX, cellY, size, alpha) {
  context.globalAlpha = alpha ?? 1;
  context.beginPath();
  context.arc(cellX * size + size / 2, cellY * size + size / 2, size * 0.32, 0, Math.PI * 2);
  context.fillStyle = '#12121a';
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = 'rgba(255,255,255,0.25)';
  context.stroke();
  context.globalAlpha = 1;
}

function drawEffectBadge(context, cellX, cellY, size, effect) {
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 200);
  const px = cellX * size + size / 2;
  const py = cellY * size + size / 2;
  context.save();
  context.shadowColor = '#fff';
  context.shadowBlur = 6 + 10 * pulse;
  context.beginPath();
  context.arc(px, py, size * 0.34, 0, Math.PI * 2);
  context.fillStyle = 'rgba(20,20,30,0.85)';
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = '#fff';
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = '#fff';
  context.font = `bold ${Math.floor(size * 0.5)}px 'Courier New', monospace`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(EFFECT_BADGES[effect], px, py + 1);
  context.restore();
}

function badgeCell(piece) {
  const cols = piece.shape[0].length, rows = piece.shape.length;
  return { x: piece.x + Math.floor(cols / 2), y: piece.y + Math.floor(rows / 2) };
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paintSkinBackground(ctx, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);
  if (current.type === NUT) drawNutHole(ctx, current.x + 1, gy + 1, BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
  if (current.type === NUT) drawNutHole(ctx, current.x + 1, current.y + 1, BLOCK);
  if (current.effect) {
    const b = badgeCell(current);
    drawEffectBadge(ctx, b.x, b.y, BLOCK, current.effect);
  }

  drawFlash();
}

function drawFlash() {
  if (!flash || performance.now() > flash.until) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, (flash.until - performance.now()) / 400);
  ctx.fillStyle = 'rgba(10,10,20,0.7)';
  ctx.fillRect(0, canvas.height / 2 - 34, canvas.width, 68);
  ctx.fillStyle = '#fff';
  ctx.font = "bold 26px 'Courier New', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(flash.text, canvas.width / 2, canvas.height / 2);
  ctx.restore();
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  paintSkinBackground(nextCtx, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
  if (next.type === NUT) drawNutHole(nextCtx, offX + 1, offY + 1, NB);
  if (next.effect) {
    drawEffectBadge(nextCtx, offX + Math.floor(shape[0].length / 2), offY + Math.floor(shape.length / 2), NB, next.effect);
  }
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  if (gameOver) return;
  const dt = ts - lastTime;
  lastTime = ts;
  const frozen = ts < freezeUntil;
  if (!frozen) dropAccum += dt;
  if (!frozen && dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
      if (gameOver) return;
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  linesSinceSpecial = 0;
  pendingSpecial = false;
  freezeUntil = 0;
  flash = null;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

initTheme();
initSkin();
init();
