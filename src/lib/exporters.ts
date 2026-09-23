// Export helpers: true-scale SVG/print, foam cut sheets, JSON backup.
import { GROUP_COLORS, ProjectState, sampleHeight, sampleRoadPoints } from "./model";

const PX_PER_CM = 37.7952755906; // CSS px per cm at 96dpi — true scale when printed at 100%

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function gridSvg(s: ProjectState, pxPerCm: number): string {
  const W = s.base.lengthCm * pxPerCm;
  const H = s.base.widthCm * pxPerCm;
  let g = "";
  for (let x = 0; x <= s.base.lengthCm; x += 1) {
    const major = x % 5 === 0;
    g += `<line x1="${(x * pxPerCm).toFixed(2)}" y1="0" x2="${(x * pxPerCm).toFixed(2)}" y2="${H.toFixed(2)}" stroke="${major ? "#888" : "#ddd"}" stroke-width="${major ? 0.8 : 0.3}"/>`;
    if (major) g += `<text x="${(x * pxPerCm + 1).toFixed(2)}" y="9" font-size="8" fill="#555">${x}</text>`;
  }
  for (let z = 0; z <= s.base.widthCm; z += 1) {
    const major = z % 5 === 0;
    g += `<line x1="0" y1="${(z * pxPerCm).toFixed(2)}" x2="${W.toFixed(2)}" y2="${(z * pxPerCm).toFixed(2)}" stroke="${major ? "#888" : "#ddd"}" stroke-width="${major ? 0.8 : 0.3}"/>`;
    if (major) g += `<text x="1" y="${(z * pxPerCm + 9).toFixed(2)}" font-size="8" fill="#555">${z}</text>`;
  }
  return g;
}

function roadsSvg(s: ProjectState, pxPerCm: number): string {
  let out = "";
  for (const r of s.roads) {
    if (r.points.length < 2) continue;
    const pts = sampleRoadPoints(r.points, 16)
      .map((p) => `${(p.x * pxPerCm).toFixed(1)},${(p.z * pxPerCm).toFixed(1)}`)
      .join(" ");
    out += `<polyline points="${pts}" fill="none" stroke="#333" stroke-width="${(r.widthCm * pxPerCm).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`;
    out += `<polyline points="${pts}" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="4 3" opacity="0.9"/>`;
  }
  return out;
}

function zonesSvg(s: ProjectState, pxPerCm: number): string {
  let out = "";
  for (const z of s.zones) {
    if (z.points.length < 3) continue;
    const pts = z.points.map((p) => `${(p.x * pxPerCm).toFixed(1)},${(p.z * pxPerCm).toFixed(1)}`).join(" ");
    out += `<polygon points="${pts}" fill="${z.color}" fill-opacity="0.25" stroke="${z.color}" stroke-width="1.5"/><text x="${(z.points[0].x * pxPerCm).toFixed(1)}" y="${(z.points[0].z * pxPerCm - 3).toFixed(1)}" font-size="9" fill="#111">${esc(z.name)}</text>`;
  }
  return out;
}

function objectsSvg(s: ProjectState, pxPerCm: number, footprint: (defId: string) => { l: number; w: number } | null): string {
  let out = "";
  for (const o of s.objects) {
    const f = footprint(o.defId);
    if (!f) continue;
    const w = f.l * pxPerCm;
    const h = f.w * pxPerCm;
    out += `<g transform="translate(${(o.x * pxPerCm).toFixed(1)},${(o.z * pxPerCm).toFixed(1)}) rotate(${o.rotDeg})"><rect x="${(-w / 2).toFixed(1)}" y="${(-h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#222" fill-opacity="0.7" stroke="#000"/></g>`;
  }
  return out;
}

/** Full top-view plan at true scale (1cm = 37.795px), with grid + all layers. */
export function planSvg(s: ProjectState, footprint: (defId: string) => { l: number; w: number } | null, title: string): string {
  const k = PX_PER_CM;
  const W = s.base.lengthCm * k;
  const H = s.base.widthCm * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(1)}" height="${(H + 40).toFixed(1)}" viewBox="0 -30 ${W.toFixed(1)} ${(H + 40).toFixed(1)}">
<title>${esc(title)}</title>
<text x="0" y="-16" font-size="12" font-family="sans-serif" fill="#111">${esc(title)} — ${s.base.lengthCm}×${s.base.widthCm}cm, 1:${s.scale}, grid 1cm (bold 5cm). Print at 100% for true scale.</text>
<rect x="0" y="0" width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="#f4f1e6" stroke="#111" stroke-width="1.5"/>
${gridSvg(s, k)}
${zonesSvg(s, k)}
${roadsSvg(s, k)}
${objectsSvg(s, k, footprint)}
</svg>`;
}

/**
 * Foam cut sheet: one SVG per height layer. Each layer is the outline of all
 * cells whose height >= layerTop, merged into per-row runs (traceable shapes).
 */
export function cutSheetSvgs(s: ProjectState): { layerTop: number; svg: string; cells: number }[] {
  const k = PX_PER_CM / 2; // half scale to keep files small; labeled clearly
  const W = s.base.lengthCm * k;
  const H = s.base.widthCm * k;
  let maxH = 0;
  for (const h of s.terrain) if (h > maxH) maxH = h;
  const layers: { layerTop: number; svg: string; cells: number }[] = [];
  const t = s.foamThicknessCm;
  for (let top = t; top <= maxH + 1e-9; top += t) {
    let rects = "";
    let cells = 0;
    for (let iz = 0; iz <= s.nz; iz++) {
      let runStart = -1;
      for (let ix = 0; ix <= s.nx + 1; ix++) {
        const inside = ix <= s.nx && s.terrain[iz * (s.nx + 1) + ix] >= top - 1e-9;
        if (inside && runStart < 0) runStart = ix;
        if (!inside && runStart >= 0) {
          const x = runStart * k;
          const w = (ix - runStart) * k;
          rects += `<rect x="${x.toFixed(1)}" y="${(iz * k).toFixed(1)}" width="${w.toFixed(1)}" height="${k.toFixed(1)}" fill="none" stroke="#111" stroke-width="0.6"/>`;
          cells += ix - runStart;
          runStart = -1;
        }
      }
    }
    const topRounded = Math.round(top * 100) / 100;
    layers.push({
      cells,
      layerTop: topRounded,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(1)}" height="${(H + 30).toFixed(1)}" viewBox="0 -24 ${W.toFixed(1)} ${(H + 30).toFixed(1)}">
<title>Foam layer ≥ ${topRounded}cm</title>
<text x="0" y="-8" font-size="11" font-family="sans-serif" fill="#111">Cut sheet — foam layer ≥ ${topRounded}cm (thickness ${t}cm). Trace onto foam, cut, stack. 50% scale print; multiply measurements ×2.</text>
<rect x="0" y="0" width="${W.toFixed(1)}" height="${H.toFixed(1)}" fill="#fff" stroke="#111" stroke-width="1.2"/>
${rects}
</svg>`,
    });
  }
  return layers;
}

/** Height-shaded terrain image layer for the plan (data URL not needed; returns SVG). */
export function terrainShadeSvg(s: ProjectState): string {
  const k = 4; // px per cm preview
  const W = Math.round(s.base.lengthCm * k);
  const H = Math.round(s.base.widthCm * k);
  let maxH = 0.001;
  for (const h of s.terrain) if (h > maxH) maxH = h;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(W, H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const h = sampleHeight(s, (px / k), (pzClamp(py / k, s)));
      const t = Math.min(1, Math.max(0, h / maxH));
      const i = (py * W + px) * 4;
      img.data[i] = 140 + t * 100;
      img.data[i + 1] = 165 - t * 40;
      img.data[i + 2] = 120 - t * 30;
      img.data[i + 3] = 255;
    }
  }
  function pzClamp(v: number, st: ProjectState): number {
    return Math.min(st.base.widthCm - 1e-3, Math.max(0, v));
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
}

export function zoneColorFor(group: "A" | "B" | "C", n: number): string {
  const bases = [GROUP_COLORS[group]];
  const extra = ["#34d399", "#f472b6", "#facc15", "#60a5fa", "#fb923c", "#2dd4bf"];
  if (n <= 0) return bases[0];
  return extra[(n - 1) % extra.length];
}

export function downloadText(filename: string, text: string, mime = "application/octet-stream"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Open a printable true-scale page (user prints at 100% / actual size). */
export function printPlan(svg: string, title: string): void {
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) return;
  w.document.write(`<html><head><title>${title}</title><style>@page{size:auto;margin:10mm}body{margin:0;font-family:sans-serif}svg{max-width:none}</style></head><body>${svg}<script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
}
