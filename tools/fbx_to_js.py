import sys, struct, base64, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbx_parser import parse

def child(n, name):
    return [c for c in n['c'] if c['n'] == name][0]

def main(src, dst):
    ver, nodes = parse(src)
    objs = child({'c': nodes}, 'Objects')
    geo = child(objs, 'Geometry')
    V = child(geo, 'Vertices')['p'][0]
    I = child(geo, 'PolygonVertexIndex')['p'][0]
    N = child(child(geo, 'LayerElementNormal'), 'Normals')['p'][0]
    mat = child(objs, 'Material')
    diffuse = [0.8, 0.1, 0.1]
    for p in child(mat, 'Properties70')['c']:
        if p['p'][0] == 'DiffuseColor':
            diffuse = [round(x, 4) for x in p['p'][4:7]]
    P = [(V[i], V[i+1], V[i+2]) for i in range(0, len(V), 3)]
    xs, ys, zs = zip(*P)
    cx, cz = (min(xs)+max(xs))/2, (min(zs)+max(zs))/2
    y0, h = min(ys), max(ys)-min(ys)
    norm = lambda p: ((p[0]-cx)/h, (p[1]-y0)/h, (p[2]-cz)/h)

    polys, cur = [], []
    for k, ix in enumerate(I):
        if ix < 0:
            cur.append((~ix, k)); polys.append(cur); cur = []
        else:
            cur.append((ix, k))
    verts, lut, idx = [], {}, []
    for poly in polys:
        corners = []
        for vi, k in poly:
            n = N[3*k:3*k+3]
            key = (vi, round(n[0], 3), round(n[1], 3), round(n[2], 3))
            if key not in lut:
                lut[key] = len(verts); verts.append((norm(P[vi]), n))
            corners.append(lut[key])
        for t in range(1, len(corners)-1):
            idx += [corners[0], corners[t], corners[t+1]]

    S = max(abs(c) for v in verts for c in v[0])
    pos = struct.pack('<%dh' % (3*len(verts)), *[int(round(c/S*32767)) for v in verts for c in v[0]])
    nrm = struct.pack('<%dh' % (3*len(verts)), *[int(round(max(-1, min(1, c))*32767)) for v in verts for c in v[1]])
    ind = struct.pack('<%dH' % len(idx), *idx)
    xsn = [v[0][0] for v in verts]; zsn = [v[0][2] for v in verts]
    meta = {
        'source': os.path.basename(src), 'fbxVersion': ver,
        'vertexCount': len(verts), 'triangleCount': len(idx)//3,
        'positionScale': S, 'diffuse': diffuse,
        'bbox': {'x': [min(xsn), max(xsn)], 'y': [0, 1], 'z': [min(zsn), max(zsn)]},
    }
    with open(dst, 'w') as f:
        f.write('export const PIN_META = %s;\n' % json.dumps(meta))
        f.write('export const PIN_POSITIONS_B64 = "%s";\n' % base64.b64encode(pos).decode())
        f.write('export const PIN_NORMALS_B64 = "%s";\n' % base64.b64encode(nrm).decode())
        f.write('export const PIN_INDICES_B64 = "%s";\n' % base64.b64encode(ind).decode())
    print(json.dumps(meta, indent=1), os.path.getsize(dst), 'bytes')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
