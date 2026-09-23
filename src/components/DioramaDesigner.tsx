"use client";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import Viewport3D, { DraftState, LayerVis, ToolId, ViewportHandle } from "./Viewport3D";
import {
  BrushMode,
  GROUP_NAMES,
  OBJECT_LIBRARY,
  PRESETS,
  PresetId,
  ProjectState,
  Road,
  Zone,
  ZoneGroup,
  analyzeRoad,
  applyBrush,
  applyPreset,
  cloneState,
  defaultProject,
  deserialize,
  gradeForAngle,
  profileAlongLine,
  sampleHeight,
  serialize,
  slopeAt,
  uid,
} from "@/lib/model";
import { cutSheetSvgs, downloadDataUrl, downloadText, planSvg, printPlan, zoneColorFor } from "@/lib/exporters";

const AUTOSAVE_KEY = "diorama87.autosave.v1";
const SLOTS_KEY = "diorama87.slots.v1";
const GUIDE_KEY = "diorama87.guide.v1";

const EMPTY_DRAFT: DraftState = { roadPoints: [], sectionA: null, sectionB: null, zonePoints: [] };

const TOOL_HELP: Record<ToolId, string> = {
  erase: "Click an object to remove it. Roads and zones can be deleted from their lists.",
  lower: "Drag on the terrain to push it down. Right-drag orbits, wheel zooms.",
  navigate: "Left-drag orbits, right-drag orbits too, wheel zooms, Ctrl+left-drag pans.",
  object: "Pick an object below, then click the map to place it.",
  raise: "Drag on the terrain to pull it up. Right-drag orbits, wheel zooms.",
  road: "Click points on the map to lay a road. Double-click or Finish to commit.",
  section: "Click two points to slice the terrain and see foam layers.",
  smooth: "Drag over rough spots to soften them.",
  zone: "Click points to outline a work zone. Finish to commit (3+ points).",
};

function loadAutosave(): ProjectState | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? deserialize(raw) : null;
  } catch {
    return null;
  }
}

export default function DioramaDesigner() {
  const stateRef = useRef<ProjectState>(defaultProject());
  const [version, bump] = useReducer((v: number) => v + 1, 0);
  const undoRef = useRef<ProjectState[]>([]);
  const redoRef = useRef<ProjectState[]>([]);
  const viewportRef = useRef<ViewportHandle>(null);
  const [tool, setTool] = useState<ToolId>("navigate");
  const [brushSize, setBrushSize] = useState(8);
  const [brushStrength, setBrushStrength] = useState(0.35);
  const [layers, setLayers] = useState<LayerVis>({ notes: true, objects: true, roads: true, terrain: true, zones: true });
  const [locks, setLocks] = useState<Record<string, boolean>>({});
  const [selectedRoadId, setSelectedRoadId] = useState<string | null>(null);
  const [selectedObjectDefId, setSelectedObjectDefId] = useState<string>("excavator");
  const [objectRot, setObjectRot] = useState(0);
  const [roadWidth, setRoadWidth] = useState(4);
  const [roadGroup, setRoadGroup] = useState<ZoneGroup>("A");
  const [zoneGroup, setZoneGroup] = useState<ZoneGroup>("B");
  const [zoneName, setZoneName] = useState("");
  const [zoneNote, setZoneNote] = useState("");
  const [objectGroup, setObjectGroup] = useState<ZoneGroup>("B");
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [liveSlope, setLiveSlope] = useState<number | null>(null);
  const [strokePeak, setStrokePeak] = useState(0);
  const [autoGrade, setAutoGrade] = useState(true);
  const [camPreset, setCamPreset] = useState<"top" | "iso" | "free">("iso");
  const [guideStep, setGuideStep] = useState(0);
  const [guideDone, setGuideDone] = useState(false);
  const [slots, setSlots] = useState<{ date: string; json: string; name: string }[]>([]);
  const [slotName, setSlotName] = useState("");
  const [status, setStatus] = useState("Ready. Pick a tool on the left to begin.");
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const brushRef = useRef({ size: brushSize, strength: brushStrength });
  brushRef.current = { size: brushSize, strength: brushStrength };

  const getState = () => stateRef.current;
  const refresh = () => viewportRef.current?.refreshAll();
  const refreshTerrain = () => viewportRef.current?.refreshTerrain();

  // Keep the 3D overlays in lockstep with React state after every render commit:
  // live previews while clicking road/zone/section points, and guaranteed visibility
  // of finished roads/zones even if an imperative refresh ran against stale props.
  useEffect(() => {
    viewportRef.current?.refreshOverlays();
  }, [draft, layers, selectedRoadId, version]);

  function pushUndo() {
    undoRef.current.push(cloneState(stateRef.current));
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
  }

  function scheduleAutosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialize(stateRef.current));
    } catch {
      /* storage full — named saves still work via download */
    }
  }

  function undo() {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(cloneState(stateRef.current));
    stateRef.current = prev;
    setDraft(EMPTY_DRAFT);
    bump();
    refresh();
    scheduleAutosave();
    setStatus("Undone.");
  }

  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(cloneState(stateRef.current));
    stateRef.current = next;
    setDraft(EMPTY_DRAFT);
    bump();
    refresh();
    scheduleAutosave();
    setStatus("Redone.");
  }

  useEffect(() => {
    const auto = loadAutosave();
    if (auto && auto.terrain.length === (auto.nx + 1) * (auto.nz + 1)) {
      stateRef.current = auto;
      setStatus("Restored your last auto-save. Keep going!");
    }
    try {
      setSlots(JSON.parse(localStorage.getItem(SLOTS_KEY) ?? "[]") as { date: string; json: string; name: string }[]);
      if (localStorage.getItem(GUIDE_KEY) === "done") setGuideDone(true);
    } catch {
      /* fresh start */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistSlots(next: { date: string; json: string; name: string }[]) {
    setSlots(next);
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  // ---- terrain ----
  const strokeUndoPushed = useRef(false);
  function onStrokeStart() {
    if (locks.terrain) {
      setStatus("Terrain layer is locked — unlock it to sculpt.");
      return;
    }
    pushUndo();
    strokeUndoPushed.current = true;
    setStrokePeak(0);
  }
  function onTerrainPoint(x: number, z: number) {
    if (locks.terrain || !strokeUndoPushed.current) return;
    const s = stateRef.current;
    const mode = toolRef.current as BrushMode;
    const peak = applyBrush(s, mode, x, z, brushRef.current.size, brushRef.current.strength * 0.6);
    setStrokePeak((p) => Math.max(p, Math.round(peak * 10) / 10));
    setLiveSlope(Math.round(slopeAt(s, x, z) * 10) / 10);
    refreshTerrain();
  }
  function onStrokeEnd() {
    strokeUndoPushed.current = false;
    bump();
    scheduleAutosave();
  }

  function resizeBase(lengthCm: number, widthCm: number) {
    const L = Math.min(150, Math.max(20, Math.round(lengthCm) || 90));
    const W = Math.min(100, Math.max(20, Math.round(widthCm) || 60));
    pushUndo();
    const old = stateRef.current;
    const next = cloneState(old);
    next.base = { lengthCm: L, widthCm: W };
    next.nx = L;
    next.nz = W;
    const nt: number[] = new Array((L + 1) * (W + 1)).fill(0);
    for (let iz = 0; iz <= W; iz++) {
      for (let ix = 0; ix <= L; ix++) {
        nt[iz * (L + 1) + ix] = sampleHeight(old, (ix / L) * old.base.lengthCm, (iz / W) * old.base.widthCm);
      }
    }
    next.terrain = nt;
    next.roads = next.roads.map((r) => ({ ...r, points: r.points.filter((p) => p.x <= L && p.z <= W) }));
    next.zones = next.zones.map((z) => ({ ...z, points: z.points.filter((p) => p.x <= L && p.z <= W) }));
    next.objects = next.objects.filter((o) => o.x <= L && o.z <= W);
    stateRef.current = next;
    setDraft(EMPTY_DRAFT);
    bump();
    refresh();
    scheduleAutosave();
    setStatus(`Base plate set to ${L}×${W}cm.`);
  }

  function runPreset(id: PresetId) {
    if (locks.terrain) {
      setStatus("Terrain layer is locked — unlock it to apply a preset.");
      return;
    }
    pushUndo();
    applyPreset(stateRef.current, id);
    bump();
    refresh();
    scheduleAutosave();
    setStatus(`Preset applied: ${PRESETS.find((p) => p.id === id)?.label}. Tweak it with the brushes.`);
  }

  // ---- map clicks per tool ----
  function onMapClick(x: number, z: number) {
    const t = toolRef.current;
    const px = Math.round(x * 10) / 10;
    const pz = Math.round(z * 10) / 10;
    if (t === "road") {
      if (locks.roads) return setStatus("Roads layer is locked.");
      setDraft((d) => ({ ...d, roadPoints: [...d.roadPoints, { x: px, z: pz }] }));
    } else if (t === "zone") {
      if (locks.zones) return setStatus("Zones layer is locked.");
      setDraft((d) => ({ ...d, zonePoints: [...d.zonePoints, { x: px, z: pz }] }));
    } else if (t === "object") {
      if (locks.objects) return setStatus("Objects layer is locked.");
      if (!selectedObjectDefId) return setStatus("Pick an object from the library first.");
      pushUndo();
      stateRef.current.objects.push({ defId: selectedObjectDefId, group: objectGroup, id: uid("obj"), rotDeg: objectRot, x: px, z: pz });
      bump();
      refresh();
      scheduleAutosave();
      const def = OBJECT_LIBRARY.find((d) => d.id === selectedObjectDefId);
      setStatus(`Placed ${def?.label ?? "object"} at ${px}, ${pz}cm.`);
    } else if (t === "section") {
      setDraft((d) => {
        if (!d.sectionA || (d.sectionA && d.sectionB)) return { ...d, sectionA: { x: px, z: pz }, sectionB: null };
        return { ...d, sectionB: { x: px, z: pz } };
      });
    } else if (t === "erase") {
      pushUndo();
      const s = stateRef.current;
      let best = -1;
      let bestD = 4;
      s.objects.forEach((o, i) => {
        const dpt = Math.hypot(o.x - px, o.z - pz);
        if (dpt < bestD) {
          bestD = dpt;
          best = i;
        }
      });
      if (best >= 0) {
        const [gone] = s.objects.splice(best, 1);
        const def = OBJECT_LIBRARY.find((d) => d.id === gone.defId);
        setStatus(`Removed ${def?.label ?? "object"}.`);
      } else {
        undoRef.current.pop();
        setStatus("Nothing to erase there — click closer to an object.");
        return;
      }
      bump();
      refresh();
      scheduleAutosave();
    }
  }

  function finishRoad() {
    const pts = draftRef.current.roadPoints;
    if (pts.length < 2) return setStatus("Click at least 2 points for a road.");
    pushUndo();
    const s = stateRef.current;
    const n = s.roads.length + 1;
    const road: Road = { group: roadGroup, id: uid("road"), name: `Road ${n}`, points: pts, widthCm: roadWidth };
    s.roads.push(road);
    setSelectedRoadId(road.id);
    setDraft((d) => ({ ...d, roadPoints: [] }));
    bump();
    refresh();
    scheduleAutosave();
    const a = analyzeRoad(s, road);
    setStatus(`Road ${n} added (${Math.round(a?.lengthCm ?? 0)}cm). Steep parts glow red automatically.`);
  }

  function finishZone() {
    const pts = draftRef.current.zonePoints;
    if (pts.length < 3) return setStatus("Click at least 3 points to outline a zone.");
    pushUndo();
    const s = stateRef.current;
    const inGroup = s.zones.filter((z) => z.group === zoneGroup).length;
    const n = s.zones.length + 1;
    const zone: Zone = {
      color: zoneColorFor(zoneGroup, inGroup),
      group: zoneGroup,
      id: uid("zone"),
      name: zoneName.trim() || `Zone ${zoneGroup}-${inGroup + 1}`,
      note: zoneNote.trim(),
      points: pts,
    };
    s.zones.push(zone);
    setZoneName("");
    setZoneNote("");
    setDraft((d) => ({ ...d, zonePoints: [] }));
    bump();
    refresh();
    scheduleAutosave();
    setStatus(`Work zone "${zone.name}" added (#${n}).`);
  }

  function deleteRoad(id: string) {
    pushUndo();
    stateRef.current.roads = stateRef.current.roads.filter((r) => r.id !== id);
    if (selectedRoadId === id) setSelectedRoadId(null);
    bump();
    refresh();
    scheduleAutosave();
  }

  function deleteZone(id: string) {
    pushUndo();
    stateRef.current.zones = stateRef.current.zones.filter((z) => z.id !== id);
    bump();
    refresh();
    scheduleAutosave();
  }

  // ---- vehicle + scale ----
  function setVehicle(patch: Partial<ProjectState["vehicle"]>) {
    pushUndo();
    Object.assign(stateRef.current.vehicle, patch);
    if (autoGrade) {
      stateRef.current.maxGradePct = Math.round(gradeForAngle(stateRef.current.vehicle.maxClimbDeg) * 10) / 10;
    }
    bump();
    refresh();
    scheduleAutosave();
  }

  function setScale(scale: number) {
    pushUndo();
    stateRef.current.scale = Math.min(500, Math.max(1, Math.round(scale) || 87));
    bump();
    refresh();
    scheduleAutosave();
  }

  function footprintOf(defId: string): { l: number; w: number } | null {
    const d = OBJECT_LIBRARY.find((o) => o.id === defId);
    if (!d) return null;
    const sc = stateRef.current.scale;
    return { l: d.realLengthCm / sc, w: d.realWidthCm / sc };
  }

  // ---- export / save ----
  function exportSnapshot() {
    const url = viewportRef.current?.screenshot() ?? "";
    if (!url) return setStatus("3D view not ready yet.");
    downloadDataUrl("diorama-3d-view.png", url);
    setStatus("Saved a PNG snapshot of the 3D view.");
  }

  function exportPlan() {
    const s = stateRef.current;
    const svg = planSvg(s, footprintOf, `Diorama plan 1:${s.scale}`);
    downloadText("diorama-plan-truescale.svg", svg, "image/svg+xml");
    setStatus("Downloaded the true-scale plan (SVG). Print at 100% for real centimeters.");
  }

  function printTrueScale() {
    const s = stateRef.current;
    printPlan(planSvg(s, footprintOf, `Diorama plan 1:${s.scale}`), "Diorama plan — true scale");
  }

  function exportCutSheets() {
    const s = stateRef.current;
    const sheets = cutSheetSvgs(s);
    if (sheets.length === 0) return setStatus("Terrain is flat — no foam layers to cut yet. Sculpt some hills first.");
    sheets.forEach((sh, i) => {
      setTimeout(() => downloadText(`foam-layer-${String(sh.layerTop).replace(".", "p")}cm.svg`, sh.svg, "image/svg+xml"), i * 350);
    });
    setStatus(`Exporting ${sheets.length} foam layer sheets — check your downloads.`);
  }

  function exportJson() {
    downloadText("diorama-project.json", serialize(stateRef.current), "application/json");
    setStatus("Project data downloaded (JSON backup).");
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = deserialize(String(reader.result ?? ""));
        if (next.terrain.length !== (next.nx + 1) * (next.nz + 1)) throw new Error("bad grid");
        pushUndo();
        stateRef.current = next;
        if (autoGrade) stateRef.current.maxGradePct = Math.round(gradeForAngle(next.vehicle.maxClimbDeg) * 10) / 10;
        setDraft(EMPTY_DRAFT);
        bump();
        refresh();
        scheduleAutosave();
        setStatus(`Imported project (${next.base.lengthCm}×${next.base.widthCm}cm).`);
      } catch {
        setStatus("That file isn't a valid diorama project.");
      }
    };
    reader.readAsText(file);
  }

  function saveSlot() {
    const name = slotName.trim() || `Version ${slots.length + 1}`;
    persistSlots([...slots, { date: new Date().toLocaleString(), json: serialize(stateRef.current), name }]);
    setSlotName("");
    setStatus(`Saved "${name}". Compare versions anytime below.`);
  }

  function loadSlot(i: number) {
    try {
      const next = deserialize(slots[i].json);
      pushUndo();
      stateRef.current = next;
      setDraft(EMPTY_DRAFT);
      bump();
      refresh();
      scheduleAutosave();
      setStatus(`Loaded "${slots[i].name}".`);
    } catch {
      setStatus("That save point is corrupted.");
    }
  }

  // ---- derived stats for panels (recomputed each render after bump) ----
  const s = stateRef.current;
  const stats = useMemo(() => {
    let maxH = 0;
    let steep = 0;
    let total = 0;
    for (let iz = 0; iz <= s.nz; iz += 2) {
      for (let ix = 0; ix <= s.nx; ix += 2) {
        const h = s.terrain[iz * (s.nx + 1) + ix];
        if (h > maxH) maxH = h;
        total++;
        if (slopeAt(s, ix, iz) > s.maxGradePct) steep++;
      }
    }
    return { maxH: Math.round(maxH * 10) / 10, steepPct: total ? Math.round((steep / total) * 100) : 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const selectedRoad = s.roads.find((r) => r.id === selectedRoadId) ?? null;
  const selectedAnalysis = selectedRoad ? analyzeRoad(s, selectedRoad) : null;
  const profile =
    draft.sectionA && draft.sectionB ? profileAlongLine(s, draft.sectionA, draft.sectionB) : null;
  const foamLayersNeeded = profile ? Math.ceil(Math.max(...profile.map((p) => p.h), 0) / s.foamThicknessCm) : 0;
  const cutSheets = useMemo(() => cutSheetSvgs(s), [version]);
  const guideSteps = ["Base plate", "Sculpt terrain", "Draw roads", "Zones & objects"];

  function dismissGuide() {
    setGuideDone(true);
    try {
      localStorage.setItem(GUIDE_KEY, "done");
    } catch {
      /* ignore */
    }
  }

  const tools: { id: ToolId; label: string }[] = [
    { id: "navigate", label: "🖱️ Move" },
    { id: "raise", label: "⛰️ Raise" },
    { id: "lower", label: "🕳️ Lower" },
    { id: "smooth", label: "〰️ Smooth" },
    { id: "road", label: "🛣️ Road" },
    { id: "zone", label: "⬠ Zone" },
    { id: "object", label: "📦 Object" },
    { id: "section", label: "🔪 Slice" },
    { id: "erase", label: "🧹 Erase" },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <h1>⛰️ Diorama 1:{s.scale}</h1>
        <span className="sub">RC terrain designer · real centimeters · beginner mode</span>
        <button className="btn small" disabled={undoRef.current.length === 0} onClick={undo} title="Undo (everything is reversible)">
          ↩ Undo
        </button>
        <button className="btn small" disabled={redoRef.current.length === 0} onClick={redo} title="Redo">
          ↪ Redo
        </button>
        <span className="sub" style={{ marginLeft: "auto" }}>
          1cm on model = {s.scale}cm real · grid 1cm (bold 5cm)
        </span>
      </header>
      <div className="main">
        <aside className="sidebar">
          {!guideDone && (
            <div className="panel guide">
              <h2>🚀 First build ({guideStep + 1}/4)</h2>
              <ol>
                {guideSteps.map((g, i) => (
                  <li className={i < guideStep ? "done" : ""} key={g}>
                    {g} {i === guideStep ? "← you are here" : ""}
                  </li>
                ))}
              </ol>
              <div className="hint">
                {guideStep === 0 && "Your plate is 90×60cm by default. Change it below if you like, then continue."}
                {guideStep === 1 && "Pick Raise and drag on the plate — or hit a preset. Red = too steep for your crawler."}
                {guideStep === 2 && "Switch to the Road tool, click a few points, then Finish road."}
                {guideStep === 3 && "Outline a Zone, drop some Objects, then export your foam cut sheets!"}
              </div>
              <div className="row">
                {guideStep > 0 && (
                  <button className="btn small" onClick={() => setGuideStep(guideStep - 1)}>
                    Back
                  </button>
                )}
                {guideStep < 3 && (
                  <button
                    className="btn small primary"
                    onClick={() => {
                      if (guideStep === 0) setTool("navigate");
                      if (guideStep === 1) setTool("raise");
                      if (guideStep === 2) setTool("road");
                      setGuideStep(guideStep + 1);
                    }}
                  >
                    Next →
                  </button>
                )}
                {guideStep === 3 && (
                  <button className="btn small primary" onClick={dismissGuide}>
                    Done — hide guide
                  </button>
                )}
                <button className="btn small" onClick={dismissGuide}>
                  Skip
                </button>
              </div>
            </div>
          )}

          <div className="panel">
            <div className="hint" aria-live="polite">
              {status}
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              {TOOL_HELP[tool]} Left = use tool · right-drag = orbit · wheel = zoom · Ctrl+left = pan.
            </div>
          </div>

          <div className="panel">
            <h2>Tools</h2>
            <div className="toolgrid">
              {tools.map((t) => (
                <button className={`btn small${tool === t.id ? " active" : ""}`} key={t.id} onClick={() => setTool(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            {(tool === "raise" || tool === "lower" || tool === "smooth") && (
              <>
                <div className="row">
                  <label>Brush size</label>
                  <input max={30} min={2} onChange={(e) => setBrushSize(Number(e.target.value))} type="range" value={brushSize} />
                  <span className="val">{brushSize}cm</span>
                </div>
                <div className="row">
                  <label>Strength</label>
                  <input max={2.5} min={0.05} onChange={(e) => setBrushStrength(Number(e.target.value))} step={0.05} type="range" value={brushStrength} />
                  <span className="val">{brushStrength.toFixed(2)}</span>
                </div>
                <div className="hint">Tip: crank strength past 1.0 — or hit the ⛰ Mountain preset — to raise real peaks fast.</div>
                <div className="kv">
                  <span>
                    Slope here:{" "}
                    <b className="slope-live" style={{ color: liveSlope != null && liveSlope > s.maxGradePct ? "#ff8a8a" : "#9df0b6" }}>
                      {liveSlope == null ? "—" : `${liveSlope}%`}
                    </b>
                  </span>
                  <span>
                    limit <b>{s.maxGradePct}%</b>
                  </span>
                </div>
                {strokePeak > s.maxGradePct && <div className="warn">⚠ Last stroke peaked at {strokePeak}% — over your crawler&apos;s limit. It still counts; smooth it or keep it as a challenge.</div>}
              </>
            )}
          </div>

          <div className="panel">
            <h2>1 · Base plate</h2>
            <div className="row">
              <label>Length × width (cm)</label>
              <input defaultValue={s.base.lengthCm} id="baseL" key={`L${s.base.lengthCm}`} type="number" />
              <span>×</span>
              <input defaultValue={s.base.widthCm} id="baseW" key={`W${s.base.widthCm}`} type="number" />
              <button
                className="btn small"
                onClick={() => {
                  const L = Number((document.getElementById("baseL") as HTMLInputElement)?.value);
                  const W = Number((document.getElementById("baseW") as HTMLInputElement)?.value);
                  resizeBase(L, W);
                }}
              >
                Apply
              </button>
            </div>
            <div className="kv">
              <span>Peak height</span>
              <b>{stats.maxH}cm</b>
            </div>
            <div className="kv">
              <span>Too-steep terrain</span>
              <b style={{ color: stats.steepPct > 0 ? "#ff8a8a" : "#9df0b6" }}>{stats.steepPct}%</b>
            </div>
            <h3>Presets — start here, then tweak</h3>
            <div className="row">
              {PRESETS.map((p) => (
                <button className="btn small" key={p.id} onClick={() => runPreset(p.id)} title={p.hint}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>2 · Roads & paths</h2>
            <div className="row">
              <label>Width (cm)</label>
              <input max={12} min={1} onChange={(e) => setRoadWidth(Number(e.target.value))} step={0.5} type="range" value={roadWidth} />
              <span className="val">{roadWidth}cm</span>
            </div>
            <div className="row">
              <label>Group</label>
              {(["A", "B", "C"] as ZoneGroup[]).map((g) => (
                <button className={`btn small${roadGroup === g ? " active" : ""}`} key={g} onClick={() => setRoadGroup(g)}>
                  {g}
                </button>
              ))}
            </div>
            <div className="row">
              <button className="btn small" onClick={() => setTool("road")}>
                Draw road
              </button>
              <button className="btn small primary" disabled={draft.roadPoints.length < 2} onClick={finishRoad}>
                Finish road ({draft.roadPoints.length} pts)
              </button>
              <button className="btn small" disabled={draft.roadPoints.length === 0} onClick={() => setDraft((d) => ({ ...d, roadPoints: [] }))}>
                Clear
              </button>
            </div>
            {s.roads.length === 0 && <div className="hint">No roads yet. Tip: zigzag up hillsides (switchbacks) to keep grades low.</div>}
            {s.roads.map((r) => {
              const a = analyzeRoad(s, r);
              const badGrade = (a?.maxGradePct ?? 0) > s.maxGradePct;
              const badTurn = (a?.minRadiusCm ?? Infinity) < s.vehicle.minTurnRadiusCm;
              return (
                <div className="list-item" key={r.id}>
                  <span className="dot" style={{ background: badGrade || badTurn ? "#d92d20" : "#34d399" }} />
                  <button className="btn small" onClick={() => setSelectedRoadId(r.id)} style={selectedRoadId === r.id ? { borderColor: "#fff" } : undefined}>
                    {r.name}
                  </button>
                  <span className="hint">
                    {Math.round(a?.lengthCm ?? 0)}cm · ≤{Math.round(a?.maxGradePct ?? 0)}% · ↩{a && a.minRadiusCm !== Infinity ? `${Math.round(a.minRadiusCm)}cm` : "—"}
                  </span>
                  <button className="btn small danger" onClick={() => deleteRoad(r.id)} style={{ marginLeft: "auto" }}>
                    ✕
                  </button>
                </div>
              );
            })}
            {selectedRoad && selectedAnalysis && (
              <div className="hint" style={{ marginTop: 6 }}>
                {selectedAnalysis.maxGradePct > s.maxGradePct ? (
                  <span className="warn">⚠ {selectedRoad.name} peaks at {Math.round(selectedAnalysis.maxGradePct)}% grade (limit {s.maxGradePct}%). Steep bits glow red — add a switchback.</span>
                ) : (
                  <span className="ok">✓ {selectedRoad.name} max grade {Math.round(selectedAnalysis.maxGradePct)}% — drivable.</span>
                )}{" "}
                {selectedAnalysis.minRadiusCm !== Infinity && selectedAnalysis.minRadiusCm < s.vehicle.minTurnRadiusCm && (
                  <span className="warn">⚠ Tightest turn {Math.round(selectedAnalysis.minRadiusCm)}cm &lt; minimum {s.vehicle.minTurnRadiusCm}cm.</span>
                )}
              </div>
            )}
          </div>

          <div className="panel">
            <h2>3 · Work zones</h2>
            <div className="row">
              <label>Group</label>
              {(["A", "B", "C"] as ZoneGroup[]).map((g) => (
                <button className={`btn small${zoneGroup === g ? " active" : ""}`} key={g} onClick={() => setZoneGroup(g)} title={GROUP_NAMES[g]}>
                  {g}
                </button>
              ))}
            </div>
            <div className="row">
              <label>Name</label>
              <input onChange={(e) => setZoneName(e.target.value)} placeholder="e.g. log staging" type="text" value={zoneName} />
            </div>
            <div className="row">
              <label>Note</label>
              <input onChange={(e) => setZoneNote(e.target.value)} placeholder="e.g. pine logs, 2 piles" type="text" value={zoneNote} />
            </div>
            <div className="row">
              <button className="btn small" onClick={() => setTool("zone")}>
                Outline zone
              </button>
              <button className="btn small primary" disabled={draft.zonePoints.length < 3} onClick={finishZone}>
                Finish ({draft.zonePoints.length} pts)
              </button>
              <button className="btn small" disabled={draft.zonePoints.length === 0} onClick={() => setDraft((d) => ({ ...d, zonePoints: [] }))}>
                Clear
              </button>
            </div>
            {s.zones.length === 0 && <div className="hint">No zones yet — outline areas like “clearing” or “equipment yard”.</div>}
            {s.zones.map((z) => (
              <div className="list-item" key={z.id}>
                <span className="dot" style={{ background: z.color }} />
                <span>
                  <b>{z.name}</b> <span className="hint">[{z.group}]</span>
                  {z.note && <div className="hint">📝 {z.note}</div>}
                </span>
                <button className="btn small danger" onClick={() => deleteZone(z.id)} style={{ marginLeft: "auto" }}>
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="panel">
            <h2>4 · Objects (true 1:{s.scale} size)</h2>
            <div className="row">
              <label>Group</label>
              {(["A", "B", "C"] as ZoneGroup[]).map((g) => (
                <button className={`btn small${objectGroup === g ? " active" : ""}`} key={g} onClick={() => setObjectGroup(g)}>
                  {g}
                </button>
              ))}
            </div>
            <div className="row">
              <label>Rotate</label>
              <input max={180} min={-180} onChange={(e) => setObjectRot(Number(e.target.value))} step={15} type="range" value={objectRot} />
              <span className="val">{objectRot}°</span>
            </div>
            {OBJECT_LIBRARY.map((d) => {
              const f = footprintOf(d.id);
              return (
                <div className="list-item" key={d.id}>
                  <span className="dot" style={{ background: d.color }} />
                  <button
                    className={`btn small${selectedObjectDefId === d.id ? " active" : ""}`}
                    onClick={() => {
                      setSelectedObjectDefId(d.id);
                      setTool("object");
                    }}
                  >
                    {d.label}
                  </button>
                  <span className="hint">
                    real {d.realLengthCm}×{d.realWidthCm}cm → model {f ? `${(f.l).toFixed(1)}×${(f.w).toFixed(1)}` : "?"}cm
                  </span>
                </div>
              );
            })}
            <div className="hint">{s.objects.length} placed. Use 🧹 Erase + click to remove one.</div>
          </div>

          <div className="panel">
            <h2>🔪 Cross-section → foam layers</h2>
            <div className="row">
              <button className="btn small" onClick={() => setTool("section")}>
                Pick slice
              </button>
              <button className="btn small" disabled={!draft.sectionA && !draft.sectionB} onClick={() => setDraft((d) => ({ ...d, sectionA: null, sectionB: null }))}>
                Clear
              </button>
              <span className="hint">Foam: </span>
              <input
                min={0.5}
                onChange={(e) => {
                  pushUndo();
                  stateRef.current.foamThicknessCm = Math.min(5, Math.max(0.5, Number(e.target.value) || 1));
                  bump();
                  scheduleAutosave();
                }}
                step={0.5}
                style={{ width: 56 }}
                type="number"
                value={s.foamThicknessCm}
              />
              <span className="hint">cm</span>
            </div>
            {profile ? (
              <>
                <SectionChart foam={s.foamThicknessCm} profile={profile} />
                <div className="kv">
                  <span>Foam layers needed here</span>
                  <b>{foamLayersNeeded} × {s.foamThicknessCm}cm</b>
                </div>
              </>
            ) : (
              <div className="hint">Click two points on the map with the Slice tool to see the profile and foam stack.</div>
            )}
          </div>

          <div className="panel">
            <h2>Layers & zone groups</h2>
            {(["terrain", "roads", "zones", "objects", "notes"] as const).map((k) => (
              <div className="list-item" key={k}>
                <button className={`btn small${layers[k] ? " active" : ""}`} onClick={() => { setLayers({ ...layers, [k]: !layers[k] }); setTimeout(refresh, 0); }}>
                  {layers[k] ? "👁" : "🚫"} {k}
                </button>
                <button className="btn small" onClick={() => setLocks({ ...locks, [k]: !locks[k] })} style={{ marginLeft: "auto" }} title="Lock against editing">
                  {locks[k] ? "🔒 locked" : "🔓"}
                </button>
              </div>
            ))}
            <h3>Show / hide group</h3>
            {(["A", "B", "C"] as ZoneGroup[]).map((g) => (
              <div className="kv" key={g}>
                <span>
                  <span className="dot" style={{ background: "#888" }} /> {GROUP_NAMES[g]}
                </span>
                <span className="hint">
                  {s.roads.filter((r) => r.group === g).length} roads · {s.zones.filter((z) => z.group === g).length} zones ·{" "}
                  {s.objects.filter((o) => o.group === g).length} objects
                </span>
              </div>
            ))}
            <div className="hint">Tip: move items between groups by deleting + re-adding, or leave everything in one group to start.</div>
          </div>

          <div className="panel">
            <h2>🚜 Scale & vehicle fit</h2>
            <div className="row">
              <label>Scale 1:</label>
              <input
                min={1}
                onChange={(e) => setScale(Number(e.target.value))}
                style={{ width: 70 }}
                type="number"
                value={s.scale}
              />
              <span className="hint">1cm = {s.scale}cm</span>
            </div>
            <div className="row">
              <label>Wheelbase (cm)</label>
              <input min={1} onChange={(e) => setVehicle({ wheelbaseCm: Number(e.target.value) || 0 })} step={0.5} style={{ width: 70 }} type="number" value={s.vehicle.wheelbaseCm} />
            </div>
            <div className="row">
              <label>Clearance (cm)</label>
              <input min={0} onChange={(e) => setVehicle({ clearanceCm: Number(e.target.value) || 0 })} step={0.5} style={{ width: 70 }} type="number" value={s.vehicle.clearanceCm} />
            </div>
            <div className="row">
              <label>Max climb (°)</label>
              <input min={5} max={60} onChange={(e) => setVehicle({ maxClimbDeg: Number(e.target.value) || 0 })} step={1} style={{ width: 70 }} type="number" value={s.vehicle.maxClimbDeg} />
            </div>
            <div className="row">
              <label>Min turn (cm)</label>
              <input min={1} onChange={(e) => setVehicle({ minTurnRadiusCm: Number(e.target.value) || 0 })} step={1} style={{ width: 70 }} type="number" value={s.vehicle.minTurnRadiusCm} />
            </div>
            <div className="row">
              <label>Max grade (%)</label>
              <input
                min={5}
                onChange={(e) => {
                  setAutoGrade(false);
                  pushUndo();
                  stateRef.current.maxGradePct = Number(e.target.value) || 0;
                  bump();
                  refresh();
                  scheduleAutosave();
                }}
                step={1}
                style={{ width: 70 }}
                type="number"
                value={s.maxGradePct}
              />
              <button
                className="btn small"
                onClick={() => {
                  setAutoGrade(true);
                  pushUndo();
                  stateRef.current.maxGradePct = Math.round(gradeForAngle(stateRef.current.vehicle.maxClimbDeg) * 10) / 10;
                  bump();
                  refresh();
                  scheduleAutosave();
                }}
                title="Derive from max climb angle"
              >
                {autoGrade ? "auto ✓" : "auto"}
              </button>
            </div>
            <div className="kv">
              <span>Terrain over limit</span>
              <b style={{ color: stats.steepPct > 0 ? "#ff8a8a" : "#9df0b6" }}>{stats.steepPct}% of plate</b>
            </div>
          </div>

          <div className="panel">
            <h2>🖨️ Export & build</h2>
            <div className="row">
              <button className="btn small" onClick={exportSnapshot}>
                📷 3D snapshot (PNG)
              </button>
              <button className="btn small" onClick={exportPlan}>
                📐 True-scale plan (SVG)
              </button>
            </div>
            <div className="row">
              <button className="btn small" onClick={printTrueScale}>
                🖨️ Print plan @100%
              </button>
              <button className="btn small primary" onClick={exportCutSheets}>
                🧱 Foam cut sheets ({cutSheets.length})
              </button>
            </div>
            <div className="hint">Cut sheets: one outline per {s.foamThicknessCm}cm foam layer — trace, cut, stack. {cutSheets.length} layers right now.</div>
            <div className="row">
              <button className="btn small" onClick={exportJson}>
                💾 Backup (JSON)
              </button>
              <label className="btn small" style={{ cursor: "pointer" }}>
                📂 Restore
                <input accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} type="file" />
              </label>
            </div>
          </div>

          <div className="panel">
            <h2>💾 Versions</h2>
            <div className="hint">Auto-save is on — this browser restores your last session. Name versions to compare themes.</div>
            <div className="row">
              <input onChange={(e) => setSlotName(e.target.value)} placeholder="e.g. logging camp v2" type="text" value={slotName} />
              <button className="btn small primary" onClick={saveSlot}>
                Save point
              </button>
            </div>
            {slots.map((sl, i) => (
              <div className="list-item" key={`${sl.name}-${i}`}>
                <span>
                  <b>{sl.name}</b>
                  <div className="hint">{sl.date}</div>
                </span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button className="btn small" onClick={() => loadSlot(i)}>
                    Load
                  </button>
                  <button className="btn small danger" onClick={() => persistSlots(slots.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        </aside>

        <div className="viewport-wrap">
          <Viewport3D
            brushSizeCm={brushSize}
            draft={draft}
            getState={getState}
            layers={layers}
            onHoverSlope={(v) => setLiveSlope(v == null ? null : Math.round(v * 10) / 10)}
            onMapClick={onMapClick}
            onStrokeEnd={onStrokeEnd}
            onStrokeStart={onStrokeStart}
            onTerrainPoint={onTerrainPoint}
            ref={viewportRef}
            selectedObjectDefId={selectedObjectDefId}
            selectedRoadId={selectedRoadId}
            tool={tool}
          />
          <div className="cam-buttons">
            {(["top", "iso", "free"] as const).map((c) => (
              <button
                className={`btn small${camPreset === c ? " active" : ""}`}
                key={c}
                onClick={() => {
                  setCamPreset(c);
                  viewportRef.current?.setCamera(c);
                }}
              >
                {c === "top" ? "⬒ Top-down" : c === "iso" ? "⬔ Isometric" : "🎥 Free"}
              </button>
            ))}
          </div>
          <div className="hud">
            <div>
              <b>1:{s.scale}</b> · plate {s.base.lengthCm}×{s.base.widthCm}cm · peak {stats.maxH}cm · {s.roads.length} roads · {s.zones.length} zones · {s.objects.length} objects
            </div>
            <div style={{ color: liveSlope != null && liveSlope > s.maxGradePct ? "#ff8a8a" : "#9df0b6" }}>
              slope under cursor: {liveSlope == null ? "—" : `${liveSlope}%`} (limit {s.maxGradePct}%)
            </div>
            <div className="scalebar" style={{ width: 10 * 4 }} title="10cm on the model" />
            <div>▔▔▔▔ 10cm model = {(10 * s.scale) / 100}m real</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionChart({ foam, profile }: { foam: number; profile: { dist: number; h: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const W = (cv.width = 280);
    const H = (cv.height = 130);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const maxD = Math.max(...profile.map((p) => p.dist), 1);
    const maxH = Math.max(...profile.map((p) => p.h), foam, 0.5);
    const X = (d: number) => 8 + (d / maxD) * (W - 16);
    const Y = (h: number) => H - 8 - (h / (maxH * 1.1)) * (H - 20);
    ctx.strokeStyle = "#2c3746";
    for (let f = 0; f <= maxH + 1e-9; f += foam) {
      ctx.beginPath();
      ctx.moveTo(8, Y(f));
      ctx.lineTo(W - 8, Y(f));
      ctx.stroke();
      ctx.fillStyle = "#7d8ea3";
      ctx.font = "9px sans-serif";
      ctx.fillText(`${Math.round(f * 10) / 10}`, 1, Y(f) + 3);
    }
    ctx.beginPath();
    profile.forEach((p, i) => {
      if (i === 0) ctx.moveTo(X(p.dist), Y(p.h));
      else ctx.lineTo(X(p.dist), Y(p.h));
    });
    ctx.strokeStyle = "#4da3ff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(X(maxD), H - 8);
    ctx.lineTo(X(0), H - 8);
    ctx.closePath();
    ctx.fillStyle = "rgba(77,163,255,.25)";
    ctx.fill();
  }, [foam, profile]);
  return <canvas className="chart" ref={ref} />;
}
