import { useEffect, useRef, useState } from "react";
import { Map } from "maplibre-gl";

type Highlight = "map" | "panel";

interface Mark {
  text: string;
  highlight: Highlight;
}

interface Props {
  step: 1 | 2 | 3;
  hasSelection: boolean; // step 2: whether a task is already selected
  onClose: () => void;
  map: Map | null;
  bbox: number[] | null; // [minLng, minLat, maxLng, maxLat] of the current content
}

// Coach marks for the current moment of the flow. `highlight` points the arrow
// at the map area or the side panel.
function getMarks(step: number, hasSelection: boolean): Mark[] {
  if (step === 1)
    return [
      {
        text: "Este es tu área a mapear. Arrastrá el recuadro sobre la zona y cambiá su tamaño con el control de Área.",
        highlight: "map",
      },
      {
        text: "La altitud define a qué altura vuela el dron: más alto cubre más rápido, más bajo da más detalle. Cuando estés listo, tocá Continue.",
        highlight: "panel",
      },
    ];
  if (step === 2)
    return hasSelection
      ? [
          {
            text: "¡Listo! Tocá “Select task” para generar el plan de vuelo de esa tarea.",
            highlight: "panel",
          },
        ]
      : [
          {
            text: "Dividimos tu área en tareas más chicas. Cada una es un vuelo que un dron cubre con una batería. Tocá una en el mapa.",
            highlight: "map",
          },
        ];
  return [
    {
      text: "Este es el recorrido que haría el dron: líneas paralelas con superposición para que las fotos cubran todo.",
      highlight: "map",
    },
    {
      text: "Elegí tu modelo de dron y simulá el vuelo, o descargá el plan (KMZ para tu dron, o GeoJSON para previsualizar).",
      highlight: "panel",
    },
  ];
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function rectOf(sel: string): Rect | null {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export default function TutorialTour({ step, hasSelection, onClose, map, bbox }: Props) {
  const marks = getMarks(step, hasSelection);
  const [idx, setIdx] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [, force] = useState(0);
  const rafRef = useRef(0);

  // reset to the first mark whenever the flow moment changes (step or selection)
  useEffect(() => {
    setIdx(0);
    setHidden(false);
  }, [step, hasSelection]);

  // keep spotlight aligned while the map pans/zooms
  useEffect(() => {
    const tick = () => {
      force((n) => n + 1);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  if (hidden || marks.length === 0) return null;
  const mark = marks[Math.min(idx, marks.length - 1)];

  const mapR = rectOf('[data-tour="map"]');
  const panelR = rectOf('[data-tour="panel"]');

  // arrow pointer (rotate: 0 = points down, -90 = points right)
  const bottomSheet = !!panelR && panelR.width > window.innerWidth * 0.8;
  let pointer: { left: number; top: number; rotate: number } | null = null;
  if (mark.highlight === "map" && map && bbox && mapR) {
    const c = map.project([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]);
    const top = mapR.top + c.y - 48;
    // hide the arrow when the bottom-sheet panel covers the content (mobile)
    if (!bottomSheet || !panelR || top < panelR.top - 20) {
      pointer = { left: mapR.left + c.x, top, rotate: 0 };
    }
  } else if (mark.highlight === "panel" && panelR) {
    // mobile: panel is a full-width bottom sheet → point down at it; desktop:
    // panel is on the left → point left from its right edge.
    pointer = bottomSheet
      ? { left: panelR.left + panelR.width / 2, top: panelR.top - 18, rotate: 0 }
      : { left: panelR.left + panelR.width + 30, top: panelR.top + panelR.height / 2, rotate: 90 };
  }

  // card anchored to the top-center of the map area
  const cardLeft = mapR ? mapR.left + mapR.width / 2 : window.innerWidth / 2;
  const cardTop = mapR ? mapR.top + 16 : 80;

  const isLast = idx >= marks.length - 1;

  return (
    <>
      {pointer && (
        <div
          className="naxatw-pointer-events-none naxatw-fixed naxatw-z-[60]"
          style={{
            left: pointer.left,
            top: pointer.top,
            transform: `translate(-50%, -50%) rotate(${pointer.rotate}deg)`,
          }}
        >
          <div className="naxatw-animate-bounce">
            <svg
              width="46"
              height="46"
              viewBox="0 0 24 24"
              fill="#d73f3f"
              style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.45))" }}
            >
              <path d="M12 21l-7-8h4V3h6v10h4z" />
            </svg>
          </div>
        </div>
      )}

      <div
        className="naxatw-fixed naxatw-z-[61] naxatw-w-[26rem] naxatw-max-w-[92vw] naxatw--translate-x-1/2 naxatw-rounded-xl naxatw-bg-white naxatw-p-6 naxatw-shadow-2xl"
        style={{ left: cardLeft, top: cardTop }}
      >
        <p className="naxatw-text-base naxatw-leading-relaxed naxatw-text-grey-800">{mark.text}</p>

        <div className="naxatw-mt-5 naxatw-flex naxatw-items-center naxatw-justify-between">
          <div className="naxatw-flex naxatw-gap-2">
            {[1, 2, 3].map((s) => (
              <span
                key={s}
                className={`naxatw-h-2 naxatw-w-2 naxatw-rounded-full ${
                  s === step ? "naxatw-bg-landing-red" : "naxatw-bg-grey-300"
                }`}
              />
            ))}
          </div>

          <div className="naxatw-flex naxatw-items-center naxatw-gap-3">
            <button
              type="button"
              className="naxatw-text-sm naxatw-text-grey-500 hover:naxatw-underline"
              onClick={onClose}
            >
              Saltar
            </button>
            {idx > 0 && (
              <button
                type="button"
                className="naxatw-rounded-md naxatw-px-3 naxatw-py-1.5 naxatw-text-sm naxatw-font-medium naxatw-text-landing-red"
                onClick={() => setIdx((i) => i - 1)}
              >
                Atrás
              </button>
            )}
            <button
              type="button"
              className="naxatw-rounded-md naxatw-bg-landing-red naxatw-px-4 naxatw-py-2 naxatw-text-sm naxatw-font-semibold naxatw-text-white"
              onClick={() => (isLast ? setHidden(true) : setIdx((i) => i + 1))}
            >
              {isLast ? "Entendido" : "Siguiente"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
