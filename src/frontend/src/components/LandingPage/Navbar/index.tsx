import { FlexRow } from '@Components/common/Layouts';
import { Link } from 'react-router-dom';

// Auth configuration for SSO session verification
const AUTH_PROVIDER = (import.meta as any).env.VITE_AUTH_PROVIDER || 'legacy';
const HANKO_API_URL = (import.meta as any).env.VITE_HANKO_API_URL || 'https://dev.login.hotosm.org';
const PORTAL_SSO_URL = (import.meta as any).env.VITE_PORTAL_SSO_URL || 'https://dev.login.hotosm.org';
const FRONTEND_URL = (import.meta as any).env.VITE_FRONTEND_URL || window.location.origin;

// Import Hanko web component for session verification
if (AUTH_PROVIDER === 'hanko') {
  import('../../../../auth-libs/web-component/dist/hanko-auth.esm.js');
}

export default function Navbar() {
  // Return URL for hanko-auth callback
  const hankoReturnUrl = `${FRONTEND_URL}/hanko-auth`;

  return (
    <header>
      {/* Hidden auth component for session verification - redirects to /hanko-auth if user has SSO session */}
      {AUTH_PROVIDER === 'hanko' && (
        <div style={{ display: 'none' }}>
          <hotosm-auth
            hanko-url={HANKO_API_URL}
            base-path={PORTAL_SSO_URL}
            redirect-after-login={hankoReturnUrl}
            verify-session
          />
        </div>
      )}
      <FlexRow
        gap={10}
        className="naxatw-justify-center naxatw-border-landing-white naxatw-bg-landing-red naxatw-px-20 naxatw-py-2 naxatw-text-xs naxatw-text-landing-white lg:naxatw-justify-end"
      >
        <FlexRow
          gap={5}
          className="naxatw-h-fit naxatw-text-xs naxatw-leading-none"
        >
          {/* <p className="naxatw-border-r naxatw-pr-3">About</p>
          <p className="naxatw-border-r naxatw-pr-3">FAQs</p> */}
          <Link
            className="naxatw-border-r naxatw-pr-3 hover:naxatw-underline"
            to="/tutorials"
          >
            Tutorials
          </Link>

          <a href="https://docs.dronetm.hotosm.org ">
            <p className="naxatw-border-r naxatw-pr-3 hover:naxatw-underline">
              Documentation
            </p>
          </a>

          <a href="https://github.com/hotosm/Drone-TM/#drone-support">
            <p className="naxatw-pr-3 hover:naxatw-underline">
              Supported Drones
            </p>
          </a>
        </FlexRow>
      </FlexRow>
    </header>
  );
}
