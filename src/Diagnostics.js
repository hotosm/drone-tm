// Lightweight crash/error reporting that survives a reload. iOS Safari
// silently reloads tabs under memory pressure (and WebGL can lose its
// context), so in-memory logs are useless post-mortem. We persist a small
// ring buffer to localStorage, detect when the previous session ended
// WITHOUT a clean pagehide (i.e. it was killed/reloaded), and surface the
// last error/context-loss in a dismissible toast on the next load.

const KEY = "dmt:diag";
const MAX = 50;

export class Diagnostics {
  constructor(build) {
    this.build = build;
    this.log = this.read();
    this.reportRecovery(); // inspect the PREVIOUS session before logging this one
    this.install();
  }

  read() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.log.slice(-MAX)));
    } catch (e) {
      /* storage full / private mode — diagnostics are best-effort */
    }
  }

  record(kind, msg) {
    const entry = {
      t: new Date().toISOString(),
      kind,
      msg: String(msg == null ? "" : msg).slice(0, 400),
      build: this.build,
    };
    this.log.push(entry);
    this.save();
    console.warn(`[diag] ${kind}: ${entry.msg}`);
  }

  install() {
    window.addEventListener("error", (e) =>
      this.record("error", `${e.message} @ ${e.filename || "?"}:${e.lineno || 0}`)
    );
    window.addEventListener("unhandledrejection", (e) => {
      const r = e.reason;
      this.record("promise", (r && (r.stack || r.message)) || r);
    });
    // A clean navigation/close fires pagehide; its ABSENCE next load ⇒ the tab
    // was killed (memory) or hard-reloaded.
    window.addEventListener("pagehide", () => {
      this.log.push({ t: new Date().toISOString(), kind: "pagehide", msg: "clean" });
      this.save();
    });
    this.record("load", `app start · build ${this.build}`);
  }

  noteContextLost() {
    this.record("webgl", "context lost (GPU memory pressure likely)");
    this.toast("⚠️ Graphics memory ran out — the view was reset. If this repeats, tag in smaller sessions.");
  }

  reportRecovery() {
    if (!this.log.length) return;
    const last = this.log[this.log.length - 1];
    if (last.kind === "pagehide") return; // previous session exited cleanly
    // previous session ended abruptly — name the likely culprit
    const culprit = [...this.log]
      .reverse()
      .find((e) => e.kind === "error" || e.kind === "webgl" || e.kind === "promise");
    const detail = culprit ? `${culprit.kind}: ${culprit.msg}` : "likely out of memory";
    this.toast(`Recovered from an unexpected reload — ${detail}`);
  }

  toast(msg) {
    // defer until DOM is ready
    const show = () => {
      let el = document.getElementById("diag-toast");
      if (!el) {
        el = document.createElement("div");
        el.id = "diag-toast";
        el.style.cssText =
          "position:fixed;left:50%;transform:translateX(-50%);" +
          "bottom:calc(88px + env(safe-area-inset-bottom));max-width:90vw;z-index:3000;" +
          "background:rgba(25,28,25,0.92);color:#fff;font:13px/1.4 -apple-system,sans-serif;" +
          "padding:10px 14px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.35);" +
          "cursor:pointer;text-align:center;";
        el.addEventListener("click", () => el.remove());
        document.body.appendChild(el);
      }
      el.textContent = msg;
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => el && el.remove(), 9000);
    };
    if (document.body) show();
    else window.addEventListener("DOMContentLoaded", show);
  }

  dump() {
    return this.log;
  }
}
