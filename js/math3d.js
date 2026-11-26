export const DEG = Math.PI / 180;

export function perspective(fovYDeg, aspect, near, far) {
  const f = 1 / Math.tan((fovYDeg * DEG) / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

export function transform(m, v) {
  const o = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++)
    o[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3];
  return o;
}

export const qIdentity = () => [0, 0, 0, 1];

export function qAxisAngle(ax, ay, az, rad) {
  const s = Math.sin(rad / 2);
  return [ax * s, ay * s, az * s, Math.cos(rad / 2)];
}

export function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function qNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function qSlerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (cos > 0.9995) {
    return qNormalize([
      a[0] + t * (bx - a[0]), a[1] + t * (by - a[1]),
      a[2] + t * (bz - a[2]), a[3] + t * (bw - a[3]),
    ]);
  }
  const th = Math.acos(cos), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [wa * a[0] + wb * bx, wa * a[1] + wb * by, wa * a[2] + wb * bz, wa * a[3] + wb * bw];
}

export function qRotate(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

export function qToMat4(q) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return new Float32Array([
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    0, 0, 0, 1,
  ]);
}

export function viewMatrix(q, pos) {
  const r = qToMat4(q);

  const m = new Float32Array([
    r[0], r[4], r[8], 0,
    r[1], r[5], r[9], 0,
    r[2], r[6], r[10], 0,
    0, 0, 0, 1,
  ]);
  m[12] = -(m[0] * pos[0] + m[4] * pos[1] + m[8] * pos[2]);
  m[13] = -(m[1] * pos[0] + m[5] * pos[1] + m[9] * pos[2]);
  m[14] = -(m[2] * pos[0] + m[6] * pos[1] + m[10] * pos[2]);
  return m;
}
