import * as THREE from "three";
import { OBJECT_LIBRARY } from "./model";

export function footprintOf(defId: string, scale: number): { l: number; w: number; h: number } | null {
  const d = OBJECT_LIBRARY.find((o) => o.id === defId);
  if (!d) return null;
  return { h: d.realHeightCm / scale, l: d.realLengthCm / scale, w: d.realWidthCm / scale };
}

const TIRE = 0x1e1e22;
const DARK = 0x2b2b2e;
const GLASS = 0x22384a;
const WOOD = 0x8a6b45;

function std(color: string | number | THREE.Color, roughness = 0.8): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function bx(g: THREE.Group, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rz = 0): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.08, w), Math.max(0.08, h), Math.max(0.08, d)), m);
  mesh.position.set(x, y, z);
  if (rz) mesh.rotation.z = rz;
  g.add(mesh);
}

function wheelX(g: THREE.Group, r: number, w: number, x: number, y: number, z: number): void {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), std(TIRE, 0.95));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  g.add(mesh);
}

/** Recognizable low-poly models built from primitives, true to the 1:87 footprint. Faces +X. */
export function buildObjectModel(defId: string, scale: number): THREE.Group | null {
  const def = OBJECT_LIBRARY.find((d) => d.id === defId);
  if (!def) return null;
  const L = def.realLengthCm / scale;
  const Wd = def.realWidthCm / scale;
  const H = def.realHeightCm / scale;
  const g = new THREE.Group();
  const body = std(def.color);
  const dark = std(new THREE.Color(def.color).multiplyScalar(0.7));
  const glass = std(GLASS, 0.4);
  if (defId === "excavator") {
    for (const sz of [-0.32 * Wd, 0.32 * Wd]) bx(g, 0.75 * L, 0.22 * H, 0.28 * Wd, std(DARK, 0.95), 0, 0.11 * H, sz);
    bx(g, 0.6 * L, 0.12 * H, 0.7 * Wd, dark, -0.02 * L, 0.28 * H, 0);
    bx(g, 0.34 * L, 0.38 * H, 0.52 * Wd, body, -0.06 * L, 0.53 * H, -0.08 * Wd);
    bx(g, 0.2 * L, 0.2 * H, 0.54 * Wd, glass, 0.05 * L, 0.58 * H, -0.08 * Wd);
    const boomLen = 0.45 * L;
    const boomAng = 0.45;
    const px = 0.22 * L;
    const py = 0.6 * H;
    const th = Math.max(0.22, 0.12 * H);
    bx(g, boomLen, th, 0.16 * Wd, body, px + (Math.cos(boomAng) * boomLen) / 2, py + (Math.sin(boomAng) * boomLen) / 2, 0, boomAng);
    const tx = px + Math.cos(boomAng) * boomLen;
    const ty = py + Math.sin(boomAng) * boomLen;
    const stickLen = 0.35 * L;
    const stickAng = -0.4;
    bx(g, stickLen, th * 0.8, 0.12 * Wd, body, tx + (Math.cos(stickAng) * stickLen) / 2, ty + (Math.sin(stickAng) * stickLen) / 2, 0, stickAng);
    bx(g, 0.16 * L, 0.2 * H, 0.24 * Wd, std(DARK), tx + Math.cos(stickAng) * stickLen, Math.max(0.12 * H, ty + Math.sin(stickAng) * stickLen), 0);
  } else if (defId === "dumptruck") {
    bx(g, 0.9 * L, 0.12 * H, 0.6 * Wd, std(DARK), 0, 0.3 * H, 0);
    bx(g, 0.22 * L, 0.52 * H, 0.8 * Wd, body, 0.32 * L, 0.56 * H, 0);
    bx(g, 0.05 * L, 0.2 * H, 0.7 * Wd, glass, 0.43 * L, 0.64 * H, 0);
    bx(g, 0.56 * L, 0.46 * H, 0.86 * Wd, body, -0.15 * L, 0.56 * H, 0);
    bx(g, 0.5 * L, 0.1 * H, 0.76 * Wd, std(DARK), -0.15 * L, 0.78 * H, 0);
    for (const wx of [0.32 * L, -0.12 * L, -0.32 * L]) {
      for (const wz of [-0.42 * Wd, 0.42 * Wd]) wheelX(g, 0.16 * H, 0.12 * Wd, wx, 0.16 * H, wz);
    }
  } else if (defId === "bulldozer") {
    for (const sz of [-0.3 * Wd, 0.3 * Wd]) bx(g, 0.7 * L, 0.25 * H, 0.3 * Wd, std(DARK, 0.95), -0.03 * L, 0.125 * H, sz);
    bx(g, 0.55 * L, 0.35 * H, 0.6 * Wd, body, -0.05 * L, 0.42 * H, 0);
    bx(g, 0.3 * L, 0.34 * H, 0.5 * Wd, body, -0.08 * L, 0.76 * H, 0);
    bx(g, 0.2 * L, 0.18 * H, 0.52 * Wd, glass, 0.0 * L, 0.78 * H, 0);
    bx(g, 0.08 * L, 0.42 * H, 1.0 * Wd, dark, 0.45 * L, 0.26 * H, 0);
    for (const sz of [-0.2 * Wd, 0.2 * Wd]) bx(g, 0.3 * L, 0.08 * H, 0.08 * Wd, dark, 0.28 * L, 0.3 * H, sz);
  } else if (defId === "container20") {
    bx(g, L, 0.92 * H, Wd, body, 0, 0.46 * H, 0);
    for (let i = 0; i < 6; i++) {
      const x = -L / 2 + ((i + 0.5) * L) / 6;
      for (const sz of [-Wd / 2 - 0.01, Wd / 2 + 0.01]) bx(g, 0.05 * L, 0.8 * H, 0.03, dark, x, 0.46 * H, sz);
    }
    bx(g, 0.04 * L, 0.88 * H, 0.9 * Wd, std(DARK), -L / 2, 0.46 * H, 0);
  } else if (defId === "sitehut") {
    bx(g, 0.9 * L, 0.75 * H, 0.9 * Wd, body, 0, 0.375 * H, 0);
    bx(g, 1.0 * L, 0.08 * H, 1.0 * Wd, std(0x9aa3ad), 0, 0.79 * H, 0);
    bx(g, 0.15 * L, 0.5 * H, 0.03, std(DARK), 0.2 * L, 0.3 * H, 0.46 * Wd);
    for (const wx of [-0.25 * L, 0.0]) bx(g, 0.18 * L, 0.22 * H, 0.03, glass, wx, 0.48 * H, 0.46 * Wd);
  } else if (defId === "toilet") {
    bx(g, 0.9 * L, 0.85 * H, 0.9 * Wd, body, 0, 0.425 * H, 0);
    bx(g, 0.96 * L, 0.08 * H, 0.96 * Wd, std(0x9aa3ad), 0, 0.89 * H, 0);
    bx(g, 0.5 * L, 0.6 * H, 0.03, glass, 0, 0.4 * H, 0.46 * Wd);
  } else if (defId === "logpile") {
    const r = 0.15 * H;
    const side = std(0x6b4f2e, 0.95);
    const end = std(0xc9a26b, 0.9);
    const rows: [number, number][] = [[-2, 0], [0, 0], [2, 0], [-1, 1], [1, 1], [0, 2]];
    for (const [zo, layer] of rows) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.9 * L, 10), [side, end, end]);
      log.rotation.z = Math.PI / 2;
      log.position.set(0, r + layer * 2 * r * 0.87, zo * r);
      g.add(log);
    }
    for (const sx of [-0.45 * L, 0.45 * L]) bx(g, 0.06 * L, 0.7 * H, 0.5 * Wd, std(DARK), sx, 0.35 * H, 0);
  } else if (defId === "pallet") {
    for (const sz of [-0.35 * Wd, 0, 0.35 * Wd]) bx(g, L, 0.14 * H, 0.12 * Wd, std(WOOD), 0, 0.07 * H, sz);
    bx(g, L, 0.1 * H, Wd, std(WOOD), 0, 0.19 * H, 0);
    bx(g, 0.8 * L, 0.45 * H, 0.8 * Wd, std(0x5f6f5a), 0, 0.46 * H, 0);
  } else if (defId === "barrier") {
    for (let i = 0; i < 3; i++) {
      bx(g, 0.3 * L, 0.5 * H, 0.25 * Wd, std(i % 2 ? 0xd94f2b : 0xe8e8e8), -0.31 * L + i * 0.31 * L, 0.55 * H, 0);
    }
    for (const sx of [-0.35 * L, 0.35 * L]) bx(g, 0.15 * L, 0.3 * H, 0.6 * Wd, std(DARK), sx, 0.15 * H, 0);
  } else if (defId === "lighttower") {
    bx(g, 0.5 * L, 0.1 * H, 0.5 * Wd, std(DARK), 0, 0.05 * H, 0);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * L, 0.06 * L, 0.72 * H, 10), std(0x9aa3ad));
    pole.position.set(0, 0.46 * H, 0);
    g.add(pole);
    bx(g, 0.3 * L, 0.14 * H, 0.42 * Wd, std(DARK), 0, 0.86 * H, 0);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffedb0, emissiveIntensity: 0.9 });
    bx(g, 0.1 * L, 0.08 * H, 0.3 * Wd, lampMat, 0.12 * L, 0.84 * H, 0);
  } else {
    const f = footprintOf(defId, scale);
    if (!f) return null;
    bx(g, f.l, f.h, f.w, body, 0, f.h / 2, 0);
  }
  return g;
}
