// =============================================================================
// orientation.js — Orientação do celular (bússola + giroscópio/acelerômetro)
// =============================================================================
// Converte os ângulos do evento DeviceOrientation (alpha, beta, gamma — padrão
// W3C, ordem intrínseca Z-X'-Y'') em um quaternion que leva o referencial do
// aparelho para o referencial do mundo ENU (x = Leste, y = Norte, z = Cima).
//
//   q = Rz(alpha) · Rx(beta) · Ry(gamma) · Rz(-anguloDaTela)
//
// A câmera traseira olha para o eixo -Z do aparelho, que é exatamente a
// convenção de câmera do WebGL — por isso o quaternion vira direto a
// matriz de visão no renderer.
//
// Android/Chrome: evento 'deviceorientationabsolute' já dá alpha em relação
//   ao Norte magnético.
// iOS/Safari: alpha é relativo; usamos event.webkitCompassHeading para
//   calcular um deslocamento (offset) que alinha o alpha ao Norte.
// =============================================================================
import { DEG, qAxisAngle, qMul, qNormalize, qSlerp, qRotate, qIdentity } from './math3d.js';

const Z = [0, 0, 1], X = [1, 0, 0], Y = [0, 1, 0];

export function quatFromEuler(alpha, beta, gamma, screenAngle) {
  let q = qAxisAngle(...Z, alpha * DEG);
  q = qMul(q, qAxisAngle(...X, beta * DEG));
  q = qMul(q, qAxisAngle(...Y, gamma * DEG));
  q = qMul(q, qAxisAngle(...Z, -screenAngle * DEG));
  return qNormalize(q);
}

// Para onde a câmera aponta (azimute 0–360, Norte = 0, sentido horário) e inclinação
export function headingPitch(q) {
  const f = qRotate(q, [0, 0, -1]);
  let heading = Math.atan2(f[0], f[1]) / DEG;
  if (Math.hypot(f[0], f[1]) < 0.15) {
    // celular quase deitado: usa o topo da tela como referência
    const u = qRotate(q, [0, 1, 0]);
    heading = Math.atan2(u[0], u[1]) / DEG;
  }
  return {
    heading: (heading + 360) % 360,
    pitch: Math.asin(Math.max(-1, Math.min(1, f[2]))) / DEG,
  };
}

function angleDiff(a, b) { return ((a - b + 540) % 360) - 180; }

export class OrientationSensor {
  constructor() {
    this.target = qIdentity();
    this.current = qIdentity();
    this.absolute = false;     // true se o alpha já é relativo ao Norte
    this.compassOffset = null; // iOS: correção (graus) para alinhar ao Norte
    this.manualOffset = 0;     // ajuste fino feito pelo usuário (graus)
    this.hasData = false;
    this.source = 'nenhum';
    this.accuracy = null;      // iOS: webkitCompassAccuracy
    this._onAbs = (e) => this._handle(e, true);
    this._onRel = (e) => this._handle(e, false);
  }

  // Precisa ser chamado dentro de um clique (exigência do iOS 13+)
  async requestPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      const r = await DOE.requestPermission();
      if (r !== 'granted') throw new Error('Permissão de orientação negada.');
    }
  }

  start() {
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', this._onAbs);
    }
    window.addEventListener('deviceorientation', this._onRel);
  }

  stop() {
    window.removeEventListener('deviceorientationabsolute', this._onAbs);
    window.removeEventListener('deviceorientation', this._onRel);
  }

  _screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    return typeof window.orientation === 'number' ? window.orientation : 0;
  }

  _handle(e, fromAbsoluteEvent) {
    if (e.alpha === null || e.beta === null) return;
    const isAbs = fromAbsoluteEvent || e.absolute === true;
    // Se já recebemos dados absolutos, ignora os relativos
    if (this.absolute && !isAbs) return;
    if (isAbs) this.absolute = true;

    let q = quatFromEuler(e.alpha, e.beta, e.gamma || 0, this._screenAngle());

    if (!isAbs && typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      // iOS: compara o rumo calculado com o da bússola e ajusta o offset
      const rel = headingPitch(q).heading;
      const wanted = e.webkitCompassHeading;
      const off = angleDiff(rel, wanted);
      this.accuracy = e.webkitCompassAccuracy;
      if (this.compassOffset === null) this.compassOffset = off;
      else this.compassOffset += angleDiff(off, this.compassOffset) * 0.05; // filtro passa-baixa
      this.source = 'bússola iOS';
    } else {
      this.source = isAbs ? 'absoluto (Norte)' : 'relativo (sem bússola)';
    }
    this.target = q;
    this.hasData = true;
  }

  // Modo simulação: define orientação a partir de rumo/inclinação
  setManual(headingDeg, pitchDeg) {
    let q = qAxisAngle(...Z, -headingDeg * DEG);
    q = qMul(q, qAxisAngle(...X, (90 + pitchDeg) * DEG));
    this.target = q;
    this.current = q;
    this.hasData = true;
    this.absolute = true;
    this.source = 'simulação';
  }

  // Chamado a cada quadro: aplica offsets e suavização; devolve quaternion final
  update(smoothing = 0.25) {
    let q = this.target;
    const off = (this.compassOffset || 0) + this.manualOffset;
    if (off) q = qMul(qAxisAngle(...Z, off * DEG), q);
    this.current = qSlerp(this.current, q, smoothing);
    return this.current;
  }
}
