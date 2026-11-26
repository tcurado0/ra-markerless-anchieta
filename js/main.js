// =============================================================================
// main.js — Orquestra o app: câmera, sensores, renderização, HUD e calibração
// =============================================================================
import { CAMPUS_CENTER, SETTINGS } from './config.js';
import { GpsTracker, toENU, fromENU, haversine, cardinal, validateDistances } from './geo.js';
import { OrientationSensor, headingPitch } from './orientation.js';
import { PinRenderer } from './renderer.js';
import { DEG } from './math3d.js';
import {
  loadPoints, savePoints, clearSaved, exportPoints, importPoints, loadNumber, saveNumber,
} from './points.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

const state = {
  mode: null,              // 'ar' | 'sim'
  points: [],
  pointsOrigin: '',
  origin: CAMPUS_CENTER,   // origem do sistema ENU (metros)
  user: null,              // posição ENU do usuário [e, n]
  fovLong: loadNumber('ra-anchieta-fov-v1', 63),
  sim: { e: 0, n: 0, heading: 0, pitch: 0, keys: new Set() },
  nearest: null,
  arrivedId: null,
};

const gps = new GpsTracker();
const orient = new OrientationSensor();
orient.manualOffset = loadNumber(SETTINGS.headingOffsetKey, 0);
let renderer = null;
let labelEls = new Map();

// ---------------------------------------------------------------------------
// Utilidades de interface
// ---------------------------------------------------------------------------
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function fmtDist(d) {
  return d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(d < 10000 ? 2 : 1)} km`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
async function init() {
  const r = await loadPoints();
  state.points = r.points;
  state.pointsOrigin = r.origem;
  rebuildLabels();

  if (!window.isSecureContext) {
    const w = $('#start-warn');
    w.hidden = false;
    w.textContent = 'Atenção: câmera, GPS e bússola só funcionam em HTTPS. Abra o app pelo link hospedado (https://…).';
  }

  $('#btn-start').onclick = startAR;
  $('#btn-sim').onclick = startSim;
  $('#btn-config').onclick = openConfig;
  $('#btn-config2').onclick = openConfig;
  $('#btn-close-config').onclick = closeConfig;
  $('#btn-debug').onclick = () => ($('#debug').hidden = !$('#debug').hidden);
  setupConfigPanel();
  setupSimControls();

  gps.onChange((pos, err) => {
    if (state.mode === 'ar' && pos) state.user = toENU(state.origin, pos);
    updateGpsChip(pos, err);
  });

  // Atalho de teste: ?sim=1&e=0&n=0&h=0&p=0
  if (params.get('sim') === '1') {
    state.sim.e = Number(params.get('e') || 0);
    state.sim.n = Number(params.get('n') || 0);
    state.sim.heading = Number(params.get('h') || 0);
    state.sim.pitch = Number(params.get('p') || 0);
    startSim();
    if (params.get('config') === '1') openConfig();
  }
}

function showHUD() {
  $('#start').hidden = true;
  $('#hud').hidden = false;
  $('#radar').hidden = false;
  $('#guide').hidden = false;
}

async function startAR() {
  const btn = $('#btn-start');
  btn.disabled = true;
  btn.textContent = 'Solicitando permissões…';
  try {
    // 1) Sensores de movimento (no iOS precisa ser dentro do clique)
    try { await orient.requestPermission(); } catch (e) { toast(e.message, 4000); }
    orient.start();
    // 2) Câmera traseira
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    const v = $('#camera');
    v.srcObject = stream;
    await v.play().catch(() => {});
    // 3) GPS
    gps.start();
    state.mode = 'ar';
    showHUD();
    startLoop();
    setTimeout(() => {
      if (!orient.hasData) toast('Sem dados da bússola/giroscópio. Use um celular com sensores.', 5000);
    }, 2500);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Iniciar Realidade Aumentada';
    const w = $('#start-warn');
    w.hidden = false;
    w.textContent = 'Não foi possível acessar a câmera: ' + (e.message || e.name) +
      '. Verifique as permissões do navegador (e se o site está em HTTPS).';
  }
}

function startSim() {
  state.mode = 'sim';
  $('#camera').hidden = true;
  $('#sky').hidden = false;
  $('#simpad').hidden = false;
  showHUD();
  applySimPosition();
  toast('Simulação: arraste para olhar em volta, use ▲▼ ou W/A/S/D para andar.', 4500);
  startLoop();
}

function applySimPosition() {
  const s = state.sim;
  state.user = [s.e, s.n, 0];
  const ll = fromENU(state.origin, s.e, s.n);
  gps.setManual(ll.lat, ll.lon, 3);
  orient.setManual(s.heading, s.pitch);
}

let looping = false;
function startLoop() {
  if (looping) return;
  looping = true;
  try {
    renderer = new PinRenderer($('#gl'));
  } catch (e) {
    toast('Erro no WebGL: ' + e.message, 6000);
    return;
  }
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state.mode === 'sim') stepSim(dt);
    render(now / 1000);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Campo de visão real da câmera (considera o corte do object-fit: cover)
// ---------------------------------------------------------------------------
function currentFovY() {
  const sw = window.innerWidth, sh = window.innerHeight;
  const v = $('#camera');
  let vw = v.videoWidth, vh = v.videoHeight;
  if (state.mode !== 'ar' || !vw || !vh) {
    // simulação: lado maior da tela recebe fovLong
    const long = state.fovLong * DEG;
    if (sh >= sw) return state.fovLong;
    return (2 * Math.atan(Math.tan(long / 2) * (sh / sw))) / DEG;
  }
  const long = state.fovLong * DEG;
  const vFovVideo = vh >= vw ? long : 2 * Math.atan(Math.tan(long / 2) * (vh / vw));
  const scale = Math.max(sw / vw, sh / vh);
  const visible = sh / (vh * scale);
  return (2 * Math.atan(Math.tan(vFovVideo / 2) * visible)) / DEG;
}

// ---------------------------------------------------------------------------
// Laço de renderização
// ---------------------------------------------------------------------------
function render(t) {
  const q = orient.update(state.mode === 'sim' ? 1 : 0.22);
  const { heading, pitch } = headingPitch(q);
  const user = state.user;
  updateHeadingChip(heading);

  if (state.mode === 'sim') {
    // horizonte do fundo acompanha a inclinação
    const fov = currentFovY();
    const y = 50 + (Math.tan(pitch * DEG) / Math.tan((fov / 2) * DEG)) * 50;
    $('#sky').style.setProperty('--horizon', `${Math.max(-50, Math.min(150, y))}%`);
  }

  if (!user || !renderer) {
    renderer && renderer.setCamera(q, [0, 0, SETTINGS.eyeHeight], currentFovY());
    renderer && renderer.begin();
    hideAllLabels();
    drawRadar(heading, []);
    updateGuide(null, heading);
    updateDebug(heading, pitch, []);
    return;
  }

  const eye = [user[0], user[1], SETTINGS.eyeHeight];
  renderer.setCamera(q, eye, currentFovY());
  renderer.begin();
  if (state.mode === 'sim') renderer.drawGrid(eye);

  // Calcula distância/rumo de cada ponto e desenha do mais longe para o mais perto
  const items = state.points.map((p, i) => {
    const pos = toENU(state.origin, p);
    const de = pos[0] - user[0], dn = pos[1] - user[1];
    const dist = Math.hypot(de, dn);
    const brg = ((Math.atan2(de, dn) / DEG) + 360) % 360;
    return { p, i, pos, dist, brg };
  }).filter((it) => it.dist < SETTINGS.maxRenderDistance);
  items.sort((a, b) => b.dist - a.dist);

  for (const it of items) {
    const h = SETTINGS.pinBaseHeight + it.dist * SETTINGS.pinHeightPerMeter;
    const near = it.dist <= SETTINGS.arriveRadius;
    const bob = Math.sin(t * 2 + it.i) * 0.04 * h;     // flutua levemente
    const sway = Math.sin(t * 0.9 + it.i) * 0.35;       // gira um pouco (mostra o volume 3D)
    const ringR = h * (0.32 + 0.05 * Math.sin(t * 3 + it.i));
    renderer.drawRing(it.pos, ringR, near ? [0.12, 0.62, 0.33] : [0.97, 0.72, 0.1], 0.55);
    it.top = [it.pos[0], it.pos[1], h * 1.04 + bob];
    renderer.drawPin([it.pos[0], it.pos[1], bob + h * 0.02], h, {
      yaw: sway, color: near ? [0.12, 0.62, 0.33] : renderer.pinColor,
    });
  }

  placeLabels(items);
  const byNear = [...items].sort((a, b) => a.dist - b.dist);
  drawRadar(heading, byNear);
  updateGuide(byNear[0] || null, heading);
  updateDebug(heading, pitch, byNear);
}

// ---------------------------------------------------------------------------
// Nomes acima dos pinos (HTML) — com prevenção simples de sobreposição
// ---------------------------------------------------------------------------
function rebuildLabels() {
  const box = $('#labels');
  box.innerHTML = '';
  labelEls = new Map();
  state.points.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'label';
    el.innerHTML = `<b>${esc(p.nome)}</b><span></span>`;
    el.style.display = 'none';
    box.appendChild(el);
    labelEls.set(p.id, el);
  });
}

function hideAllLabels() { labelEls.forEach((el) => (el.style.display = 'none')); }

function placeLabels(items) {
  const placed = [];
  const W = window.innerWidth, H = window.innerHeight;
  const sorted = [...items].sort((a, b) => a.dist - b.dist); // mais perto tem prioridade
  const seen = new Set();
  for (const it of sorted) {
    const el = labelEls.get(it.p.id);
    if (!el) continue;
    seen.add(it.p.id);
    const s = renderer.project(it.top);
    if (!s || s.x < -150 || s.x > W + 150 || s.y < -100 || s.y > H + 200) { el.style.display = 'none'; continue; }
    el.style.display = 'block';
    el.classList.toggle('near', it.dist <= SETTINGS.arriveRadius);
    const span = el.lastChild;
    const txt = it.dist <= SETTINGS.arriveRadius ? `Você chegou · ${fmtDist(it.dist)}` : fmtDist(it.dist);
    if (span.textContent !== txt) span.textContent = txt;
    const w = el.offsetWidth, h = el.offsetHeight;
    const scale = Math.max(0.72, Math.min(1.1, 1.15 - it.dist / 900));
    let x = s.x - w / 2, y = s.y - h - 10;
    // empurra para cima enquanto colidir com um rótulo já posicionado
    for (let guard = 0; guard < 8; guard++) {
      const hit = placed.find((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);
      if (!hit) break;
      y = hit.y - h - 6;
    }
    placed.push({ x, y, w, h });
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;
    el.style.zIndex = String(1000 - Math.round(it.dist));
    el.style.opacity = it.dist > 600 ? '0.85' : '1';
  }
  labelEls.forEach((el, id) => { if (!seen.has(id)) el.style.display = 'none'; });
}

// ---------------------------------------------------------------------------
// Radar (mini-mapa que gira com o celular)
// ---------------------------------------------------------------------------
function drawRadar(heading, items) {
  const c = $('#radar'), ctx = c.getContext('2d');
  const S = c.width, R = S / 2 - 8, cx = S / 2, cy = S / 2;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(7,42,102,.78)';
  ctx.beginPath(); ctx.arc(cx, cy, R + 6, 0, Math.PI * 2); ctx.fill();
  // cone de visão
  const half = (currentFovY() * (window.innerWidth / window.innerHeight)) / 2;
  ctx.fillStyle = 'rgba(249,184,27,.22)';
  ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, (-90 - half) * DEG, (-90 + half) * DEG); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2;
  [R / 2, R].forEach((r) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); });
  const maxD = Math.max(150, Math.min(600, (items[items.length - 1]?.dist || 150) * 1.1));
  // Norte
  const nA = (-heading - 90) * DEG;
  ctx.fillStyle = '#f9b81b'; ctx.font = 'bold 26px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', cx + Math.cos(nA) * (R - 14), cy + Math.sin(nA) * (R - 14));
  // pontos
  items.forEach((it) => {
    const a = (it.brg - heading - 90) * DEG;
    const r = Math.min(R - 4, (it.dist / maxD) * R);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    ctx.fillStyle = it.dist <= SETTINGS.arriveRadius ? '#22c55e' : '#ef4444';
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
  });
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx + 9, cy + 9); ctx.lineTo(cx - 9, cy + 9); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 18px system-ui';
  ctx.fillText(`${Math.round(maxD)} m`, cx, cy + R - 6);
}

// ---------------------------------------------------------------------------
// Cartão inferior: prédio mais próximo e para onde virar
// ---------------------------------------------------------------------------
function updateGuide(it, heading) {
  const g = $('#guide');
  if (!it) {
    $('#guide-name').textContent = state.user ? 'Nenhum ponto cadastrado' : 'Aguardando GPS…';
    $('#guide-info').textContent = state.user ? 'Abra ⚙︎ para adicionar pontos.' : 'Vá para um local aberto.';
    return;
  }
  const turn = ((it.brg - heading + 540) % 360) - 180;
  const arrived = it.dist <= SETTINGS.arriveRadius;
  g.classList.toggle('arrived', arrived);
  $('#guide-arrow').style.transform = `rotate(${(turn - 90).toFixed(0)}deg)`;
  $('#guide-name').textContent = (arrived ? 'Você chegou: ' : 'Mais próximo: ') + it.p.nome;
  let dir;
  if (Math.abs(turn) < 12) dir = 'em frente';
  else dir = `vire ${Math.abs(Math.round(turn))}° à ${turn > 0 ? 'direita' : 'esquerda'}`;
  $('#guide-info').textContent = `${fmtDist(it.dist)} · ${dir} · rumo ${Math.round(it.brg)}° ${cardinal(it.brg)}`;
  if (arrived && state.arrivedId !== it.p.id) {
    state.arrivedId = it.p.id;
    toast(`📍 Você chegou ao ${it.p.nome}!`);
    if (navigator.vibrate) navigator.vibrate(120);
  } else if (!arrived && state.arrivedId === it.p.id) {
    state.arrivedId = null;
  }
}

function updateHeadingChip(h) {
  const el = $('#chip-heading');
  el.textContent = orient.hasData ? `${Math.round(h)}° ${cardinal(h)}` : 'sem bússola';
}

function updateGpsChip(pos, err) {
  const el = $('#chip-gps');
  if (err) { el.textContent = 'GPS: ' + err; el.className = 'chip bad'; return; }
  if (!pos) return;
  if (state.mode === 'sim') { el.textContent = 'Simulação'; el.className = 'chip'; return; }
  el.textContent = `GPS ±${Math.round(pos.accuracy)} m`;
  el.className = 'chip ' + (pos.accuracy <= 15 ? 'ok' : pos.accuracy > 40 ? 'bad' : '');
}

function updateDebug(heading, pitch, items) {
  const d = $('#debug');
  if (d.hidden) return;
  const p = gps.position;
  d.textContent = [
    `modo     : ${state.mode}`,
    `lat/lon  : ${p ? p.lat.toFixed(6) + ', ' + p.lon.toFixed(6) : '-'}`,
    `precisão : ${p ? '±' + p.accuracy.toFixed(1) + ' m' : '-'}`,
    `rumo     : ${heading.toFixed(1)}°  incl: ${pitch.toFixed(1)}°`,
    `sensor   : ${orient.source}`,
    `offset   : bússola ${(orient.compassOffset || 0).toFixed(1)}° + manual ${orient.manualOffset}°`,
    `fovY     : ${currentFovY().toFixed(1)}°`,
    `pontos   : ${state.pointsOrigin}`,
    ...items.map((it) => `  ${it.p.nome.padEnd(11)} ${fmtDist(it.dist).padStart(7)}  ${Math.round(it.brg)}°`),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Modo simulação (testar no PC sem ir ao campus)
// ---------------------------------------------------------------------------
function setupSimControls() {
  const keymap = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
  addEventListener('keydown', (e) => {
    if (state.mode !== 'sim' || e.target.tagName === 'INPUT') return;
    if (keymap[e.code]) { state.sim.keys.add(keymap[e.code]); e.preventDefault(); }
    if (e.shiftKey) state.sim.keys.add('run');
  });
  addEventListener('keyup', (e) => {
    if (keymap[e.code]) state.sim.keys.delete(keymap[e.code]);
    if (!e.shiftKey) state.sim.keys.delete('run');
  });
  $('#simpad').querySelectorAll('button').forEach((b) => {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); state.sim.keys.add(k); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => state.sim.keys.delete(k)));
  });
  let drag = null;
  addEventListener('pointerdown', (e) => {
    if (state.mode !== 'sim' || e.target.closest('button, .screen, #guide, #simpad')) return;
    drag = { x: e.clientX, y: e.clientY, h: state.sim.heading, p: state.sim.pitch };
  });
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    state.sim.heading = (drag.h - (e.clientX - drag.x) * 0.25 + 360) % 360;
    state.sim.pitch = Math.max(-45, Math.min(45, drag.p + (e.clientY - drag.y) * 0.2));
    applySimPosition();
  });
  addEventListener('pointerup', () => (drag = null));
}

function stepSim(dt) {
  const s = state.sim, k = s.keys;
  if (!k.size) return;
  const speed = k.has('run') ? 12 : 4; // m/s
  if (k.has('left')) s.heading = (s.heading - 70 * dt + 360) % 360;
  if (k.has('right')) s.heading = (s.heading + 70 * dt) % 360;
  const dir = (k.has('fwd') ? 1 : 0) - (k.has('back') ? 1 : 0);
  if (dir) {
    s.e += Math.sin(s.heading * DEG) * speed * dt * dir;
    s.n += Math.cos(s.heading * DEG) * speed * dt * dir;
  }
  applySimPosition();
}

// ---------------------------------------------------------------------------
// Tela de configuração / calibração dos pontos
// ---------------------------------------------------------------------------
function openConfig() {
  $('#config').hidden = false;
  renderConfig();
}

function closeConfig() { $('#config').hidden = true; }

function renderConfig() {
  $('#config-origin').textContent = `Pontos carregados de: ${state.pointsOrigin}.`;
  const list = $('#points-list');
  list.innerHTML = '';
  const here = gps.position;
  state.points.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'pt';
    const dist = here ? fmtDist(haversine(here, p)) + ' de você' : '';
    div.innerHTML = `
      <div class="grid">
        <input data-f="nome" value="${esc(p.nome)}" aria-label="Nome">
        <input data-f="lat" value="${p.lat.toFixed(6)}" inputmode="decimal" aria-label="Latitude">
        <input data-f="lon" value="${p.lon.toFixed(6)}" inputmode="decimal" aria-label="Longitude">
        <button class="mark">📍 Marcar aqui</button>
      </div>
      <div class="meta"><span>${dist}</span><button class="del">remover</button></div>`;
    div.querySelectorAll('input').forEach((inp) => {
      inp.onchange = () => {
        const f = inp.dataset.f;
        if (f === 'nome') p.nome = inp.value.trim().slice(0, 40) || p.nome;
        else {
          const v = Number(inp.value.replace(',', '.'));
          if (isFinite(v)) p[f] = v; else inp.value = p[f];
        }
        renderValidation();
      };
    });
    div.querySelector('.mark').onclick = () => markHere(p, div);
    div.querySelector('.del').onclick = () => {
      if (!confirmSafe(`Remover "${p.nome}"?`)) return;
      state.points.splice(i, 1);
      renderConfig();
    };
    list.appendChild(div);
  });
  renderValidation();
  $('#in-offset').value = orient.manualOffset;
  $('#v-offset').textContent = `${orient.manualOffset}°`;
  $('#in-fov').value = state.fovLong;
  $('#v-fov').textContent = `${state.fovLong}°`;
}

function confirmSafe(msg) { try { return window.confirm(msg); } catch (e) { return true; } }

async function markHere(p, div) {
  if (state.mode === 'sim' || !('geolocation' in navigator)) {
    if (!gps.position) return toast('Sem posição atual.');
    p.lat = gps.position.lat; p.lon = gps.position.lon;
    toast(`${p.nome} marcado na posição atual.`);
    return renderConfig();
  }
  div.classList.add('busy');
  const btn = div.querySelector('.mark');
  try {
    const r = await gps.sample(SETTINGS.calibrationSeconds, (f, n) => {
      btn.textContent = `Medindo… ${Math.round(f * 100)}% (${n})`;
    });
    p.lat = r.lat; p.lon = r.lon;
    toast(`${p.nome} marcado (±${Math.round(r.accuracy)} m, ${r.n} leituras). Toque em Salvar.`, 4000);
  } catch (e) {
    toast(e.message, 4000);
  }
  renderConfig();
}

function renderValidation() {
  const pairs = validateDistances(state.points);
  const bad = pairs.filter((x) => !x.ok);
  const box = $('#validation');
  const summary = bad.length
    ? `<p class="val-summary bad">⚠️ ${bad.length} par(es) com menos de ${SETTINGS.minDistance} m</p>`
    : `<p class="val-summary ok">✔ Todos os ${pairs.length} pares estão a ≥ ${SETTINGS.minDistance} m</p>`;
  const rows = pairs.sort((a, b) => a.d - b.d)
    .map((x) => `<span>${esc(x.a.nome)} ↔ ${esc(x.b.nome)}</span><span class="${x.ok ? 'ok' : 'bad'}">${fmtDist(x.d)}</span>`)
    .join('');
  box.innerHTML = summary + `<div class="val">${rows}</div>`;
}

function setupConfigPanel() {
  $('#btn-add').onclick = () => {
    const base = gps.position || state.origin;
    const n = state.points.length + 1;
    state.points.push({ id: `ponto${Date.now()}`, nome: `Ponto ${n}`, lat: base.lat, lon: base.lon });
    renderConfig();
  };
  $('#btn-save').onclick = () => {
    const ok = savePoints(state.points);
    state.pointsOrigin = 'calibração salva neste aparelho';
    rebuildLabels();
    toast(ok ? 'Pontos salvos neste aparelho.' : 'Não foi possível salvar (modo anônimo?).');
    renderConfig();
  };
  $('#btn-export').onclick = () => exportPoints(state.points);
  $('#in-import').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      state.points = await importPoints(f);
      savePoints(state.points);
      state.pointsOrigin = 'arquivo importado';
      rebuildLabels();
      renderConfig();
      toast('Pontos importados e salvos.');
    } catch (err) { toast('Erro ao importar: ' + err.message, 4000); }
    e.target.value = '';
  };
  $('#btn-reset').onclick = async () => {
    if (!confirmSafe('Apagar a calibração deste aparelho e voltar ao padrão?')) return;
    clearSaved();
    const r = await loadPoints();
    state.points = r.points; state.pointsOrigin = r.origem;
    rebuildLabels(); renderConfig();
    toast('Pontos restaurados.');
  };
  $('#in-offset').oninput = (e) => {
    orient.manualOffset = Number(e.target.value);
    $('#v-offset').textContent = `${orient.manualOffset}°`;
    saveNumber(SETTINGS.headingOffsetKey, orient.manualOffset);
    if (state.mode === 'sim') applySimPosition();
  };
  $('#in-fov').oninput = (e) => {
    state.fovLong = Number(e.target.value);
    $('#v-fov').textContent = `${state.fovLong}°`;
    saveNumber('ra-anchieta-fov-v1', state.fovLong);
  };
}

init();
