/* ============================================================
   The Lawn Club — grass court tennis vs the club professional
   Pseudo-3D view from behind the baseline. World units are
   metres: x lateral, y depth (0 = your baseline), z height.
   ============================================================ */

import { AudioEngine } from './audio.js';

/* ---------- court geometry (metres, real dimensions) ---------- */
const CT = {
  len: 23.77,
  netY: 11.885,
  netH: 0.914,
  halfS: 4.115,   // singles half-width
  halfD: 5.485,   // doubles half-width
  svcNear: 5.485, // service line, near side
  svcFar: 18.285, // service line, far side
  postX: 5.94,
  ballR: 0.033,
};
const GRAV = 9.8;
const MAGNUS = 0.42; // topspin dips, slice floats
const CAM = { y: -8, z: 4.6 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

/* ---------- DOM ---------- */
const canvas = document.getElementById('game');
let ctx = canvas.getContext('2d'); // reassigned while painting offscreen layers
const screenCtx = ctx;
const wrap = document.getElementById('canvasWrap');
const overlay = document.getElementById('overlay');
const ovEyebrow = document.getElementById('ovEyebrow');
const ovTitle = document.getElementById('ovTitle');
const ovCopy = document.getElementById('ovCopy');
const playBtn = document.getElementById('playBtn');
const callEl = document.getElementById('call');
const toastEl = document.getElementById('toast');
const hintEl = document.getElementById('hint');
const els = {
  gamesYou: document.getElementById('gamesYou'),
  gamesPro: document.getElementById('gamesPro'),
  ptsYou: document.getElementById('ptsYou'),
  ptsPro: document.getElementById('ptsPro'),
  dotYou: document.getElementById('dotYou'),
  dotPro: document.getElementById('dotPro'),
};

const audio = new AudioEngine();

/* ---------- canvas sizing ---------- */
let W = 900, H = 560, DPR = 1;
let crowdDots = null;
let courtLayer = null, netLayer = null;
function resize() {
  const r = wrap.getBoundingClientRect();
  W = Math.max(320, r.width);
  H = Math.max(200, r.height);
  DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  screenCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  crowdDots = null;
  buildLayers();
}

/* The court and net barely change, so they're painted once per resize. */
function buildLayers() {
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    return c;
  };
  courtLayer = mk();
  netLayer = mk();
  ctx = courtLayer.getContext('2d');
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawCourtStatic();
  ctx = netLayer.getContext('2d');
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawNet();
  ctx = screenCtx;
}
new ResizeObserver(resize).observe(wrap);
resize();

/* ---------- projection ---------- */
function proj(x, y, z) {
  const d = Math.max(0.6, y - CAM.y); // never cross the camera plane
  const F = W * 0.72;
  return {
    x: W / 2 + (x / d) * F,
    y: H * 0.24 + ((CAM.z - z) / d) * F,
    s: F / d, // pixels per metre at this depth
  };
}

/* ---------- game state ---------- */
const G = {
  phase: 'idle', // idle | serve-ready | serve-toss | pro-serve | rally | point-over | match-over
  server: 'you',
  points: { you: 0, pro: 0 },
  games: { you: 0, pro: 0 },
  faults: 0,
  rallyHits: 0,
  token: 0, // cancels stale timeouts
};

const ball = {
  x: 0, y: 12, z: 1, vx: 0, vy: 0, vz: 0,
  spin: 0, active: false, flight: false,
  lastHit: null, bounces: 0, isServe: false, netTouched: false,
  trail: [],
};

const ai = {
  x: 0, y: 22.9, homeY: 22.9, plan: null, cooldown: 0,
  speed: 6.4, phaseT: 0, lean: 0,
};

const pointer = {
  x: W / 2, y: H * 0.8, prevX: W / 2, prevY: H * 0.8,
  inside: false, hist: [], vx: 0, vy: 0, speed: 0,
};
let hitCooldown = 0;
let swooshCooldown = 0;
let lastBounceMark = null;

/* ============================================================
   Input
   ============================================================ */

wrap.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  pointer.x = e.clientX - r.left;
  pointer.y = e.clientY - r.top;
  pointer.inside = true;
  pointer.hist.push({ t: performance.now(), x: pointer.x, y: pointer.y });
});
wrap.addEventListener('pointerleave', () => { pointer.inside = false; });
wrap.addEventListener('pointerdown', (e) => {
  audio.ensure();
  if (G.phase === 'serve-ready') tossBall();
});

function updatePointerVelocity() {
  const now = performance.now();
  const h = pointer.hist;
  // a synthetic sample per frame keeps velocity honest even when the
  // browser coalesces pointer events down to the frame rate
  if (pointer.inside) h.push({ t: now, x: pointer.x, y: pointer.y });
  // keep a few samples even past the window so low frame rates still
  // see real displacement (event + synthetic samples share positions)
  while (h.length > 5 && now - h[0].t > 140) h.shift();
  if (h.length >= 2 && now - h[0].t < 500) {
    const a = h[0], b = h[h.length - 1];
    const dt = Math.max(8, b.t - a.t) / 1000;
    pointer.vx = (b.x - a.x) / dt;
    pointer.vy = (b.y - a.y) / dt;
  } else {
    pointer.vx *= 0.7;
    pointer.vy *= 0.7;
  }
  pointer.speed = Math.hypot(pointer.vx, pointer.vy);
}

/* distance from point to the racket's swept path this frame */
function sweptDist(px, py) {
  const ax = pointer.prevX, ay = pointer.prevY, bx = pointer.x, by = pointer.y;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/* ============================================================
   Scoring
   ============================================================ */

const PT_NAME = ['Love', 'Fifteen', 'Thirty', 'Forty'];

function pointsLabel(who) {
  const p = G.points, a = p[who], o = p[who === 'you' ? 'pro' : 'you'];
  if (a >= 3 && o >= 3) {
    if (a === o) return '40';
    return a > o ? 'Ad' : '40';
  }
  return ['0', '15', '30', '40'][Math.min(a, 3)];
}

function scoreCall() {
  const s = G.server, r = s === 'you' ? 'pro' : 'you';
  const ps = G.points[s], pr = G.points[r];
  if (ps >= 3 && pr >= 3) {
    if (ps === pr) return 'Deuce';
    const leader = ps > pr ? s : r;
    return 'Advantage ' + (leader === 'you' ? 'You' : 'the Club Pro');
  }
  if (ps === pr) return PT_NAME[ps] + ' all';
  return PT_NAME[Math.min(ps, 3)] + '–' + PT_NAME[Math.min(pr, 3)];
}

function updateScoreboard() {
  els.gamesYou.textContent = G.games.you;
  els.gamesPro.textContent = G.games.pro;
  const over = G.phase === 'match-over' || G.phase === 'idle';
  els.ptsYou.textContent = over ? '–' : pointsLabel('you');
  els.ptsPro.textContent = over ? '–' : pointsLabel('pro');
  els.dotYou.classList.toggle('on', G.server === 'you' && !over);
  els.dotPro.classList.toggle('on', G.server === 'pro' && !over);
}

function awardPoint(winner, reason) {
  if (G.phase === 'point-over' || G.phase === 'match-over') return;
  G.phase = 'point-over';
  ball.active = false;
  ai.plan = null;
  hint('');

  const loser = winner === 'you' ? 'pro' : 'you';
  if (reason) toast(reason);

  G.points[winner]++;
  const pw = G.points[winner], pl = G.points[loser];
  const gameWon = pw >= 4 && pw - pl >= 2;

  const intensity = clamp(0.25 + G.rallyHits * 0.07 + (gameWon ? 0.25 : 0) + (winner === 'you' ? 0.1 : 0), 0.2, 1);
  audio.applause(intensity);
  if (reason === 'Out' || reason === 'Net' || reason === 'Double fault') audio.aww();

  const token = ++G.token;
  if (gameWon) {
    G.games[winner]++;
    G.points.you = 0;
    G.points.pro = 0;
    updateScoreboard();
    const matchWon = G.games[winner] >= 2;
    setTimeout(() => {
      if (token !== G.token) return;
      if (matchWon) {
        call('Game, Set & Match');
        setTimeout(() => { if (token === G.token) matchOver(winner); }, 2100);
      } else {
        call('Game — ' + (winner === 'you' ? 'You' : 'the Club Pro'));
        G.server = G.server === 'you' ? 'pro' : 'you';
        updateScoreboard();
        setTimeout(() => { if (token === G.token) setupServe(); }, 2300);
      }
    }, 900);
  } else {
    updateScoreboard();
    setTimeout(() => {
      if (token !== G.token) return;
      call(scoreCall());
      setTimeout(() => { if (token === G.token) setupServe(); }, 2000);
    }, 900);
  }
}

function matchOver(winner) {
  G.phase = 'match-over';
  updateScoreboard();
  const youWon = winner === 'you';
  ovEyebrow.textContent = youWon
    ? `You defeat the club professional, ${G.games.you} games to ${G.games.pro}`
    : `The club professional prevails, ${G.games.pro} games to ${G.games.you}`;
  ovTitle.textContent = youWon ? 'Champion of the Lawn' : 'A Gallant Defeat';
  ovCopy.textContent = youWon
    ? 'The crowd rises — as much as this crowd ever rises. Strawberries all round.'
    : 'The pro tips their hat. The grass, as ever, forgives everything but a second double fault.';
  playBtn.textContent = 'Play Again';
  overlay.classList.remove('hidden');
  wrap.classList.remove('playing');
  audio.applause(1);
}

/* ============================================================
   Serving
   ============================================================ */

function serveCourt() {
  return (G.points.you + G.points.pro) % 2 === 0 ? 'deuce' : 'ad';
}

/* The target service box: cross-court from the server. */
function serveBox() {
  const court = serveCourt();
  if (G.server === 'you') {
    // your deuce court is +x; ball must land in receiver's deuce court (−x, far side)
    const xr = court === 'deuce' ? [-CT.halfS, 0] : [0, CT.halfS];
    return { x0: xr[0], x1: xr[1], y0: CT.netY, y1: CT.svcFar };
  }
  const xr = court === 'deuce' ? [0, CT.halfS] : [-CT.halfS, 0];
  return { x0: xr[0], x1: xr[1], y0: CT.svcNear, y1: CT.netY };
}

function setupServe() {
  if (G.phase === 'match-over') return;
  G.rallyHits = 0;
  ball.active = false;
  ball.trail = [];
  ball.isServe = false;
  lastBounceMark = null;
  updateScoreboard();
  const court = serveCourt();
  const sx = court === 'deuce' ? 0.55 : -0.55;

  if (G.server === 'you') {
    G.phase = 'serve-ready';
    G.serveX = sx;
    hint(G.faults === 1 ? 'Second serve — click to toss' : 'Click to toss · strike at the top');
    audio.hush();
  } else {
    G.phase = 'pro-serve';
    hint(G.faults === 1 ? 'Second serve' : 'The pro to serve');
    audio.hush();
    // pro stands at his deuce (−x) or ad (+x) side
    ai.x = -sx;
    ai.y = 23.4;
    const token = G.token;
    setTimeout(() => { if (token === G.token && G.phase === 'pro-serve') proServe(); }, rand(1100, 1800));
  }
}

function tossBall() {
  G.phase = 'serve-toss';
  hint('');
  hitCooldown = 0.3; // let the toss rise before it can be struck
  Object.assign(ball, {
    x: G.serveX, y: 0.35, z: 1.05,
    vx: 0, vy: 0, vz: 5.6,
    spin: 0, active: true, flight: false,
    lastHit: null, bounces: 0, isServe: false, netTouched: false,
  });
  ball.trail = [];
}

function fault() {
  ball.active = false;
  G.faults++;
  if (G.faults >= 2) {
    G.faults = 0;
    awardPoint(G.server === 'you' ? 'pro' : 'you', 'Double fault');
  } else {
    toast('Fault');
    audio.aww();
    const token = ++G.token;
    setTimeout(() => { if (token === G.token) setupServe(); }, 1400);
  }
}

/* ============================================================
   Striking the ball
   ============================================================ */

/* Vertical launch: pick vz so the ball clears the net by `margin`. */
function solveVz(y0, z0, vy, margin) {
  const tNet = Math.abs(CT.netY - y0) / Math.max(0.5, vy);
  return (CT.netH + margin - z0) / tNet + (GRAV / 2) * tNet;
}
function flightTime(z0, vz) {
  return (vz + Math.sqrt(vz * vz + 2 * GRAV * z0)) / GRAV;
}

function playerStrike(isServe) {
  const nx = pointer.vx / W; // canvas-widths per second
  const ny = pointer.vy / W;
  const speed = Math.hypot(nx, ny);
  const power = clamp(speed / 2.6, 0.06, 1);
  const lat = clamp(nx / 2.0, -1, 1);
  const spin = clamp(-ny / 2.2, -1, 1);

  const bp = proj(ball.x, ball.y, ball.z);
  const offset = sweptDist(bp.x, bp.y);
  const quality = 1 - clamp(offset / hitRadius(), 0, 1) * 0.85;

  const x0 = ball.x, y0 = ball.y, z0 = ball.z;
  let vy, margin;
  if (isServe) {
    vy = 13 + 19 * power;
    margin = 0.1 + 0.3 * quality + 0.3 * Math.max(0, spin) + (1 - quality) * rand(-0.35, 0.35);
  } else {
    vy = 8.5 + 17.5 * power;
    margin = 0.16 + 0.5 * quality + 0.32 * Math.max(0, spin) + 0.55 * Math.max(0, -spin)
      + (1 - quality) * rand(-0.45, 0.45);
  }
  const vz = solveVz(y0, z0, vy, margin);
  const tLand = flightTime(z0, vz);

  let targetX;
  if (isServe) {
    const box = serveBox();
    const cx = (box.x0 + box.x1) / 2;
    targetX = clamp(cx + lat * 2.4 + (1 - quality) * rand(-1.4, 1.4), -CT.halfS - 1, CT.halfS + 1);
  } else {
    targetX = clamp(lat * 3.6, -3.55, 3.55) + (1 - quality) * rand(-1.6, 1.6);
  }
  const vx = (targetX - x0) / Math.max(0.25, tLand);

  Object.assign(ball, {
    vx, vy, vz, spin,
    flight: true, lastHit: 'you', bounces: 0,
    isServe, netTouched: false,
  });
  G.phase = 'rally';
  G.rallyHits++;
  hitCooldown = 0.35;
  ai.plan = null;
  audio.hit(power, spin);

  if (!isServe) {
    if (power < 0.24 && spin < 0.15) toast('Drop shot');
    else if (spin > 0.5) toast('Topspin');
    else if (spin < -0.42) toast('Slice');
    else if (power > 0.85) toast('Flat drive');
  }
}

function hitRadius() {
  return Math.max(46, W * 0.072);
}

function tryPlayerHit(dt) {
  hitCooldown = Math.max(0, hitCooldown - dt);
  swooshCooldown = Math.max(0, swooshCooldown - dt);
  if (!pointer.inside || hitCooldown > 0 || !ball.active) return;

  const isToss = G.phase === 'serve-toss';
  const inRally = G.phase === 'rally' && ball.lastHit !== 'you' && ball.y < 10.5;
  if (!isToss && !inRally) return;

  const minSwing = 0.14 * W; // px/s
  const bp = proj(ball.x, ball.y, ball.z);
  const dist = sweptDist(bp.x, bp.y);
  if (dist < hitRadius() && pointer.speed > minSwing) {
    playerStrike(isToss);
  } else if (pointer.speed > W * 1.6 && swooshCooldown <= 0 && G.phase === 'rally') {
    swooshCooldown = 0.5;
    audio.swoosh(clamp(pointer.speed / (W * 3), 0, 1));
  }
}

/* ============================================================
   The Club Pro
   ============================================================ */

function predictIntercept() {
  // clone & step the ball until it's takeable on the far side
  const b = { x: ball.x, y: ball.y, z: ball.z, vx: ball.vx, vy: ball.vy, vz: ball.vz, spin: ball.spin };
  let bounced = 0;
  const h = 1 / 120;
  for (let t = 0; t < 4; t += h) {
    const vh = Math.hypot(b.vx, b.vy);
    b.vz -= (GRAV + MAGNUS * b.spin * vh) * h;
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
    if (b.z <= CT.ballR && b.vz < 0) {
      bounced++;
      if (bounced >= 2) break;
      b.z = CT.ballR;
      b.vz = -b.vz * (0.55 + 0.08 * clamp(b.spin, -1, 1));
      if (b.spin < -0.2) b.vz *= 0.75;
      b.vy *= 0.74 + 0.1 * clamp(b.spin, 0, 1);
      b.vx *= 0.85;
      b.spin *= 0.45;
    }
    const takeable = b.y > CT.netY + 1.2 &&
      ((bounced >= 1 && b.vz < 0 && b.z < 1.5 && b.z > 0.25) || b.y > 22.6);
    if (takeable) return { x: b.x, y: clamp(b.y, CT.netY + 1.1, 25.5), t };
  }
  return null;
}

function aiShot() {
  const x0 = ai.x, y0 = ball.y, z0 = ball.z;
  const rush = G.rallyHits > 6 ? 0.03 * (G.rallyHits - 6) : 0;

  // choose a target
  let tx, pace, clear, spin = rand(0.15, 0.45);
  const roll = Math.random();
  const awayFromYou = (pointer.x < W / 2 ? 1 : -1);
  if (roll < 0.5) { // deep corner
    tx = awayFromYou * rand(2.1, 3.2);
    pace = rand(15, 19.5);
    clear = rand(0.45, 0.85);
  } else if (roll < 0.78) { // deep middle
    tx = rand(-1.4, 1.4);
    pace = rand(14, 18);
    clear = rand(0.5, 1);
  } else if (roll < 0.9) { // sharper angle
    tx = (Math.random() < 0.5 ? -1 : 1) * rand(2.8, 3.5);
    pace = rand(13.5, 17);
    clear = rand(0.4, 0.7);
  } else { // drop shot
    tx = rand(-1.4, 1.4);
    pace = rand(8.2, 9.6);
    clear = rand(0.18, 0.4);
    spin = -0.4;
  }

  // unforced errors: occasionally overcook it
  const err = 0.09 + rush + clamp((G.rallyHits - 2) * 0.01, 0, 0.06);
  if (Math.random() < err) {
    if (Math.random() < 0.5) tx = (tx >= 0 ? 1 : -1) * rand(4.3, 5.1); // wide
    else { pace += rand(3.5, 5.5); clear = rand(0.02, 0.2); } // long or netted
  }

  // keep the landing inside the baseline: shrink pace until it fits
  let vy = pace, vz = 0, tLand = 1;
  for (let i = 0; i < 5; i++) {
    vz = solveVz(y0, z0, vy, clear);
    tLand = flightTime(z0, vz);
    const landY = y0 - vy * tLand;
    // magnus pulls topspin down ⇒ actual landing is a touch deeper than this estimate
    if (landY < 0.9 && i < 4) { vy *= 0.9; continue; }
    break;
  }
  const vx = (tx - x0) / Math.max(0.3, tLand) + rand(-0.4, 0.4);

  Object.assign(ball, {
    x: ai.x, // struck from the racket
    vx, vy: -vy, vz, spin,
    flight: true, lastHit: 'pro', bounces: 0,
    isServe: false, netTouched: false,
  });
  G.rallyHits++;
  ai.cooldown = 0.5;
  ai.plan = null;
  audio.hit(clamp((pace - 9) / 11, 0.2, 1), spin);
}

function proServe() {
  const court = serveCourt();
  const sx = court === 'deuce' ? -0.55 : 0.55;
  const box = serveBox();
  ai.x = sx; ai.y = 23.4;

  const cx = (box.x0 + box.x1) / 2;
  let tx = cx + rand(-1.3, 1.3);
  let pace = rand(15.5, 19.5);
  let clear = rand(0.2, 0.55);
  if (Math.random() < 0.08) { // the pro is mortal
    if (Math.random() < 0.5) tx = cx + (Math.random() < 0.5 ? -1 : 1) * rand(3.4, 4.2);
    else { pace += rand(4, 6); clear = 0.02; }
  }

  const z0 = 2.7, y0 = 23.4;
  let vy = pace, vz = 0, tLand = 1;
  for (let i = 0; i < 5; i++) {
    vz = solveVz(y0, z0, vy, clear);
    tLand = flightTime(z0, vz);
    const landY = y0 - vy * tLand;
    if (landY < CT.svcNear + 0.5 && i < 4) { vy *= 0.92; continue; } // long
    if (landY > CT.netY - 0.8 && i < 4) { vy *= 1.06; continue; }    // too shallow
    break;
  }
  const vx = (tx - sx) / Math.max(0.3, tLand);

  Object.assign(ball, {
    x: sx, y: y0, z: z0,
    vx, vy: -vy, vz,
    spin: rand(0.1, 0.35), active: true, flight: true,
    lastHit: 'pro', bounces: 0, isServe: true, netTouched: false,
  });
  ball.trail = [];
  G.phase = 'rally';
  G.rallyHits++;
  hint('');
  audio.hit(0.75, 0.2);
}

function updateAI(dt) {
  ai.cooldown = Math.max(0, ai.cooldown - dt);
  ai.phaseT += dt;

  const chasing = G.phase === 'rally' && ball.active && ball.lastHit === 'you';
  let tx = clamp(-ball.x * 0.25, -1.2, 1.2), ty = ai.homeY;

  if (chasing) {
    if (!ai.plan) ai.plan = predictIntercept();
    if (ai.plan) { tx = ai.plan.x; ty = ai.plan.y; }
  }

  const dx = tx - ai.x, dy = ty - ai.y;
  const d = Math.hypot(dx, dy);
  const step = ai.speed * dt;
  if (d > 0.05) {
    const k = Math.min(1, step / d);
    ai.x += dx * k;
    ai.y += dy * k;
    ai.lean = clamp(dx * 0.5, -1, 1);
  } else {
    ai.lean *= 0.9;
  }
  ai.x = clamp(ai.x, -7, 7);
  ai.y = clamp(ai.y, CT.netY + 1, 26);

  if (chasing && ai.cooldown <= 0 && ball.y > CT.netY + 0.8 && ball.z < 2.7) {
    const reach = Math.hypot(ball.x - ai.x, ball.y - ai.y);
    if (reach < 1.3) aiShot();
  }
}

/* ============================================================
   Ball physics & point resolution
   ============================================================ */

function inSingles(x, y) {
  return Math.abs(x) <= CT.halfS + CT.ballR && y >= -CT.ballR && y <= CT.len + CT.ballR;
}
function inBox(x, y, box) {
  const m = CT.ballR;
  return x >= box.x0 - m && x <= box.x1 + m && y >= box.y0 - m && y <= box.y1 + m;
}

function onBounce() {
  const bx = ball.x, by = ball.y;
  lastBounceMark = { x: bx, y: by, t: performance.now() };
  audio.bounce(Math.abs(ball.vz) < 3);

  if (G.phase === 'serve-toss') {
    // toss dropped untouched — re-toss, no penalty
    ball.active = false;
    G.phase = 'serve-ready';
    hint('Click to toss again');
    return;
  }

  if (ball.isServe) {
    ball.isServe = false;
    const good = !ball.netTouched && inBox(bx, by, serveBox());
    if (!good) { fault(); return; }
    G.faults = 0;
    ball.bounces = 1;
  } else if (G.phase === 'rally') {
    const side = by < CT.netY ? 'near' : 'far';
    const hitterSide = ball.lastHit === 'you' ? 'near' : 'far';
    if (side === hitterSide) {
      awardPoint(ball.lastHit === 'you' ? 'pro' : 'you', 'Net');
      return;
    }
    if (ball.bounces === 0) {
      if (!inSingles(bx, by)) {
        awardPoint(ball.lastHit === 'you' ? 'pro' : 'you', 'Out');
        return;
      }
      ball.bounces = 1;
    } else {
      const winner = ball.lastHit;
      const reason = G.rallyHits <= 1 && winner === G.server ? 'Ace' : 'Winner';
      awardPoint(winner, reason);
      return;
    }
  }

  // physical rebound
  ball.z = CT.ballR;
  ball.vz = -ball.vz * (0.55 + 0.08 * clamp(ball.spin, -1, 1));
  if (ball.spin < -0.2) ball.vz *= 0.75; // slice skids low
  ball.vy *= 0.74 + 0.1 * clamp(ball.spin, 0, 1);
  ball.vx *= 0.85;
  ball.spin *= 0.45;
}

function stepBall(h) {
  if (!ball.active) return;
  const prevY = ball.y, prevZ = ball.z;

  if (ball.flight) {
    const vh = Math.hypot(ball.vx, ball.vy);
    ball.vz -= (GRAV + MAGNUS * ball.spin * vh) * h;
    const drag = 1 - 0.004 * vh * h;
    ball.vx *= drag; ball.vy *= drag;
  } else {
    ball.vz -= GRAV * h;
  }

  ball.x += ball.vx * h;
  ball.y += ball.vy * h;
  ball.z += ball.vz * h;

  // net plane
  if (ball.flight && (prevY - CT.netY) * (ball.y - CT.netY) < 0) {
    const f = (CT.netY - prevY) / (ball.y - prevY);
    const zc = prevZ + (ball.z - prevZ) * f;
    if (zc < CT.netH + CT.ballR && Math.abs(ball.x) < CT.postX) {
      // net cord — the ball falls back on the hitter's side
      ball.y = prevY;
      ball.vy *= -0.12;
      ball.vx *= 0.4;
      ball.vz = Math.min(ball.vz, 0.5);
      ball.spin = 0;
      ball.netTouched = true;
      audio.netCord();
    } else {
      ball.bounces = 0; // fresh side
    }
  }

  if (ball.z <= CT.ballR && ball.vz < 0) onBounce();

  // safety net for anything that escapes the garden
  if (ball.active && (Math.abs(ball.x) > 14 || ball.y > 34 || ball.y < -10)) {
    if (G.phase === 'rally' && ball.lastHit) {
      awardPoint(ball.lastHit === 'you' ? 'pro' : 'you', 'Out');
    } else {
      ball.active = false;
      if (G.phase === 'serve-toss') { G.phase = 'serve-ready'; hint('Click to toss again'); }
    }
  }
}

/* ============================================================
   Announcements
   ============================================================ */

let callTimer = null;
function call(text) {
  callEl.textContent = text;
  callEl.classList.remove('show');
  void callEl.offsetWidth; // restart animation
  callEl.classList.add('show');
  clearTimeout(callTimer);
  callTimer = setTimeout(() => callEl.classList.remove('show'), 2000);
}

let toastTimer = null;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
}

function hint(text) {
  if (!text) { hintEl.classList.remove('show'); return; }
  hintEl.textContent = text;
  hintEl.classList.add('show');
}

/* ============================================================
   Rendering
   ============================================================ */

function quad(x0, y0, x1, y1, x2, y2, x3, y3, fill) {
  const a = proj(x0, y0, 0), b = proj(x1, y1, 0), c = proj(x2, y2, 0), d = proj(x3, y3, 0);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function lineQuad(xa, ya, xb, yb, halfW, fill) {
  // a court line as a ground quad (perspective correct)
  if (Math.abs(xa - xb) > Math.abs(ya - yb)) {
    quad(xa, ya - halfW, xb, yb - halfW, xb, yb + halfW, xa, ya + halfW, fill);
  } else {
    quad(xa - halfW, ya, xb - halfW, yb, xb + halfW, yb, xa + halfW, ya, fill);
  }
}

function drawCourtStatic() {
  // backstop wall & sky band
  const wallBottom = proj(0, 27.5, 0).y;
  let grad = ctx.createLinearGradient(0, 0, 0, wallBottom);
  grad.addColorStop(0, '#0f2c1e');
  grad.addColorStop(1, '#1d4a35');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, wallBottom + 1);

  // the crowd — quiet rows of spectators in summer dress
  if (!crowdDots) {
    crowdDots = [];
    const rows = 7;
    for (let r = 0; r < rows; r++) {
      const ry = wallBottom * (0.42 + 0.075 * r);
      const size = (1.6 + r * 0.32) * (W / 900);
      const gap = size * rand(4.2, 4.8);
      for (let x = rand(0, gap); x < W; x += gap * rand(0.75, 1.3)) {
        const hue = Math.random();
        const c = hue < 0.45
          ? `hsla(${rand(36, 55)}, ${rand(30, 55)}%, ${rand(68, 86)}%, ${rand(0.3, 0.5)})`  // creams & straw
          : hue < 0.7
            ? `hsla(${rand(190, 230)}, ${rand(18, 35)}%, ${rand(55, 75)}%, ${rand(0.25, 0.42)})` // pale blues
            : `hsla(${rand(80, 140)}, ${rand(15, 30)}%, ${rand(45, 65)}%, ${rand(0.22, 0.38)})`; // soft greens
        crowdDots.push({ x: x + rand(-2, 2), y: ry + rand(-1.5, 1.5), r: size, c });
      }
    }
  }
  for (const d of crowdDots) {
    // head + shoulders
    ctx.fillStyle = d.c;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(d.x, d.y + d.r * 0.9, d.r, d.r * 0.55, 0, Math.PI, 0, true);
    ctx.fill();
  }

  // a shadowed gallery overhang above the crowd
  const galleryGrad = ctx.createLinearGradient(0, 0, 0, wallBottom * 0.42);
  galleryGrad.addColorStop(0, 'rgba(5, 18, 11, 0.55)');
  galleryGrad.addColorStop(1, 'rgba(5, 18, 11, 0)');
  ctx.fillStyle = galleryGrad;
  ctx.fillRect(0, 0, W, wallBottom * 0.42);

  // club lettering on the wall
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#c9a227';
  ctx.font = `600 ${Math.max(10, W * 0.014)}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.letterSpacing = '0.4em';
  ctx.fillText('T H E   L A W N   C L U B', W / 2, wallBottom * 0.3);
  ctx.restore();

  // purple & gold trim at the wall base
  ctx.fillStyle = '#3c1053';
  ctx.fillRect(0, wallBottom - Math.max(3, W * 0.006), W, Math.max(3, W * 0.006));
  ctx.fillStyle = 'rgba(201,162,39,0.7)';
  ctx.fillRect(0, wallBottom, W, 1.5);

  // lawn (runoff) — everything below the wall
  const wb = Math.floor(wallBottom);
  ctx.fillStyle = '#40763c';
  ctx.fillRect(0, wb, W, H - wb + 1);

  // mown stripes across the court surround
  for (let i = -2; i < 12; i++) {
    const y0 = i * 2.377, y1 = y0 + 2.377;
    if (i % 2 === 0) quad(-9.5, y1, 9.5, y1, 9.5, y0, -9.5, y0, 'rgba(255,255,240,0.05)');
    else quad(-9.5, y1, 9.5, y1, 9.5, y0, -9.5, y0, 'rgba(6,30,10,0.06)');
  }

  // court proper — slightly worn track
  quad(-CT.halfD - 0.6, CT.len + 1, CT.halfD + 0.6, CT.len + 1, CT.halfD + 0.6, -1, -CT.halfD - 0.6, -1, 'rgba(120,150,80,0.16)');
  // baseline wear
  quad(-CT.halfS, 1.1, CT.halfS, 1.1, CT.halfS, -0.6, -CT.halfS, -0.6, 'rgba(168,178,110,0.14)');
  quad(-CT.halfS, CT.len + 0.6, CT.halfS, CT.len + 0.6, CT.halfS, CT.len - 1.1, -CT.halfS, CT.len - 1.1, 'rgba(168,178,110,0.12)');

  // chalk lines
  const LW = 0.05;
  const chalk = 'rgba(248,246,235,0.92)';
  const chalkDim = 'rgba(248,246,235,0.7)';
  lineQuad(-CT.halfD, 0, CT.halfD, 0, LW * 1.4, chalk);            // near baseline
  lineQuad(-CT.halfD, CT.len, CT.halfD, CT.len, LW, chalk);        // far baseline
  lineQuad(-CT.halfD, 0, -CT.halfD, CT.len, LW, chalkDim);         // doubles sidelines
  lineQuad(CT.halfD, 0, CT.halfD, CT.len, LW, chalkDim);
  lineQuad(-CT.halfS, 0, -CT.halfS, CT.len, LW, chalk);            // singles sidelines
  lineQuad(CT.halfS, 0, CT.halfS, CT.len, LW, chalk);
  lineQuad(-CT.halfS, CT.svcNear, CT.halfS, CT.svcNear, LW, chalk); // service lines
  lineQuad(-CT.halfS, CT.svcFar, CT.halfS, CT.svcFar, LW, chalk);
  lineQuad(0, CT.svcNear, 0, CT.svcFar, LW, chalk);                 // centre service line
  lineQuad(0, 0, 0, 0.35, LW, chalk);                               // centre marks
  lineQuad(0, CT.len - 0.35, 0, CT.len, LW, chalk);
}

function drawScene(now) {
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(courtLayer, 0, 0, W, H);

  // service box highlight during a serve
  if ((G.phase === 'serve-ready' || G.phase === 'serve-toss' || G.phase === 'pro-serve') || (ball.isServe && ball.active)) {
    const b = serveBox();
    const pulse = 0.05 + 0.03 * Math.sin(now / 300);
    quad(b.x0, b.y1, b.x1, b.y1, b.x1, b.y0, b.x0, b.y0, `rgba(255,244,180,${pulse})`);
  }

  // bounce chalk puff
  if (lastBounceMark) {
    const age = (now - lastBounceMark.t) / 900;
    if (age < 1) {
      const p = proj(lastBounceMark.x, lastBounceMark.y, 0);
      ctx.strokeStyle = `rgba(255,252,235,${0.5 * (1 - age)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.s * 0.12 * (0.5 + age), p.s * 0.05 * (0.5 + age), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else lastBounceMark = null;
  }

  drawPro();

  const ballBehindNet = ball.active && ball.y > CT.netY;
  if (ballBehindNet) drawBall(now);
  ctx.drawImage(netLayer, 0, 0, W, H);
  if (!ballBehindNet && ball.active) drawBall(now);

  drawRacket(now);
}

function drawNet() {
  const lp = proj(-CT.postX, CT.netY, 0);
  const rp = proj(CT.postX, CT.netY, 0);
  const lt = proj(-CT.postX, CT.netY, 1.07);
  const rt = proj(CT.postX, CT.netY, 1.07);
  const ct = proj(0, CT.netY, CT.netH);

  // mesh
  ctx.beginPath();
  ctx.moveTo(lt.x, lt.y);
  ctx.quadraticCurveTo(ct.x, ct.y + (ct.y - proj(0, CT.netY, 0).y) * -0.02, rt.x, rt.y);
  ctx.lineTo(rp.x, rp.y);
  ctx.lineTo(lp.x, lp.y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(20,40,30,0.42)';
  ctx.fill();

  // net grid
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(235,240,230,0.28)';
  ctx.lineWidth = 0.6;
  const step = Math.max(4, (rp.x - lp.x) / 60);
  for (let x = lp.x; x <= rp.x; x += step) {
    ctx.beginPath(); ctx.moveTo(x, lt.y - 4); ctx.lineTo(x, lp.y + 2); ctx.stroke();
  }
  for (let y = Math.min(lt.y, ct.y); y <= lp.y; y += step * 0.8) {
    ctx.beginPath(); ctx.moveTo(lp.x, y); ctx.lineTo(rp.x, y); ctx.stroke();
  }
  ctx.restore();

  // white band
  ctx.beginPath();
  ctx.moveTo(lt.x, lt.y);
  ctx.quadraticCurveTo(ct.x, ct.y, rt.x, rt.y);
  ctx.lineWidth = Math.max(2.5, lp.s * 0.07);
  ctx.strokeStyle = '#f5f2e6';
  ctx.stroke();

  // posts
  ctx.lineWidth = Math.max(2.5, lp.s * 0.06);
  ctx.strokeStyle = '#123626';
  ctx.beginPath(); ctx.moveTo(lp.x, lp.y); ctx.lineTo(lt.x, lt.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rp.x, rp.y); ctx.lineTo(rt.x, rt.y); ctx.stroke();
}

function drawPro() {
  const p0 = proj(ai.x, ai.y, 0);
  const s = p0.s;

  // shadow
  ctx.fillStyle = 'rgba(10,30,15,0.28)';
  ctx.beginPath();
  ctx.ellipse(p0.x, p0.y, s * 0.42, s * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();

  const zy = (z) => proj(ai.x, ai.y, z).y;
  const bob = Math.sin(ai.phaseT * 7) * (Math.abs(ai.lean) > 0.1 ? s * 0.015 : 0);
  const lean = ai.lean * s * 0.12;

  // legs
  ctx.strokeStyle = '#e8dcc8';
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.lineCap = 'round';
  const hipY = zy(0.85) + bob;
  const strideL = Math.sin(ai.phaseT * 9) * s * 0.08 * clamp(Math.abs(ai.lean) * 3, 0, 1);
  ctx.beginPath(); ctx.moveTo(p0.x - s * 0.09 + lean * 0.3, hipY); ctx.lineTo(p0.x - s * 0.13 + strideL, p0.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(p0.x + s * 0.09 + lean * 0.3, hipY); ctx.lineTo(p0.x + s * 0.13 - strideL, p0.y); ctx.stroke();

  // torso — club whites
  const shY = zy(1.45) + bob;
  ctx.beginPath();
  ctx.moveTo(p0.x - s * 0.17 + lean, shY);
  ctx.lineTo(p0.x + s * 0.17 + lean, shY);
  ctx.lineTo(p0.x + s * 0.14 + lean * 0.4, hipY);
  ctx.lineTo(p0.x - s * 0.14 + lean * 0.4, hipY);
  ctx.closePath();
  ctx.fillStyle = '#f7f3e8';
  ctx.fill();
  ctx.strokeStyle = 'rgba(26,92,56,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // head
  const headY = zy(1.66) + bob;
  ctx.beginPath();
  ctx.arc(p0.x + lean, headY, s * 0.105, 0, Math.PI * 2);
  ctx.fillStyle = '#d9a878';
  ctx.fill();
  // cap
  ctx.beginPath();
  ctx.arc(p0.x + lean, headY - s * 0.02, s * 0.105, Math.PI, 0);
  ctx.fillStyle = '#f7f3e8';
  ctx.fill();

  // racket arm
  const armX = p0.x + lean + (ai.lean >= 0 ? 1 : -1) * s * 0.3;
  const armY = zy(1.25) + bob;
  ctx.strokeStyle = '#d9a878';
  ctx.lineWidth = Math.max(2, s * 0.06);
  ctx.beginPath(); ctx.moveTo(p0.x + lean + (ai.lean >= 0 ? 1 : -1) * s * 0.14, zy(1.38) + bob); ctx.lineTo(armX, armY); ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(armX, armY - s * 0.09, s * 0.085, s * 0.11, 0.3, 0, Math.PI * 2);
  ctx.strokeStyle = '#7a4a2a';
  ctx.lineWidth = Math.max(1.5, s * 0.035);
  ctx.stroke();
}

function drawBall(now) {
  // shadow
  const sh = proj(ball.x, ball.y, 0);
  const heightFade = clamp(1 - ball.z / 6, 0.25, 0.8);
  ctx.fillStyle = `rgba(8,26,12,${0.3 * heightFade})`;
  ctx.beginPath();
  ctx.ellipse(sh.x, sh.y, Math.max(2, sh.s * 0.075), Math.max(1, sh.s * 0.03), 0, 0, Math.PI * 2);
  ctx.fill();

  const p = proj(ball.x, ball.y, ball.z);
  const r = Math.max(2.5, p.s * 0.085);

  // trail
  ball.trail.push({ x: p.x, y: p.y, r });
  if (ball.trail.length > 7) ball.trail.shift();
  for (let i = 0; i < ball.trail.length - 1; i++) {
    const t = ball.trail[i];
    ctx.fillStyle = `rgba(213,229,88,${0.06 + i * 0.03})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r * (0.5 + i * 0.07), 0, Math.PI * 2);
    ctx.fill();
  }

  const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.2, p.x, p.y, r);
  g.addColorStop(0, '#eaf67a');
  g.addColorStop(1, '#b8ce2e');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();

  if (r > 4) {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(0.8, r * 0.13);
    const rot = now / 900 + ball.spin * now / 200;
    ctx.beginPath();
    ctx.arc(p.x - r * 0.9, p.y, r * 1.25, -0.5 + rot % 0.4, 0.5 + rot % 0.4);
    ctx.stroke();
  }
}

function drawRacket(now) {
  if (!pointer.inside || G.phase === 'idle' || G.phase === 'match-over') return;
  const x = pointer.x, y = pointer.y;
  const sc = 0.8 + 0.4 * clamp(y / H, 0, 1); // a touch bigger nearer the camera
  const ang = Math.abs(pointer.speed) > 60
    ? Math.atan2(pointer.vy, pointer.vx) + Math.PI / 2
    : -0.35;

  // motion smear
  if (pointer.speed > W * 0.9) {
    ctx.strokeStyle = 'rgba(247,243,232,0.18)';
    ctx.lineWidth = 10 * sc;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - pointer.vx * 0.03, y - pointer.vy * 0.03);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang * 0.25 - 0.3);
  ctx.scale(sc, sc);

  // handle
  ctx.strokeStyle = '#5b3b22';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(0, 62); ctx.stroke();
  ctx.strokeStyle = '#2f2317';
  ctx.beginPath(); ctx.moveTo(0, 52); ctx.lineTo(0, 62); ctx.stroke();

  // head
  ctx.beginPath();
  ctx.ellipse(0, 0, 24, 32, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#7a4a2a';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, 24, 32, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#caa06a';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // strings
  ctx.strokeStyle = 'rgba(245,242,230,0.55)';
  ctx.lineWidth = 0.9;
  for (let i = -3; i <= 3; i++) {
    const dx = i * 6;
    const yy = 30 * Math.sqrt(Math.max(0, 1 - (dx / 24) ** 2));
    ctx.beginPath(); ctx.moveTo(dx, -yy); ctx.lineTo(dx, yy); ctx.stroke();
  }
  for (let i = -4; i <= 4; i++) {
    const dy = i * 7;
    const xx = 22 * Math.sqrt(Math.max(0, 1 - (dy / 32) ** 2));
    ctx.beginPath(); ctx.moveTo(-xx, dy); ctx.lineTo(xx, dy); ctx.stroke();
  }
  ctx.restore();
}

/* ============================================================
   Main loop
   ============================================================ */

let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  updatePointerVelocity();

  const active = G.phase !== 'idle' && G.phase !== 'match-over';
  if (active) {
    const steps = Math.max(1, Math.round(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      stepBall(h);
      if (!ball.active) break;
    }
    tryPlayerHit(dt);
    updateAI(dt);
  }

  drawScene(now);
  pointer.prevX = pointer.x;
  pointer.prevY = pointer.y;
  requestAnimationFrame(frame);
}

/* ============================================================
   Match setup & page glue
   ============================================================ */

function startMatch() {
  G.token++;
  G.phase = 'idle';
  G.server = 'you';
  G.points.you = 0; G.points.pro = 0;
  G.games.you = 0; G.games.pro = 0;
  G.faults = 0;
  G.rallyHits = 0;
  ball.active = false;
  ball.trail = [];
  ai.x = 0; ai.y = ai.homeY; ai.plan = null;
  overlay.classList.add('hidden');
  wrap.classList.add('playing');
  updateScoreboard();
  call('First game — your serve');
  const token = G.token;
  setTimeout(() => { if (token === G.token) setupServe(); }, 1600);
}

playBtn.addEventListener('click', () => {
  audio.ensure();
  startMatch();
});

const soundBtn = document.getElementById('soundToggle');
soundBtn.setAttribute('aria-pressed', String(!audio.muted));
soundBtn.addEventListener('click', () => {
  audio.ensure();
  const nowMuted = !audio.muted;
  audio.setMuted(nowMuted);
  soundBtn.setAttribute('aria-pressed', String(!nowMuted));
});

updateScoreboard();
requestAnimationFrame(frame);

/* hooks for automated verification */
window.__lawn = { G, ball, ai, awardPoint, setupServe, startMatch, proj, pointer };
