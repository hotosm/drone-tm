import { useEffect, useMemo, useState } from "react";
import { Button } from "@Components/RadixComponents/Button";
import { m } from "@/paraglide/messages";

// QField registers the `qfield://` URI scheme (BROWSABLE) in its Android
// manifest, so both the custom scheme and an Android intent:// URL can launch
// the app externally. See opengisch/QField AndroidManifest.xml.
const QFIELD_ANDROID_PKG = "ch.opengis.qfield";
const QFIELD_STORE_URL = "https://qfield.org/get/";

type MobileOS = "android" | "ios" | "other";

/**
 * Read the presigned import URL from the URL fragment (e.g.
 * `/qfield-open#import=https://...`). Using the fragment instead of a query
 * param keeps the download URL out of server access logs and Referer headers.
 */
function readImportUrl(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const url = params.get("import");
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function detectOS(): MobileOS {
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  return "other";
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="naxatw-flex naxatw-min-h-[100dvh] naxatw-items-center naxatw-justify-center naxatw-p-6">
      <p className="naxatw-max-w-sm naxatw-text-center naxatw-text-sm naxatw-text-gray-700">
        {children}
      </p>
    </div>
  );
}

export default function QFieldOpen() {
  const importUrl = useMemo(readImportUrl, []);
  const os = useMemo(detectOS, []);
  const [projectMissing, setProjectMissing] = useState(false);

  // The QField zip lives at a stable, unsigned public S3 path, so the only
  // failure mode is the object being absent (never generated / deleted) -> 404.
  // Detect that so we can show a clear message instead of a silent failure.
  useEffect(() => {
    let cancelled = false;
    if (importUrl) {
      fetch(importUrl, { method: "HEAD" })
        .then((res) => {
          if (!cancelled && !res.ok) setProjectMissing(true);
        })
        .catch(() => {
          // Ignore network hiccups in the field; don't block the deep link.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [importUrl]);

  const openInQField = () => {
    if (!importUrl) return;

    // Percent-encode the import URL: QField parses the deep link with
    // QUrlQuery, which splits on `&`/`#` before decoding, so an unencoded
    // signed/query-string URL would be truncated. Encoding is a no-op for the
    // current unsigned public URL and future-proofs signed ones.
    const encodedImport = encodeURIComponent(importUrl);

    if (os === "android") {
      // Native fallback: opens QField if installed, otherwise the browser
      // redirects to the store via S.browser_fallback_url.
      window.location.href =
        `intent://local?import=${encodedImport}#Intent;scheme=qfield;` +
        `package=${QFIELD_ANDROID_PKG};` +
        `S.browser_fallback_url=${encodeURIComponent(QFIELD_STORE_URL)};end`;
      return;
    }

    // iOS / other: no reliable "is it installed?" check exists, so we just
    // hand off to the scheme. The install link below is always visible.
    window.location.href = `qfield://local?import=${encodedImport}`;
  };

  if (!importUrl) {
    return <CenteredMessage>{m.qfield_open_invalid()}</CenteredMessage>;
  }
  if (projectMissing) {
    return <CenteredMessage>{m.qfield_open_unavailable()}</CenteredMessage>;
  }

  return (
    <div className="naxatw-flex naxatw-min-h-[100dvh] naxatw-items-center naxatw-justify-center naxatw-p-6">
      <div className="naxatw-flex naxatw-w-full naxatw-max-w-sm naxatw-flex-col naxatw-items-center naxatw-gap-5 naxatw-text-center">
        <h1 className="naxatw-text-xl naxatw-font-semibold naxatw-text-gray-800">
          {m.qfield_open_title()}
        </h1>

        <p className="naxatw-rounded-lg naxatw-bg-red-50 naxatw-px-4 naxatw-py-3 naxatw-text-sm naxatw-text-[#D73F3F]">
          {m.qfield_open_requirement()}
        </p>

        <ol className="naxatw-list-decimal naxatw-space-y-2 naxatw-self-stretch naxatw-pl-6 naxatw-text-left naxatw-text-sm naxatw-text-gray-700">
          <li>{m.qfield_open_step_install()}</li>
          <li>{m.qfield_open_step_tap()}</li>
          <li>{m.qfield_open_step_auto()}</li>
        </ol>

        <Button
          size="lg"
          className="naxatw-h-14 naxatw-w-full naxatw-bg-[#D73F3F] naxatw-text-base naxatw-text-white"
          onClick={openInQField}
        >
          {m.qfield_open_button()}
        </Button>

        <p className="naxatw-text-sm naxatw-text-gray-600">
          {m.qfield_open_no_app()}{" "}
          <a
            href={QFIELD_STORE_URL}
            target="_blank"
            rel="noreferrer"
            className="naxatw-font-medium naxatw-text-[#D73F3F] naxatw-underline"
          >
            {m.qfield_open_install_link()}
          </a>
          {" - "}
          {m.qfield_open_rescan()}
        </p>
      </div>
    </div>
  );
}
