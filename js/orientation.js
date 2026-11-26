import { DEG, qAxisAngle, qMul, qNormalize, qSlerp, qRotate, qIdentity } from './math3d.js';

const Z = [0, 0, 1], X = [1, 0, 0], Y = [0, 1, 0];

export function quatFromEuler(alpha, beta, gamma, screenAngle) {
  let q = qAxisAngle(...Z, alpha * DEG);
  q = qMul(q, qAxisAngle(...X, beta * DEG));
  q = qMul(q, qAxisAngle(...Y, gamma * DEG));
  q = qMul(q, qAxisAngle(...Z, -screenAngle * DEG));
  return qNormalize(q);
}

export function headingPitch(q) {
  const f = qRotate(q, [0, 0, -1]);
  let heading = Math.atan2(f[0], f[1]) / DEG;
  if (Math.hypot(f[0], f[1]) < 0.15) {
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
    this.absolute = false;
    this.compassOffset = null;
    this.manualOffset = 0;
    this.hasData = false;
    this.source = 'nenhum';
    this.accuracy = null;
    this._onAbs = (e) => this._handle(e, true);
    this._onRel = (e) => this._handle(e, false);
  }

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

    if (this.absolute && !isAbs) return;
    if (isAbs) this.absolute = true;

    let q = quatFromEuler(e.alpha, e.beta, e.gamma || 0, this._screenAngle());

    if (!isAbs && typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      const rel = headingPitch(q).heading;
      const wanted = e.webkitCompassHeading;
      const off = angleDiff(rel, wanted);
      this.accuracy = e.webkitCompassAccuracy;
      if (this.compassOffset === null) this.compassOffset = off;
      else this.compassOffset += angleDiff(off, this.compassOffset) * 0.05;
      this.source = 'bússola iOS';
    } else {
      this.source = isAbs ? 'absoluto (Norte)' : 'relativo (sem bússola)';
    }
    this.target = q;
    this.hasData = true;
  }

  setManual(headingDeg, pitchDeg) {
    let q = qAxisAngle(...Z, -headingDeg * DEG);
    q = qMul(q, qAxisAngle(...X, (90 + pitchDeg) * DEG));
    this.target = q;
    this.current = q;
    this.hasData = true;
    this.absolute = true;
    this.source = 'simulação';
  }

  update(smoothing = 0.25) {
    let q = this.target;
    const off = (this.compassOffset || 0) + this.manualOffset;
    if (off) q = qMul(qAxisAngle(...Z, off * DEG), q);
    this.current = qSlerp(this.current, q, smoothing);
    return this.current;
  }
}
