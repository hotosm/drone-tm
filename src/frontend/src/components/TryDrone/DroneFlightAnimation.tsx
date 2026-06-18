import { useEffect, useState } from "react";
import { Map } from "maplibre-gl";
import { FeatureCollection, Feature, Point } from "geojson";

interface Props {
  map: Map;
  waypoints: FeatureCollection; // waylines plan: ordered turn vertices (drone path)
  geometry: GeoJSON.Polygon; // selected task square — satellite is revealed inside it
}

const SAT_SOURCE = "drone-anim-sat";
const SAT_LAYER = "drone-anim-sat-raster";
const FRAME_SOURCE = "drone-anim-frame";
const FRAME_LAYER = "drone-anim-frame-raster";
const DRONE_SOURCE = "drone-anim-pos";
const DRONE_LAYER = "drone-anim-pos-icon";
const DRONE_ICON = "drone-anim-icon";
const PLAN_LINE_LAYER = "waypoint-line-layer"; // FlightPlanLayers' dashed line — keep above satellite
const FLIGHT_DURATION_MS = 22000;
const FRAME_FADE_MS = 700;
const FRAME_PAD = 0.16; // frame canvas padding (fraction of the square) for shadow/glow
const TILE_Z = 19;
const TILE_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const mPerDegLat = 111320;
const mLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

const lng2tx = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2ty = (lat: number, z: number) =>
  Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
const tx2lng = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const ty2lat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

function distM(a: [number, number], b: [number, number]): number {
  const midLat = (a[1] + b[1]) / 2;
  return Math.hypot((b[0] - a[0]) * mLng(midLat), (b[1] - a[1]) * mPerDegLat);
}

function lerp(a: [number, number], b: [number, number], f: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

function dronePoint(pos: [number, number]): Feature<Point> {
  return { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: pos } };
}

function ensureDroneIcon(map: Map) {
  if (map.hasImage(DRONE_ICON)) return;
  const s = 64;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#d73f3f";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(20, 20);
  ctx.lineTo(44, 44);
  ctx.moveTo(44, 20);
  ctx.lineTo(20, 44);
  ctx.stroke();
  const rotor = (x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#d73f3f";
    ctx.stroke();
  };
  rotor(16, 16);
  rotor(48, 16);
  rotor(16, 48);
  rotor(48, 48);
  ctx.fillStyle = "#d73f3f";
  ctx.fillRect(26, 26, 12, 12);
  map.addImage(DRONE_ICON, ctx.getImageData(0, 0, s, s));
}

/**
 * Simulated flight: a drone follows the plan path and "uncovers" satellite
 * imagery of the task square as it sweeps (street basemap stays where it hasn't
 * flown). Flight lines stay on top. When the image is complete it gets a neon
 * border + drop shadow and the map eases out slightly, so the photo "lifts" off
 * the map. Satellite is composited from World Imagery tiles onto a canvas source
 * (MapLibre v4 has no per-polygon raster clip).
 */
export default function DroneFlightAnimation({ map, waypoints, geometry }: Props) {
  const [runId, setRunId] = useState(0);
  const [done, setDone] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return undefined;
    const feats = waypoints.features.filter((f) => f.geometry?.type === "Point");
    if (feats.length < 2) return undefined;

    const coords = feats.map((f) => (f.geometry as any).coordinates as [number, number]);
    const lastIdx = coords.length - 1;

    const ring = geometry.coordinates[0];
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    ring.forEach(([x, y]) => {
      minLng = Math.min(minLng, x);
      minLat = Math.min(minLat, y);
      maxLng = Math.max(maxLng, x);
      maxLat = Math.max(maxLat, y);
    });
    const dLng = maxLng - minLng;
    const dLat = maxLat - minLat;
    const midLat = (minLat + maxLat) / 2;
    const widthM = dLng * mLng(midLat);
    const squareCorners: [number, number][] = [
      [minLng, maxLat],
      [maxLng, maxLat],
      [maxLng, minLat],
      [minLng, minLat],
    ];

    const tx0 = lng2tx(minLng, TILE_Z);
    const tx1 = lng2tx(maxLng, TILE_Z);
    const ty0 = lat2ty(maxLat, TILE_Z);
    const ty1 = lat2ty(minLat, TILE_Z);
    const W = Math.min((tx1 - tx0 + 1) * 256, 2048);
    const H = Math.min((ty1 - ty0 + 1) * 256, 2048);

    const toPx = (lng: number, lat: number): [number, number] => [
      ((lng - minLng) / dLng) * W,
      ((maxLat - lat) / dLat) * H,
    ];

    const numCols = Math.max(Math.round(coords.length / 2), 1);
    const brushPx = Math.max(((widthM / numCols) * 1.15 * W) / widthM, 12);

    const cum = [0];
    for (let i = 0; i < lastIdx; i += 1) cum.push(cum[i] + distM(coords[i], coords[i + 1]));
    const totalLen = cum[lastIdx] || 1;
    const hasReturnLeg = distM(coords[lastIdx], coords[0]) < 30;

    const at = (d: number): { pos: [number, number]; seg: number } => {
      let s = 0;
      while (s < lastIdx - 1 && cum[s + 1] < d) s += 1;
      const segLen = cum[s + 1] - cum[s] || 1;
      const f = clamp((d - cum[s]) / segLen, 0, 1);
      return { pos: lerp(coords[s], coords[s + 1], f), seg: s };
    };
    const skip = (seg: number) => seg === 0 || (hasReturnLeg && seg === lastIdx - 1);

    const satCanvas = document.createElement("canvas");
    satCanvas.width = W;
    satCanvas.height = H;
    const reveal = document.createElement("canvas");
    reveal.width = W;
    reveal.height = H;
    const sctx = satCanvas.getContext("2d");
    const rctx = reveal.getContext("2d");

    let cancelled = false;
    let raf = 0;
    let finalRaf = 0;

    const cleanup = () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(finalRaf);
      if (map.getStyle()) {
        [DRONE_LAYER, FRAME_LAYER, SAT_LAYER].forEach((l) => {
          if (map.getLayer(l)) map.removeLayer(l);
        });
        [DRONE_SOURCE, FRAME_SOURCE, SAT_SOURCE].forEach((s) => {
          if (map.getSource(s)) map.removeSource(s);
        });
      }
    };

    setDone(false);

    // neon border + drop shadow on a larger canvas, fade it in, ease the map out
    const runFinalEffect = () => {
      const padX = W * FRAME_PAD;
      const padY = H * FRAME_PAD;
      const FW = Math.round(W + padX * 2);
      const FH = Math.round(H + padY * 2);
      const fc = document.createElement("canvas");
      fc.width = FW;
      fc.height = FH;
      const fctx = fc.getContext("2d");
      const big = Math.max(W, H);
      if (fctx) {
        // drop shadow (cleared in the interior → only the part beyond the edge stays)
        fctx.save();
        fctx.shadowColor = "rgba(0,0,0,0.45)";
        fctx.shadowBlur = big * 0.035;
        fctx.shadowOffsetX = big * 0.012;
        fctx.shadowOffsetY = big * 0.022;
        fctx.fillStyle = "#000";
        fctx.fillRect(padX, padY, W, H);
        fctx.restore();
        fctx.clearRect(padX, padY, W, H);
        // subtle brand-red border + soft glow
        fctx.save();
        fctx.strokeStyle = "rgba(215,63,63,0.6)";
        fctx.lineWidth = big * 0.0035;
        fctx.shadowColor = "rgba(215,63,63,0.5)";
        fctx.shadowBlur = big * 0.014;
        fctx.strokeRect(padX, padY, W, H);
        fctx.restore();
      }

      const eLng = dLng * FRAME_PAD;
      const eLat = dLat * FRAME_PAD;
      map.addSource(FRAME_SOURCE, {
        type: "canvas",
        canvas: fc,
        coordinates: [
          [minLng - eLng, maxLat + eLat],
          [maxLng + eLng, maxLat + eLat],
          [maxLng + eLng, minLat - eLat],
          [minLng - eLng, minLat - eLat],
        ],
        animate: false,
      });
      map.addLayer({
        id: FRAME_LAYER,
        type: "raster",
        source: FRAME_SOURCE,
        paint: { "raster-opacity": 0, "raster-fade-duration": 0 },
      });

      map.easeTo({ zoom: map.getZoom() - 0.25, duration: 900, essential: true });

      let f0 = 0;
      const fade = (ts: number) => {
        if (cancelled) return;
        if (!f0) f0 = ts;
        const k = Math.min((ts - f0) / FRAME_FADE_MS, 1);
        if (map.getLayer(FRAME_LAYER)) map.setPaintProperty(FRAME_LAYER, "raster-opacity", k);
        if (k < 1) finalRaf = requestAnimationFrame(fade);
      };
      finalRaf = requestAnimationFrame(fade);
    };

    const startAnimation = () => {
      if (cancelled || !rctx || !sctx) return;

      [DRONE_LAYER, FRAME_LAYER, SAT_LAYER].forEach((l) => {
        if (map.getLayer(l)) map.removeLayer(l);
      });
      [DRONE_SOURCE, FRAME_SOURCE, SAT_SOURCE].forEach((s) => {
        if (map.getSource(s)) map.removeSource(s);
      });

      // satellite reveal — inserted BELOW the flight lines so they stay visible
      map.addSource(SAT_SOURCE, { type: "canvas", canvas: reveal, coordinates: squareCorners, animate: true });
      const beforeLines = map.getLayer(PLAN_LINE_LAYER) ? PLAN_LINE_LAYER : undefined;
      map.addLayer(
        {
          id: SAT_LAYER,
          type: "raster",
          source: SAT_SOURCE,
          paint: { "raster-opacity": 1, "raster-fade-duration": 0 },
        },
        beforeLines,
      );

      ensureDroneIcon(map);
      map.addSource(DRONE_SOURCE, { type: "geojson", data: dronePoint(coords[0]) });
      map.addLayer({
        id: DRONE_LAYER,
        type: "symbol",
        source: DRONE_SOURCE,
        layout: {
          "icon-image": DRONE_ICON,
          "icon-size": 0.6,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });

      let startTs = 0;
      let lastPx: [number, number] | null = null;
      let lastSeg = -1;

      const paint = (px: number, py: number) => {
        const half = brushPx / 2;
        const x0 = clamp(px - half, 0, W);
        const y0 = clamp(py - half, 0, H);
        const w = clamp(px + half, 0, W) - x0;
        const h = clamp(py + half, 0, H) - y0;
        if (w > 0 && h > 0) rctx.drawImage(satCanvas, x0, y0, w, h, x0, y0, w, h);
      };

      const step = (ts: number) => {
        if (cancelled) return;
        if (!startTs) startTs = ts;
        const t = Math.min((ts - startTs) / FLIGHT_DURATION_MS, 1);
        const { pos, seg } = at(t * totalLen);
        (map.getSource(DRONE_SOURCE) as any)?.setData(dronePoint(pos));

        if (!skip(seg)) {
          const [px, py] = toPx(pos[0], pos[1]);
          if (lastPx && lastSeg === seg) {
            const steps = Math.ceil(Math.hypot(px - lastPx[0], py - lastPx[1]) / (brushPx / 3)) || 1;
            for (let k = 1; k <= steps; k += 1) {
              paint(lastPx[0] + ((px - lastPx[0]) * k) / steps, lastPx[1] + ((py - lastPx[1]) * k) / steps);
            }
          } else {
            paint(px, py);
          }
          lastPx = [px, py];
          lastSeg = seg;
        } else {
          lastPx = null;
        }

        if (t >= 1) {
          setDone(true);
          runFinalEffect();
          return;
        }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };

    const tiles: [number, number][] = [];
    for (let x = tx0; x <= tx1; x += 1) for (let y = ty0; y <= ty1; y += 1) tiles.push([x, y]);
    let pending = tiles.length;
    const onTileDone = () => {
      pending -= 1;
      if (pending === 0) startAnimation();
    };
    tiles.forEach(([x, y]) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => {
        if (cancelled || !sctx) return;
        const dx = ((tx2lng(x, TILE_Z) - minLng) / dLng) * W;
        const dw = ((tx2lng(x + 1, TILE_Z) - tx2lng(x, TILE_Z)) / dLng) * W;
        const dy = ((maxLat - ty2lat(y, TILE_Z)) / dLat) * H;
        const dh = ((ty2lat(y, TILE_Z) - ty2lat(y + 1, TILE_Z)) / dLat) * H;
        sctx.drawImage(im, dx, dy, dw, dh);
        onTileDone();
      };
      im.onerror = onTileDone;
      im.src = TILE_URL(TILE_Z, x, y);
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [map, waypoints, geometry, runId, playing]);

  const onClick = () => {
    if (done) {
      setDone(false);
      setRunId((r) => r + 1);
    } else if (!playing) {
      setPlaying(true);
    }
  };

  return (
    <button
      type="button"
      className="naxatw-absolute naxatw-left-1/2 naxatw-top-4 naxatw-z-20 naxatw--translate-x-1/2 naxatw-rounded-full naxatw-bg-white naxatw-px-5 naxatw-py-2 naxatw-text-sm naxatw-font-semibold naxatw-text-landing-red naxatw-shadow-lg md:naxatw-bottom-6 md:naxatw-top-auto"
      onClick={onClick}
    >
      {/* eslint-disable-next-line no-nested-ternary */}
      {done ? "↻ Replay flight" : playing ? "● Simulating flight…" : "▶ Simulate flight"}
    </button>
  );
}
