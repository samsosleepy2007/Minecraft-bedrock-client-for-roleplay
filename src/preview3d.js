/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
// Renders a Bedrock geometry + texture to a small image (front 3/4 view), like Blockbench.
import * as THREE from 'three';

let renderer = null;
const SIZE = 256;

function getRenderer() {
  if (renderer) return renderer;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

const rad = (d) => ((Number(d) || 0) * Math.PI) / 180;
const vec = (a, d = 0) => (Array.isArray(a) ? a.map((x) => Number(x) || 0) : [d, d, d]);

/** Bedrock rotation → three Euler (same convention as Blockbench). */
function applyRotation(obj, rot) {
  const r = vec(rot);
  obj.rotation.set(rad(-r[0]), rad(-r[1]), rad(r[2]), 'ZYX');
}

/** Per-face UV rectangles {face: [u, v, w, h]} in texture pixels. */
function faceUVs(cube) {
  const [w, h, d] = vec(cube.size).map((x) => Math.abs(x));
  const uv = cube.uv;
  if (Array.isArray(uv)) {
    const [u, v] = uv.map(Number);
    const fw = Math.floor(w), fh = Math.floor(h), fd = Math.floor(d);
    return {
      east: [u, v + fd, fd, fh],
      north: [u + fd, v + fd, fw, fh],
      west: [u + fd + fw, v + fd, fd, fh],
      south: [u + fd + fw + fd, v + fd, fw, fh],
      up: [u + fd, v, fw, fd],
      down: [u + fd + fw, v, fw, fd],
    };
  }
  const out = {};
  if (uv && typeof uv === 'object') {
    for (const [f, o] of Object.entries(uv)) if (o?.uv) out[f] = [...o.uv.map(Number), ...(o.uv_size || [0, 0]).map(Number)];
  }
  return out;
}

// three BoxGeometry face order: +x, -x, +y, -y, +z, -z
const FACE_ORDER = ['east', 'west', 'up', 'down', 'south', 'north'];

function cubeMesh(cube, mat, tw, th) {
  const size = vec(cube.size);
  const inf = Number(cube.inflate) || 0;
  const sx = Math.abs(size[0]) + inf * 2, sy = Math.abs(size[1]) + inf * 2, sz = Math.abs(size[2]) + inf * 2;
  const geo = new THREE.BoxGeometry(Math.max(sx, 0.001), Math.max(sy, 0.001), Math.max(sz, 0.001));
  const uvs = faceUVs(cube);
  const uvAttr = geo.attributes.uv;
  const groups = [];
  FACE_ORDER.forEach((face, fi) => {
    const r = uvs[face];
    if (!r) return;
    groups.push(fi);
    let [u, v, w, h] = r;
    if (face === 'down') { v += h; h = -h; }
    const u0 = u / tw, u1 = (u + w) / tw, v0 = 1 - v / th, v1 = 1 - (v + h) / th;
    const base = fi * 4;
    uvAttr.setXY(base, u0, v0);
    uvAttr.setXY(base + 1, u1, v0);
    uvAttr.setXY(base + 2, u0, v1);
    uvAttr.setXY(base + 3, u1, v1);
  });
  // drop faces without UV
  const index = geo.index.array;
  const keep = [];
  for (const fi of groups) for (let k = fi * 6; k < fi * 6 + 6; k++) keep.push(index[k]);
  geo.setIndex(keep);
  geo.clearGroups();
  const mesh = new THREE.Mesh(geo, mat);
  const o = vec(cube.origin);
  // Bedrock X is mirrored compared to three.js
  const from = [-o[0] - size[0] - inf, o[1] - inf, o[2] - inf];
  mesh.position.set(from[0] + sx / 2, from[1] + sy / 2, from[2] + sz / 2);
  if (cube.rotation) {
    const p = vec(cube.pivot);
    const pivot = new THREE.Group();
    pivot.position.set(-p[0], p[1], p[2]);
    applyRotation(pivot, cube.rotation);
    mesh.position.sub(pivot.position);
    pivot.add(mesh);
    return pivot;
  }
  return mesh;
}

/** poly_mesh → three mesh (positions are model-space, X mirrored like cubes). */
function polyMesh(pm, mat, tw, th) {
  const P = pm.positions || [], N = pm.normals || [], U = pm.uvs || [];
  let polys = pm.polys;
  if (!Array.isArray(polys)) return null;
  const pos = [], uv = [];
  const vert = (v) => {
    const p = P[v[0]] || [0, 0, 0];
    pos.push(-p[0], p[1], p[2]);
    const t = U[v[2]] || [0, 0];
    if (pm.normalized_uvs) uv.push(t[0], t[1]);
    else uv.push(t[0] / tw, 1 - t[1] / th);
  };
  for (const poly of polys) {
    if (!Array.isArray(poly) || poly.length < 3) continue;
    // quads may repeat the last vertex as a triangle; fan-triangulate
    for (let k = 1; k + 1 < poly.length; k++) {
      vert(poly[0]);
      vert(poly[k]);
      vert(poly[k + 1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return new THREE.Mesh(g, mat);
}

function buildModel(def, mat) {
  const desc = def.description || {};
  const tw = Number(desc.texture_width ?? def.texturewidth) || 64;
  const th = Number(desc.texture_height ?? def.textureheight) || 64;
  const root = new THREE.Group();
  const groups = new Map();
  const bones = def.bones || [];
  for (const b of bones) {
    const g = new THREE.Group();
    g.userData.pivot = vec(b.pivot);
    groups.set(b.name, g);
  }
  for (const b of bones) {
    const g = groups.get(b.name);
    const p = g.userData.pivot;
    const parent = b.parent && groups.get(b.parent);
    const pp = parent ? parent.userData.pivot : [0, 0, 0];
    g.position.set(-(p[0] - pp[0]), p[1] - pp[1], p[2] - pp[2]);
    applyRotation(g, b.rotation);
    if (b.poly_mesh) {
      const m = polyMesh(b.poly_mesh, mat, tw, th);
      if (m) {
        m.position.set(p[0], -p[1], -p[2]);
        g.add(m);
      }
    }
    for (const c of b.cubes || []) {
      const m = cubeMesh(c, mat, tw, th);
      m.position.sub(new THREE.Vector3(-p[0], p[1], p[2]));
      g.add(m);
    }
    (parent || root).add(g);
  }
  return root;
}

/**
 * Render geometry def + PNG bytes → object URL of a PNG snapshot.
 * @returns {Promise<string|null>}
 */
export async function renderModel(def, pngBytes, { blend = false } = {}) {
  if (!def) return null;
  let r;
  try {
    r = getRenderer();
  } catch {
    return null; // no WebGL
  }
  const bmp = await createImageBitmap(new Blob([pngBytes], { type: 'image/png' }), { imageOrientation: 'flipY' }).catch(() => null);
  if (!bmp) return null;
  const tex = new THREE.Texture(bmp);
  tex.flipY = false;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: blend, alphaTest: blend ? 0.01 : 0.5 });
  const scene = new THREE.Scene();
  const model = buildModel(def, mat);
  model.rotation.y = rad(180 + 28); // Bedrock models face north (-z): look at the front, 3/4 view
  scene.add(model);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const half = (Math.max(size.x, size.y) / 2) * 1.08 || 16;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, -1000, 1000);
  cam.position.set(center.x, center.y, center.z + 100);
  cam.lookAt(center);
  r.render(scene, cam);
  const blob = await new Promise((res) => r.domElement.toBlob(res, 'image/png'));
  scene.traverse((o) => o.geometry?.dispose());
  mat.dispose();
  tex.dispose();
  bmp.close?.();
  return blob ? URL.createObjectURL(blob) : null;
}
