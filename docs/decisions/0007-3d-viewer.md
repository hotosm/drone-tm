# In-browser 3D viewer for ODM mesh output

## Context and Problem Statement

ODM produces a textured 3D surface mesh for each mapped site. We want users to
view it directly from a project, tag / label surfaces on it (damage
assessment, feature classification), and eventually view Gaussian-splat
reconstructions alongside the mesh.

The output is a single self-contained GLB (Draco-compressed geometry, one JPEG
per texture-atlas tile). The geometry is light; the textures dominate memory
and grow with the mapped area. So the viewer has to cover a range: from a small
field that fits in one file, up to large sites that must be streamed.

Requirements:

- Runs in the browser, ideally a static/CDN-hosted app opened with a presigned
  URL, no install.
- Works on low-spec devices (tablets, low-end laptops) for a reasonable area.
- Supports custom overlays for surface tagging, and a path to Gaussian splats.
- Copes with whatever ODM emits, since we do not tune the export (for now).

## Considered Options

### Rendering approach (all browser-based, no install)

No-install is a hard requirement, so every candidate runs in the browser. They
differ in _how_:

1. **three.js (WebGL library).** Lightweight JS that loads like any web asset;
   native glTF/GLB/Draco; direct control over rendering, streaming, and
   DOM/UI integration.
2. **Game engine compiled to WebGL (Unity / Godot).** Rich editor and rendering
   features, but ships a multi-MB WASM runtime before any data, needs a glTF
   import step, uses a single constrained memory heap that is historically
   flaky on mobile Safari, and lives outside the web app's build and UI.
3. **Cloud / pixel streaming (e.g. Unreal Pixel Streaming).** A server GPU
   renders and streams video to the browser, so client hardware is irrelevant
   and fidelity is unbounded, but it needs a live GPU server per concurrent
   session (cost scales with viewers) and depends on low-latency bandwidth.

### Data format + memory strategy

1. **Raw single GLB, full decode.** Simplest, but decodes every texture up
   front - unusable beyond small areas on modest hardware.
2. **Single GLB, streamed.** Strip textures before parsing (geometry only),
   keep a small always-resident base layer, then decode/upload only the tiles
   near the camera and evict the rest. Memory stays bounded; one file, no
   preprocessing.
3. **Split low/high GLB.** Ship a small "low" file for instant first paint plus
   the full "high" file for streaming. Better UX on slow links, but adds a
   downres step, doubles storage, and sends more total bytes.
4. **3D Tiles (Obj2Tiles).** Proper spatial LOD with per-tile streaming - the
   scalable answer for large sites. Needs a conversion pipeline (we already run
   the open-source Obj2Tiles tool) and a tiles-aware viewer.

## Decision Outcome

Chosen: **a browser viewer built on three.js, consuming ODM's GLB, with a
streamed single-file loader plus a separate 3D Tiles path for large areas.**

### Why three.js over the other browser options

|                                        | three.js          | Unity / Godot WebGL         | Cloud pixel streaming    |
| -------------------------------------- | ----------------- | --------------------------- | ------------------------ |
| Startup payload                        | tiny (JS)         | multi-MB WASM engine first  | thin client, live server |
| ODM GLB support                        | native glTF/Draco | needs import (e.g. glTFast) | server-side              |
| Mobile / tablet                        | reliable          | flaky (heap limits)         | works, needs bandwidth   |
| Memory control (our texture streaming) | full              | constrained single heap     | n/a (server-side)        |
| Infra cost                             | static hosting    | static hosting              | GPU server per session   |
| Web app + tagging UI                   | native DOM        | awkward bridge              | decoupled                |
| GPU ceiling                            | client browser    | client browser              | server (unbounded)       |

Among the client-side options, three.js beats a WASM game engine on startup
weight, native ODM-format support, mobile reliability, and the fine memory
control our texture streaming depends on - the engine's richer features do not
pay for themselves here. Pixel streaming is the only way past the client GPU
ceiling, but it trades static hosting for a GPU server per concurrent viewer;
worth revisiting only if we ever need very high fidelity for a large audience.
GLB is also ODM's direct `--gltf` output, so three.js needs no conversion for
the common case, and gives us the shader control that surface tagging and
future splats need in one engine.

### Rollout

1. **Today - single GLB, streamed.** The "View 3D" button opens the `--gltf`
   GLB with the streamed loader: bounded memory, works on low-spec devices, no
   extra pipeline. Covers small and medium sites; the practical ceiling is
   download size, not memory.
2. **Large areas - 3D Tiles via Obj2Tiles.** We already convert the mesh to 3D
   Tiles with the open-source Obj2Tiles tool for sites too big to download whole.
3. **Optional next - split low/high GLB.** If slow field connections become a
   real pain point, add a small low-res file for faster first paint and a usable
   view before the full download finishes. Layered on the same loader, not a
   rewrite.

### Split file vs. client-side downres

Both give the same result - geometry plus smaller base textures - the question
is where the downscale happens. Client-side needs no pipeline and sends fewer
bytes; a server-side split file adds a build step and storage but buys faster
first paint and a usable fallback if a download is interrupted. Because our
geometry is small, a split file buys only that UX, not less memory, so we start
client-side and treat the split as a later, connection-driven enhancement.

### Consequences

- Good: nothing to install, one engine for viewing + tagging + future splats,
  no conversion for the common case, and a clear scaling ladder (single GLB to
  3D Tiles).
- Trade-off: the single-GLB path downloads the whole file before high-res
  detail streams in; very large sites rely on the 3D Tiles path.
- We accept the client GPU ceiling in exchange for static hosting and no
  per-viewer server cost; pixel streaming remains the escape hatch if fidelity
  ever has to exceed what the client can render.
