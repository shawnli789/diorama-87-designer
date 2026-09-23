// Core data model + terrain math for the 1:87 RC diorama designer.
// All dimensions are real-world centimeters of the physical diorama unless noted.

export const CELL_CM = 1; // heightfield resolution: 1 sample per cm
export const MAX_GRID = 150; // cap on either axis (cells) to protect perf

export interface BasePlate {
  lengthCm: number; // X axis
  widthCm: number; // Z axis
}

export interface VehicleProfile {
  name: string;
  wheelbaseCm: number;
  clearanceCm: number;
  maxClimbDeg: number;
  minTurnRadiusCm: number;
}

export interface Road {
  id: string;
  name: string;
  points: { x: number; z: number }[]; // control points, cm
  widthCm: number;
  group: ZoneGroup;
}

export type ZoneGroup = "A" | "B" | "C";

export interface Zone {
  id: string;
  name: string;
  note: string;
  color: string;
  group: ZoneGroup;
  points: { x: number; z: number }[];
}

export interface PlacedObject {
  id: string;
  defId: string;
  x: number;
  z: number;
  rotDeg: number;
  group: ZoneGroup;
}

export interface ObjectDef {
  id: string;
  label: string;
  kind: "vehicle" | "structure" | "prop";
  realLengthCm: number;
  realWidthCm: number;
  realHeightCm: number;
  color: string;
}

export interface ProjectState {
  base: BasePlate;
  scale: number; // e.g. 87
  foamThicknessCm: number;
  maxGradePct: number; // derived from vehicle, but user-overridable
  terrain: number[]; // row-major heights in cm, (nx+1)*(nz+1)
  nx: number;
  nz: number;
  roads: Road[];
  zones: Zone[];
  objects: PlacedObject[];
  vehicle: VehicleProfile;
}

export const GROUP_COLORS: Record<ZoneGroup, string> = { A: "#4da3ff", B: "#ffb020", C: "#b07dff" };
export const GROUP_NAMES: Record<ZoneGroup, string> = {
  A: "Zone A — Hillside",
  B: "Zone B — Work site",
  C: "Zone C — Yard / staging",
};

export const OBJECT_LIBRARY: ObjectDef[] = [
  { color: "#e8b93c", id: "excavator", kind: "vehicle", label: "Crawler excavator", realHeightCm: 300, realLengthCm: 700, realWidthCm: 280 },
  { color: "#c96a2b", id: "dumptruck", kind: "vehicle", label: "Dump truck", realHeightCm: 280, realLengthCm: 650, realWidthCm: 250 },
  { color: "#8a8f96", id: "bulldozer", kind: "vehicle", label: "Bulldozer", realHeightCm: 300, realLengthCm: 550, realWidthCm: 280 },
  { color: "#3f7fbf", id: "container20", kind: "structure", label: "20ft container", realHeightCm: 259, realLengthCm: 605, realWidthCm: 244 },
  { color: "#7a6a55", id: "sitehut", kind: "structure", label: "Site hut", realHeightCm: 280, realLengthCm: 600, realWidthCm: 300 },
  { color: "#9aa3ad", id: "toilet", kind: "structure", label: "Portable toilet", realHeightCm: 230, realLengthCm: 120, realWidthCm: 120 },
  { color: "#6b4f2e", id: "logpile", kind: "prop", label: "Log pile", realHeightCm: 150, realLengthCm: 400, realWidthCm: 150 },
  { color: "#a3814f", id: "pallet", kind: "prop", label: "Pallet stack", realHeightCm: 120, realLengthCm: 120, realWidthCm: 100 },
  { color: "#d8d8d8", id: "barrier", kind: "prop", label: "Traffic barrier", realHeightCm: 100, realLengthCm: 200, realWidthCm: 50 },
  { color: "#e5e5e5", id: "lighttower", kind: "prop", label: "Light tower", realHeightCm: 450, realLengthCm: 150, realWidthCm: 150 },
];

export const DEFAULT_VEHICLE: VehicleProfile = {
  clearanceCm: 5,
  maxClimbDeg: 30,
  minTurnRadiusCm: 20,
  name: "1:87 crawler",
  wheelbaseCm: 12,
};

export function gradeForAngle(deg: number): number {
  return Math.tan((deg * Math.PI) / 180) * 100;
}

export function defaultProject(): ProjectState {
  const nx = 90;
  const nz = 60;
  return {
    base: { lengthCm: 90, widthCm: 60 },
    foamThicknessCm: 1,
    maxGradePct: Math.round(gradeForAngle(DEFAULT_VEHICLE.maxClimbDeg) * 10) / 10,
    nx,
    nz,
    objects: [],
    roads: [],
    scale: 87,
    terrain: new Array((nx + 1) * (nz + 1)).fill(0),
    vehicle: { ...DEFAULT_VEHICLE },
    zones: [],
  };
}

export function cloneState(s: ProjectState): ProjectState {
  return { ...s, base: { ...s.base }, roads: s.roads.map((r) => ({ ...r, points: r.points.map((p) => ({ ...p })) })), terrain: [...s.terrain], vehicle: { ...s.vehicle }, zones: s.zones.map((z) => ({ ...z, points: z.points.map((p) => ({ ...p })) })), objects: s.objects.map((o) => ({ ...o })) };
}

export function idx(nx: number, ix: number, iz: number): number {
  return iz * (nx + 1) + ix;
}

/** Bilinear sample of terrain height (cm) at plate coords. */
export function sampleHeight(s: ProjectState, x: number, z: number): number {
  const fx = Math.min(Math.max(x / CELL_CM, 0), s.nx - 1e-6);
  const fz = Math.min(Math.max(z / CELL_CM, 0), s.nz - 1e-6);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const h00 = s.terrain[idx(s.nx, ix, iz)];
  const h10 = s.terrain[idx(s.nx, ix + 1, iz)];
  const h01 = s.terrain[idx(s.nx, ix, iz + 1)];
  const h11 = s.terrain[idx(s.nx, ix + 1, iz + 1)];
  return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
}

/** Slope percent at a point via central differences. */
export function slopeAt(s: ProjectState, x: number, z: number): number {
  const e = CELL_CM;
  const dx = (sampleHeight(s, x + e, z) - sampleHeight(s, x - e, z)) / (2 * e);
  const dz = (sampleHeight(s, x, z + e) - sampleHeight(s, x, z - e)) / (2 * e);
  return Math.hypot(dx, dz) * 100;
}

export function maxSlope(s: ProjectState): number {
  let m = 0;
  for (let iz = 0; iz <= s.nz; iz++) {
    for (let ix = 0; ix <= s.nx; ix++) {
      const x = ix * CELL_CM;
      const z = iz * CELL_CM;
      const v = slopeAt(s, x, z);
      if (v > m) m = v;
    }
  }
  return m;
}

export type BrushMode = "raise" | "lower" | "smooth";

/** Apply a terrain brush stroke centered at (x,z). Returns peak slope % inside the brush. */
export function applyBrush(s: ProjectState, mode: BrushMode, x: number, z: number, radiusCm: number, strength: number): number {
  const r = Math.max(1, radiusCm);
  const ix0 = Math.max(0, Math.floor((x - r) / CELL_CM));
  const ix1 = Math.min(s.nx, Math.ceil((x + r) / CELL_CM));
  const iz0 = Math.max(0, Math.floor((z - r) / CELL_CM));
  const iz1 = Math.min(s.nz, Math.ceil((z + r) / CELL_CM));
  const delta = mode === "lower" ? -strength : strength;
  if (mode === "smooth") {
    const src = [...s.terrain];
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const px = ix * CELL_CM;
        const pz = iz * CELL_CM;
        const d = Math.hypot(px - x, pz - z);
        if (d > r) continue;
        const fall = 0.5 + 0.5 * Math.cos((d / r) * Math.PI);
        let sum = 0;
        let n = 0;
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            const jx = ix + ox;
            const jz = iz + oz;
            if (jx < 0 || jz < 0 || jx > s.nx || jz > s.nz) continue;
            sum += src[idx(s.nx, jx, jz)];
            n++;
          }
        }
        const avg = sum / Math.max(1, n);
        const k = Math.min(1, strength) * fall;
        s.terrain[idx(s.nx, ix, iz)] = src[idx(s.nx, ix, iz)] * (1 - k) + avg * k;
      }
    }
  } else {
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const px = ix * CELL_CM;
        const pz = iz * CELL_CM;
        const d = Math.hypot(px - x, pz - z);
        if (d > r) continue;
        const fall = 0.5 + 0.5 * Math.cos((d / r) * Math.PI);
        s.terrain[idx(s.nx, ix, iz)] += delta * fall;
      }
    }
  }
  let peak = 0;
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const v = slopeAt(s, ix * CELL_CM, iz * CELL_CM);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

export type PresetId = "flat" | "gentle" | "terrace" | "valley" | "mountain";

export const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { hint: "Start over with a level plate.", id: "flat", label: "Flat plate" },
  { hint: "A soft diagonal hillside, easy for beginners.", id: "gentle", label: "Gentle hillside" },
  { hint: "Stepped levels for switchback roads.", id: "terrace", label: "Steep terrace" },
  { hint: "A dip through the middle for a creek or haul road.", id: "valley", label: "Valley cut" },
  { hint: "A tall peak (~14cm) — the easy way to start real mountains.", id: "mountain", label: "⛰ Mountain" },
];

export function applyPreset(s: ProjectState, id: PresetId): void {
  const { nx, nz } = s;
  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) {
      const u = ix / nx;
      const v = iz / nz;
      let h = 0;
      if (id === "gentle") {
        h = 7 * u + 2.5 * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI);
      } else if (id === "terrace") {
        const steps = 4;
        const t = Math.min(steps - 1, Math.floor(u * steps));
        h = t * 2.2 + 0.4 * Math.sin(v * Math.PI * 4);
      } else if (id === "valley") {
        h = 5 * Math.pow(Math.abs(u - 0.5) * 2, 1.6);
      } else if (id === "mountain") {
        const ex = (u - 0.55) / 0.3;
        const ez = (v - 0.45) / 0.26;
        h = 14 * Math.exp(-(ex * ex + ez * ez)) + 1.5 * Math.sin(u * 9 + 1) * Math.sin(v * 7);
        h = Math.max(0, h);
      }
      s.terrain[idx(nx, ix, iz)] = Math.round(h * 20) / 20;
    }
  }
}

/** Catmull-Rom sampling of road control points (cm). */
export function sampleRoadPoints(pts: { x: number; z: number }[], samplesPerSeg = 12): { x: number; z: number }[] {
  if (pts.length < 2) return [...pts];
  const out: { x: number; z: number }[] = [];
  const P = (i: number) => pts[Math.min(Math.max(i, 0), pts.length - 1)];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    for (let k = 0; k < samplesPerSeg; k++) {
      const t = k / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        z: 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
      });
    }
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

export interface RoadAnalysis {
  lengthCm: number;
  maxGradePct: number;
  steepFraction: number;
  minRadiusCm: number;
}

/** Grade + curvature analysis of a road draped on terrain. */
export function analyzeRoad(s: ProjectState, road: Road): RoadAnalysis | null {
  if (road.points.length < 2) return null;
  const pts = sampleRoadPoints(road.points);
  let length = 0;
  let maxGrade = 0;
  let steepLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const run = Math.hypot(b.x - a.x, b.z - a.z);
    if (run < 1e-6) continue;
    const rise = Math.abs(sampleHeight(s, b.x, b.z) - sampleHeight(s, a.x, a.z));
    const g = (rise / run) * 100;
    length += run;
    if (g > maxGrade) maxGrade = g;
    if (g > s.maxGradePct) steepLen += run;
  }
  let minR = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const ab = Math.hypot(b.x - a.x, b.z - a.z);
    const bc = Math.hypot(c.x - b.x, c.z - b.z);
    const ca = Math.hypot(c.x - a.x, c.z - a.z);
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z));
    if (area2 < 1e-9) continue;
    const R = (ab * bc * ca) / (2 * area2);
    if (R < minR) minR = R;
  }
  return { lengthCm: length, maxGradePct: maxGrade, minRadiusCm: minR === Infinity ? Infinity : minR, steepFraction: length > 0 ? steepLen / length : 0 };
}

/** Sample terrain profile along a line for the cross-section tool. */
export function profileAlongLine(s: ProjectState, a: { x: number; z: number }, b: { x: number; z: number }, n = 120): { dist: number; h: number }[] {
  const total = Math.hypot(b.x - a.x, b.z - a.z);
  const out: { dist: number; h: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    out.push({ dist: t * total, h: sampleHeight(s, x, z) });
  }
  return out;
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function serialize(s: ProjectState): string {
  return JSON.stringify(s);
}

export function deserialize(json: string): ProjectState {
  const p = JSON.parse(json) as ProjectState;
  const d = defaultProject();
  return { ...d, ...p, base: { ...d.base, ...(p.base ?? {}) }, vehicle: { ...d.vehicle, ...(p.vehicle ?? {}) } };
}
