// =============================================================================
// points.js — Carrega, salva, importa e exporta os pontos (prédios)
// Ordem de prioridade: calibração salva no aparelho (localStorage)
//                      → data/pontos.json (arquivo do projeto)
//                      → DEFAULT_POINTS (js/config.js)
// =============================================================================
import { DEFAULT_POINTS, SETTINGS } from './config.js';

function sanitize(list) {
  if (!Array.isArray(list)) throw new Error('Formato inválido: esperado uma lista de pontos.');
  return list.map((p, i) => {
    const lat = Number(p.lat), lon = Number(p.lon);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      throw new Error(`Coordenada inválida no ponto ${i + 1}.`);
    return {
      id: String(p.id || `ponto${i + 1}`),
      nome: String(p.nome || p.name || `Ponto ${i + 1}`).slice(0, 40),
      lat, lon,
    };
  });
}

export async function loadPoints() {
  try {
    const saved = localStorage.getItem(SETTINGS.storageKey);
    if (saved) return { points: sanitize(JSON.parse(saved)), origem: 'calibração salva neste aparelho' };
  } catch (e) { /* localStorage indisponível ou corrompido */ }
  try {
    const r = await fetch('data/pontos.json', { cache: 'no-store' });
    if (r.ok) return { points: sanitize(await r.json()), origem: 'data/pontos.json' };
  } catch (e) { /* sem arquivo: usa padrão */ }
  return { points: sanitize(DEFAULT_POINTS), origem: 'padrão (config.js)' };
}

export function savePoints(points) {
  try { localStorage.setItem(SETTINGS.storageKey, JSON.stringify(points)); return true; }
  catch (e) { return false; }
}

export function clearSaved() {
  try { localStorage.removeItem(SETTINGS.storageKey); } catch (e) { /* ignora */ }
}

export function exportPoints(points) {
  const blob = new Blob([JSON.stringify(points, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pontos.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function importPoints(file) {
  return file.text().then((t) => sanitize(JSON.parse(t)));
}

export function loadNumber(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : Number(v); }
  catch (e) { return fallback; }
}

export function saveNumber(key, v) {
  try { localStorage.setItem(key, String(v)); } catch (e) { /* ignora */ }
}
