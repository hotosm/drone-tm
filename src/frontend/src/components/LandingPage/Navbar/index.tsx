import { FlexRow } from "@Components/common/Layouts";
import { Link } from "react-router-dom";
import LanguageSwitcherLanding from "@Components/common/LanguageSwitcherLanding";
import { getRuntimeConfig } from "@/runtimeConfig";
import { m } from "@/paraglide/messages";

// Auth configuration for SSO session verification
const AUTH_PROVIDER = getRuntimeConfig("VITE_AUTH_PROVIDER", "legacy");
const HANKO_URL = getRuntimeConfig("VITE_HANKO_URL", "https://dev.login.hotosm.org");
const FRONTEND_URL = (import.meta as any).env.VITE_FRONTEND_URL || window.location.origin;

// Import Hanko web component for session verification
if (AUTH_PROVIDER === "hanko") {
  import("@hotosm/hanko-auth");
}
import packageInfo from "../../../../package.json";

export default function Navbar() {
  // Return URL for hanko-auth callback
  const hankoReturnUrl = `${FRONTEND_URL}/hanko-auth`;

  return (
    <header>
      {/* Hidden auth component for session verification - redirects to /hanko-auth if user has SSO session */}
      {AUTH_PROVIDER === "hanko" && (
        <div style={{ display: "none" }}>
          <hotosm-auth
            hanko-url={HANKO_URL}
            base-path={HANKO_URL}
            redirect-after-login={hankoReturnUrl}
            redirect-after-logout={FRONTEND_URL}
          />
        </div>
      )}
      <FlexRow
        gap={10}
        className="naxatw-justify-between naxatw-border-landing-white naxatw-bg-landing-red naxatw-px-2 sm:naxatw-px-20 naxatw-py-2 naxatw-text-xs naxatw-text-landing-white"
      >
        <span className="naxatw-opacity-75 naxatw-whitespace-nowrap">v{packageInfo.version}</span>
        <FlexRow
          gap={5}
          className="naxatw-h-fit naxatw-flex-nowrap naxatw-items-center naxatw-text-xs naxatw-leading-none"
        >
          {/* <p className="naxatw-border-r naxatw-pr-3">About</p>
          <p className="naxatw-border-r naxatw-pr-3">FAQs</p> */}
          <Link
            className="naxatw-whitespace-nowrap naxatw-border-r naxatw-pr-3 hover:naxatw-underline"
            to="/tutorials"
          >
            {m.landing_navbar_tutorials()}
          </Link>

          <a href="https://docs.drone.hotosm.org " className="naxatw-whitespace-nowrap">
            <p className="naxatw-border-r naxatw-pr-3 hover:naxatw-underline">
              {m.landing_navbar_documentation()}
            </p>
          </a>

          <a
            href="https://github.com/hotosm/Drone-TM/#drone-support"
            className="naxatw-whitespace-nowrap"
          >
            <p className="naxatw-pr-3 hover:naxatw-underline">
              {m.landing_navbar_supported_drones()}
            </p>
          </a>
          <LanguageSwitcherLanding />
        </FlexRow>
      </FlexRow>
    </header>
  );
}
