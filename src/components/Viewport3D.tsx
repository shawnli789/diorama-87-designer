"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OBJECT_LIBRARY, ProjectState, Road, Zone, sampleHeight, sampleRoadPoints, slopeAt } from "@/lib/model";

export type ToolId = "navigate" | "raise" | "lower" | "smooth" | "road" | "zone" | "object" | "section" | "erase";

export interface LayerVis {
  terrain: boolean;
  roads: boolean;
  zones: boolean;
  objects: boolean;
  notes: boolean;
}

export interface DraftState {
  roadPoints: { x: number; z: number }[];
  zonePoints: { x: number; z: number }[];
  sectionA: { x: number; z: number } | null;
  sectionB: { x: number; z: number } | null;
}

export interface ViewportHandle {
  refreshAll: () => void;
  refreshOverlays: () => void;
  refreshTerrain: () => void;
  screenshot: () => string;
  setCamera: (preset: "top" | "iso" | "free") => void;
}

interface Props {
  getState: () => ProjectState;
  tool: ToolId;
  brushSizeCm: number;
  layers: LayerVis;
  selectedRoadId: string | null;
  selectedObjectDefId: string | null;
  draft: DraftState;
  onTerrainPoint: (x: number, z: number) => void;
  onStrokeStart: () => void;
  onStrokeEnd: () => void;
  onHoverSlope: (slopePct: number | null) => void;
  onMapClick: (x: number, z: number) => void;
  onCameraChange?: () => void;
}

function footprintOf(defId: string, scale: number): { l: number; w: number; h: number } | null {
  const d = OBJECT_LIBRARY.find((o) => o.id === defId);
  if (!d) return null;
  return { h: d.realHeightCm / scale, l: d.realLengthCm / scale, w: d.realWidthCm / scale };
}

const Viewport3D = forwardRef<ViewportHandle, Props>(function Viewport3D(props, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ refreshAll: () => void; refreshOverlays: () => void; refreshTerrain: () => void; screenshot: () => string; setCamera: (p: "top" | "iso" | "free") => void } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useImperativeHandle(ref, () => ({
    refreshAll: () => apiRef.current?.refreshAll(),
    refreshOverlays: () => apiRef.current?.refreshOverlays(),
    refreshTerrain: () => apiRef.current?.refreshTerrain(),
    screenshot: () => apiRef.current?.screenshot() ?? "",
    setCamera: (p) => apiRef.current?.setCamera(p),
  }));

  useEffect(() => {
    const mount: HTMLDivElement | null = mountRef.current;
    if (mount == null) return;
    const el: HTMLDivElement = mount;
    const P = () => propsRef.current;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f14);
    scene.fog = new THREE.Fog(0x0b0f14, 400, 900);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);

    scene.add(new THREE.HemisphereLight(0xdfefff, 0x33402a, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(80, 120, 40);
    scene.add(sun);

    // Camera rig state (custom orbit: target + yaw + pitch + distance)
    const rig = { distance: 130, pitch: 0.9, target: new THREE.Vector3(45, 0, 30), yaw: -Math.PI / 4 };
    function applyCamera() {
      const { distance, pitch, target, yaw } = rig;
      camera.position.set(
        target.x + distance * Math.cos(pitch) * Math.cos(yaw),
        target.y + distance * Math.sin(pitch),
        target.z + distance * Math.cos(pitch) * Math.sin(yaw),
      );
      camera.lookAt(target);
    }

    function framePlate(animate: "top" | "iso" | "free") {
      const s = P().getState();
      const cx = s.base.lengthCm / 2;
      const cz = s.base.widthCm / 2;
      rig.target.set(cx, 0, cz);
      const span = Math.max(s.base.lengthCm, s.base.widthCm);
      if (animate === "top") {
        rig.yaw = -Math.PI / 2;
        rig.pitch = Math.PI / 2 - 0.02;
        rig.distance = span * 1.35;
      } else if (animate === "iso") {
        rig.yaw = -Math.PI / 4;
        rig.pitch = 0.615;
        rig.distance = span * 1.7;
      } else {
        rig.yaw = -Math.PI / 4;
        rig.pitch = 0.7;
        rig.distance = span * 1.25;
      }
      applyCamera();
    }

    const world = new THREE.Group();
    scene.add(world);
    const lastPlate = { l: 0, w: 0 };

    let terrainMesh: THREE.Mesh | null = null;
    let brushRing: THREE.Mesh | null = null;
    const overlayGroup = new THREE.Group();
    world.add(overlayGroup);

    function plateCenter(): { cx: number; cz: number } {
      const s = P().getState();
      return { cx: s.base.lengthCm / 2, cz: s.base.widthCm / 2 };
    }

    function buildTerrain() {
      const s = P().getState();
      if (terrainMesh) {
        world.remove(terrainMesh);
        terrainMesh.geometry.dispose();
        (terrainMesh.material as THREE.Material).dispose();
      }
      // Remove old grid/plate helpers
      for (let i = world.children.length - 1; i >= 0; i--) {
        const c = world.children[i];
        if (c.userData.helper) {
          world.remove(c);
        }
      }
      const { cx, cz } = plateCenter();
      if (lastPlate.l !== s.base.lengthCm || lastPlate.w !== s.base.widthCm) {
        lastPlate.l = s.base.lengthCm;
        lastPlate.w = s.base.widthCm;
        rig.target.set(cx, 0, cz);
        applyCamera();
      }
      const geo = new THREE.PlaneGeometry(s.base.lengthCm, s.base.widthCm, s.nx, s.nz);
      geo.rotateX(-Math.PI / 2);
      geo.translate(cx, 0, cz);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, vertexColors: true });
      terrainMesh = new THREE.Mesh(geo, mat);
      terrainMesh.userData.isTerrain = true;
      world.add(terrainMesh);

      // Base plate slab
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(s.base.lengthCm + 2, 1.2, s.base.widthCm + 2),
        new THREE.MeshStandardMaterial({ color: 0x4a3b28, roughness: 0.9 }),
      );
      slab.position.set(cx, -0.7, cz);
      slab.userData.helper = true;
      world.add(slab);

      // Grids: 1cm faint + 5cm strong, slightly above zero (terrain may cover partially)
      const gridLines = (step: number, color: number, opacity: number, y: number) => {
        const pts: number[] = [];
        for (let x = 0; x <= s.base.lengthCm + 1e-6; x += step) {
          pts.push(x, y, 0, x, y, s.base.widthCm);
        }
        for (let z = 0; z <= s.base.widthCm + 1e-6; z += step) {
          pts.push(0, y, z, s.base.lengthCm, y, z);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
        const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
        const lines = new THREE.LineSegments(g, m);
        lines.userData.helper = true;
        world.add(lines);
      };
      gridLines(1, 0x9fb4d8, 0.16, 0.05);
      gridLines(5, 0xd7e3f5, 0.4, 0.06);

      // Brush ring
      if (brushRing) {
        scene.remove(brushRing);
      }
      brushRing = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x4da3ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }),
      );
      brushRing.visible = false;
      brushRing.renderOrder = 999;
      scene.add(brushRing);

      refreshTerrainColors();
    }

    const cLow = new THREE.Color(0x5da24f);
    const cMid = new THREE.Color(0x9a8a55);
    const cHigh = new THREE.Color(0x8a6a4a);
    const cRed = new THREE.Color(0xd92d20);
    const tmpC = new THREE.Color();

    function refreshTerrainColors() {
      if (!terrainMesh) return;
      const s = P().getState();
      const pos = terrainMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      let colors = terrainMesh.geometry.getAttribute("color") as THREE.BufferAttribute;
      if (!colors || colors.count !== pos.count) {
        colors = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
        terrainMesh.geometry.setAttribute("color", colors);
      }
      let maxH = 0.001;
      for (const h of s.terrain) if (h > maxH) maxH = h;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const h = sampleHeight(s, x, z);
        pos.setY(i, h);
        const t = Math.min(1, h / Math.max(4, maxH));
        if (t < 0.5) tmpC.copy(cLow).lerp(cMid, t * 2);
        else tmpC.copy(cMid).lerp(cHigh, (t - 0.5) * 2);
        const slope = slopeAt(s, x, z);
        if (slope > s.maxGradePct) tmpC.lerp(cRed, Math.min(1, 0.45 + (slope - s.maxGradePct) / 60));
        colors.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
      }
      pos.needsUpdate = true;
      colors.needsUpdate = true;
      terrainMesh.geometry.computeVertexNormals();
    }

    function clearOverlays() {
      for (let i = overlayGroup.children.length - 1; i >= 0; i--) {
        const c = overlayGroup.children[i];
        overlayGroup.remove(c);
        c.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
      }
    }

    function ribbon(pts: { x: number; y: number; z: number }[], width: number, color: THREE.Color | number, opacity: number): THREE.Mesh {
      const verts: number[] = [];
      const idxs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const nx = -dz;
        const nz = dx;
        const hw = width / 2;
        verts.push(pts[i].x + nx * hw, pts[i].y, pts[i].z + nz * hw, pts[i].x - nx * hw, pts[i].y, pts[i].z - nz * hw);
        if (i > 0) {
          const k = i * 2;
          idxs.push(k - 2, k - 1, k, k - 1, k + 1, k);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      g.setIndex(idxs);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: opacity < 1, opacity, side: THREE.DoubleSide }));
      return m;
    }

    function refreshOverlays() {
      clearOverlays();
      const s = P().getState();
      const L = P().layers;

      if (L.roads) {
        const drawRoad = (r: Road, dimmed: boolean) => {
          if (r.points.length === 0) return;
          const sampled = sampleRoadPoints(r.points.length === 1 ? [r.points[0], r.points[0]] : r.points, 10);
          const lifted = sampled.map((p) => ({ ...p, y: sampleHeight(s, p.x, p.z) + 0.28 }));
          // Base ribbon split per segment for grade coloring
          for (let i = 1; i < lifted.length; i++) {
            const a = lifted[i - 1];
            const b = lifted[i];
            const run = Math.hypot(b.x - a.x, b.z - a.z);
            const rise = Math.abs(sampleHeight(s, b.x, b.z) - sampleHeight(s, a.x, a.z));
            const grade = run > 1e-6 ? (rise / run) * 100 : 0;
            const steep = grade > s.maxGradePct;
            const seg = ribbon([a, b], r.widthCm, steep ? 0xd92d20 : 0x3a3f45, dimmed ? 0.35 : 1);
            overlayGroup.add(seg);
          }
          // center dashes
          const dash = ribbon(lifted, 0.3, 0xf5f5f5, dimmed ? 0.3 : 0.95);
          dash.position.y += 0.05;
          overlayGroup.add(dash);
          // control points
          for (const p of r.points) {
            const mk = new THREE.Mesh(
              new THREE.SphereGeometry(0.7, 12, 12),
              new THREE.MeshBasicMaterial({ color: r.id === P().selectedRoadId ? 0x4da3ff : 0xffffff }),
            );
            mk.position.set(p.x, sampleHeight(s, p.x, p.z) + 0.6, p.z);
            overlayGroup.add(mk);
          }
        };
        for (const r of s.roads) drawRoad(r, false);
        const d = P().draft;
        if (d.roadPoints.length > 0) {
          drawRoad({ group: "A", id: "draft", name: "draft", points: d.roadPoints.length === 1 ? [d.roadPoints[0], d.roadPoints[0]] : d.roadPoints, widthCm: 4 }, false);
        }
      }

      if (L.zones) {
        const drawPoly = (z: Zone, opacity: number) => {
          if (z.points.length < 3) {
            for (const p of z.points) {
              const mk = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 10), new THREE.MeshBasicMaterial({ color: z.color }));
              mk.position.set(p.x, sampleHeight(s, p.x, p.z) + 0.5, p.z);
              overlayGroup.add(mk);
            }
            return;
          }
          const shape = new THREE.Shape(z.points.map((p) => new THREE.Vector2(p.x, p.z)));
          const g = new THREE.ShapeGeometry(shape);
          const pos = g.getAttribute("position") as THREE.BufferAttribute;
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const zz = pos.getY(i);
            pos.setXYZ(i, x, sampleHeight(s, x, zz) + 0.22, zz);
          }
          g.computeVertexNormals();
          const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(z.color), transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
          // rotate: geometry currently in XY plane at various Y heights; rotate to XZ
          mesh.rotation.x = 0;
          overlayGroup.add(mesh);
          // outline
          const linePts = z.points.map((p) => new THREE.Vector3(p.x, sampleHeight(s, p.x, p.z) + 0.35, p.z));
          linePts.push(linePts[0].clone());
          const lg = new THREE.BufferGeometry().setFromPoints(linePts);
          overlayGroup.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(z.color) })));
        };
        for (const z of s.zones) drawPoly(z, 0.3);
        const dz = P().draft;
        if (dz.zonePoints.length > 0) {
          drawPoly({ color: "#4da3ff", group: "A", id: "draft", name: "draft", note: "", points: dz.zonePoints }, 0.35);
        }
      }

      if (L.objects) {
        for (const o of s.objects) {
          const f = footprintOf(o.defId, s.scale);
          if (!f) continue;
          const def = OBJECT_LIBRARY.find((d) => d.id === o.defId);
          const y = sampleHeight(s, o.x, o.z);
          const box = new THREE.Mesh(new THREE.BoxGeometry(f.l, f.h, f.w), new THREE.MeshStandardMaterial({ color: new THREE.Color(def?.color ?? "#ccc"), roughness: 0.8 }));
          box.position.set(o.x, y + f.h / 2 + 0.1, o.z);
          box.rotation.y = (o.rotDeg * Math.PI) / 180;
          overlayGroup.add(box);
        }
        if (P().tool === "object" && P().selectedObjectDefId) {
          // ghost follows last hover — drawn via brushRing instead; skip
        }
      }

      if (L.notes) {
        // Notes shown as small markers at zone first-points
        for (const z of s.zones) {
          if (!z.note || z.points.length === 0) continue;
          const p = z.points[0];
          const mk = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshBasicMaterial({ color: 0xffe45e }));
          mk.position.set(p.x, sampleHeight(s, p.x, p.z) + 1.4, p.z);
          overlayGroup.add(mk);
        }
      }

      // Cross-section line
      const d = P().draft;
      if (d.sectionA) {
        const pts = [new THREE.Vector3(d.sectionA.x, sampleHeight(s, d.sectionA.x, d.sectionA.z) + 0.5, d.sectionA.z)];
        if (d.sectionB) pts.push(new THREE.Vector3(d.sectionB.x, sampleHeight(s, d.sectionB.x, d.sectionB.z) + 0.5, d.sectionB.z));
        else pts.push(pts[0].clone());
        const lg = new THREE.BufferGeometry().setFromPoints(pts);
        overlayGroup.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffe45e })));
        for (const p of pts) {
          const mk = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffe45e }));
          mk.position.copy(p);
          overlayGroup.add(mk);
        }
      }
    }

    function refreshAll() {
      buildTerrain();
      refreshOverlays();
    }

    apiRef.current = {
      refreshAll,
      refreshOverlays,
      refreshTerrain: () => {
        refreshTerrainColors();
        refreshOverlays();
      },
      screenshot: () => renderer.domElement.toDataURL("image/png"),
      setCamera: (p) => framePlate(p),
    };

    // ---- interaction ----
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const dom = renderer.domElement;
    dom.style.touchAction = "none";

    function castTerrain(ev: PointerEvent): { x: number; z: number } | null {
      const r = dom.getBoundingClientRect();
      ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      if (!terrainMesh) return null;
      const hit = ray.intersectObject(terrainMesh, false)[0];
      if (!hit) return null;
      const s = P().getState();
      return {
        x: Math.min(s.base.lengthCm, Math.max(0, hit.point.x)),
        z: Math.min(s.base.widthCm, Math.max(0, hit.point.z)),
      };
    }

    let orbiting = false;
    let panning = false;
    let sculpting = false;
    let lastPX = 0;
    let lastPY = 0;
    let moved = 0;
    let strokeActive = false;

    dom.addEventListener("contextmenu", (e) => e.preventDefault());

    dom.addEventListener("pointerdown", (ev) => {
      dom.setPointerCapture(ev.pointerId);
      lastPX = ev.clientX;
      lastPY = ev.clientY;
      moved = 0;
      const tool = P().tool;
      if (ev.button === 2 || tool === "navigate" || ev.button === 1 || (ev.button === 0 && (ev.ctrlKey || ev.metaKey))) {
        if (ev.shiftKey || ev.button === 1 || (ev.button === 0 && (ev.ctrlKey || ev.metaKey))) panning = true;
        else orbiting = true;
        return;
      }
      if (ev.button !== 0) return;
      if (tool === "raise" || tool === "lower" || tool === "smooth") {
        const hit = castTerrain(ev);
        if (hit) {
          sculpting = true;
          P().onStrokeStart();
          strokeActive = true;
          P().onTerrainPoint(hit.x, hit.z);
        }
      }
    });

    dom.addEventListener("pointermove", (ev) => {
      const dx = ev.clientX - lastPX;
      const dy = ev.clientY - lastPY;
      lastPX = ev.clientX;
      lastPY = ev.clientY;
      moved += Math.abs(dx) + Math.abs(dy);

      if (orbiting) {
        rig.yaw -= dx * 0.006;
        rig.pitch = Math.min(Math.PI / 2 - 0.02, Math.max(0.08, rig.pitch + dy * 0.005));
        applyCamera();
        return;
      }
      if (panning) {
        // Grab-the-world pan: the terrain follows the cursor, camera-relative.
        const s = P().getState();
        const span = Math.max(s.base.lengthCm, s.base.widthCm);
        const k = (rig.distance / 700) * (span / 90);
        const sinY = Math.sin(rig.yaw);
        const cosY = Math.cos(rig.yaw);
        rig.target.x = Math.min(s.base.lengthCm, Math.max(0, rig.target.x + (-sinY * dx - cosY * dy) * k));
        rig.target.z = Math.min(s.base.widthCm, Math.max(0, rig.target.z + (cosY * dx - sinY * dy) * k));
        applyCamera();
        return;
      }
      const hit = castTerrain(ev);
      const tool = P().tool;
      if (brushRing) {
        if (hit && (tool === "raise" || tool === "lower" || tool === "smooth" || tool === "object")) {
          brushRing.visible = true;
          const rr = tool === "object" ? 2 : P().brushSizeCm;
          brushRing.scale.set(rr, 1, rr);
          const s = P().getState();
          brushRing.position.set(hit.x, sampleHeight(s, hit.x, hit.z) + 0.3, hit.z);
        } else brushRing.visible = false;
      }
      if (hit) {
        const s = P().getState();
        P().onHoverSlope(slopeAt(s, hit.x, hit.z));
      } else {
        P().onHoverSlope(null);
      }
      if (sculpting && hit) {
        P().onTerrainPoint(hit.x, hit.z);
      }
    });

    function endPointer(ev: PointerEvent) {
      const wasClick = moved < 6;
      if (sculpting) {
        sculpting = false;
        if (strokeActive) {
          strokeActive = false;
          P().onStrokeEnd();
        }
      }
      orbiting = false;
      panning = false;
      if (wasClick && ev.button === 0) {
        const tool = P().tool;
        if (tool === "road" || tool === "zone" || tool === "object" || tool === "section" || tool === "erase") {
          const hit = castTerrain(ev);
          if (hit) P().onMapClick(hit.x, hit.z);
        }
      }
    }
    dom.addEventListener("pointerup", endPointer);
    dom.addEventListener("pointercancel", () => {
      sculpting = false;
      orbiting = false;
      panning = false;
      if (strokeActive) {
        strokeActive = false;
        P().onStrokeEnd();
      }
    });

    dom.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        rig.distance = Math.min(600, Math.max(12, rig.distance * (ev.deltaY > 0 ? 1.12 : 0.89)));
        applyCamera();
      },
      { passive: false },
    );

    function resize() {
      const w = el.clientWidth || 800;
      const h = el.clientHeight || 600;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    framePlate("iso");
    refreshAll();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (el.contains(dom)) el.removeChild(dom);
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mountRef} style={{ height: "100%", width: "100%" }} />;
});

export default Viewport3D;
