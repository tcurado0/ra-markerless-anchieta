// =============================================================================
// geo.js — Geolocalização: distância, rumo, coordenadas locais e GPS filtrado
// =============================================================================
import { SETTINGS } from './config.js';

const R_EARTH = 6371008.8; // raio médio da Terra (m)
const rad = (d) => (d * Math.PI) / 180;

// Distância de grande círculo (fórmula de Haversine), em metros
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Rumo (azimute) de a para b, em graus a partir do Norte, sentido horário
export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Converte lat/lon em metros no plano local ENU (Leste, Norte, Cima)
// centrado na origem. Projeção equiretangular: erro desprezível < 5 km.
export function toENU(origin, p) {
  const east = rad(p.lon - origin.lon) * R_EARTH * Math.cos(rad(origin.lat));
  const north = rad(p.lat - origin.lat) * R_EARTH;
  return [east, north, 0];
}

export function fromENU(origin, east, north) {
  return {
    lat: origin.lat + (north / R_EARTH) * (180 / Math.PI),
    lon: origin.lon + (east / (R_EARTH * Math.cos(rad(origin.lat)))) * (180 / Math.PI),
  };
}

export function cardinal(deg) {
  const n = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  return n[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// Verifica o requisito "distância de pelo menos 50 m" entre todos os pares
export function validateDistances(points, min = SETTINGS.minDistance) {
  const pairs = [];
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const d = haversine(points[i], points[j]);
      pairs.push({ a: points[i], b: points[j], d, ok: d >= min });
    }
  return pairs;
}

// -----------------------------------------------------------------------------
// GpsTracker — envolve navigator.geolocation.watchPosition com filtro.
// Usa média ponderada pela precisão (accuracy) para reduzir o "pula-pula"
// típico do GPS de celular, e descarta leituras muito ruins.
// -----------------------------------------------------------------------------
export class GpsTracker {
  constructor() {
    this.position = null;     // {lat, lon, accuracy, time}
    this.raw = null;
    this.listeners = [];
    this.watchId = null;
    this.error = null;
  }

  start() {
    if (!('geolocation' in navigator)) {
      this.error = 'Este navegador não tem suporte a GPS.';
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this._onReading(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
      (e) => {
        this.error = { 1: 'permissão negada', 2: 'sinal indisponível', 3: 'tempo esgotado' }[e.code] || e.message;
        this._emit();
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  // Também é usado pelo modo simulação para "teleportar" o usuário
  setManual(lat, lon, accuracy = 3) {
    this.position = { lat, lon, accuracy, time: Date.now() };
    this.raw = this.position;
    this._emit();
  }

  _onReading(lat, lon, accuracy) {
    this.error = null;
    this.raw = { lat, lon, accuracy, time: Date.now() };
    const prev = this.position;
    if (prev && accuracy > SETTINGS.gpsMaxAccuracy && prev.accuracy < accuracy) return;
    if (!prev || haversine(prev, this.raw) > 40) {
      this.position = { ...this.raw }; // primeira leitura ou salto grande: aceita direto
    } else {
      // Filtro tipo Kalman simplificado: peso inversamente proporcional à variância
      const wPrev = 1 / (prev.accuracy ** 2), wNew = 1 / (accuracy ** 2);
      const k = Math.max(0.25, wNew / (wPrev + wNew));
      this.position = {
        lat: prev.lat + (lat - prev.lat) * k,
        lon: prev.lon + (lon - prev.lon) * k,
        accuracy: Math.min(accuracy, prev.accuracy * 1.15 + 0.5),
        time: Date.now(),
      };
    }
    this._emit();
  }

  onChange(fn) { this.listeners.push(fn); }
  _emit() { this.listeners.forEach((fn) => fn(this.position, this.error)); }

  // Média das leituras brutas durante N segundos — usada na calibração
  sample(seconds, onProgress) {
    return new Promise((resolve, reject) => {
      const readings = [];
      const id = navigator.geolocation.watchPosition(
        (p) => readings.push(p.coords),
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
      );
      const t0 = Date.now();
      const timer = setInterval(() => {
        const el = (Date.now() - t0) / 1000;
        onProgress && onProgress(Math.min(1, el / seconds), readings.length);
        if (el >= seconds) {
          clearInterval(timer);
          navigator.geolocation.clearWatch(id);
          if (!readings.length) return reject(new Error('Nenhuma leitura de GPS recebida.'));
          let sw = 0, la = 0, lo = 0, best = Infinity;
          readings.forEach((c) => {
            const w = 1 / Math.max(1, c.accuracy) ** 2;
            sw += w; la += c.latitude * w; lo += c.longitude * w;
            best = Math.min(best, c.accuracy);
          });
          resolve({ lat: la / sw, lon: lo / sw, accuracy: best, n: readings.length });
        }
      }, 200);
    });
  }
}
