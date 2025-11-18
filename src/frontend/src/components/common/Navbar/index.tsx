import Image from '@Components/RadixComponents/Image';
import { NavLink, useLocation } from 'react-router-dom';
import dtmLogo from '@Assets/images/DTM-logo-black.svg';
import UserProfile from '../UserProfile';
import { FlexRow } from '../Layouts';
// import Icon from '../Icon';

// Import Hanko web component when using SSO
const AUTH_PROVIDER = (import.meta as any).env.VITE_AUTH_PROVIDER || 'legacy';
const HANKO_API_URL = (import.meta as any).env.VITE_HANKO_API_URL || 'https://dev.login.hotosm.org';
const PORTAL_SSO_URL = (import.meta as any).env.VITE_PORTAL_SSO_URL || 'https://dev.login.hotosm.org';
const FRONTEND_URL = (import.meta as any).env.VITE_FRONTEND_URL || window.location.origin;

if (AUTH_PROVIDER === 'hanko') {
  // Dynamically import web component
  import('../../../../auth-libs/web-component/dist/hanko-auth.esm.js');
}

export default function Navbar() {
  const { pathname } = useLocation();
  const pathnameOnArray = pathname?.split('/');
  const isApprovalPage =
    pathnameOnArray?.includes('projects') &&
    pathnameOnArray?.includes('approval');

  // Get user role for Hanko auth callback
  const signedInAs = localStorage.getItem('signedInAs') || 'PROJECT_CREATOR';
  // Build return URL for Hanko SSO that goes through /hanko-auth callback
  const hankoReturnUrl = `${FRONTEND_URL}/hanko-auth?role=${signedInAs}`;

  return (
    <nav className="naxatw-h-[3.5rem] naxatw-border-b naxatw-border-grey-300 naxatw-pb-2 naxatw-pt-4">
      <FlexRow className="naxatw-items-center naxatw-justify-between naxatw-px-16">
        <a
          className="naxatw-cursor-pointer"
          role="presentation"
          aria-label="Navigate to home page"
          href="/"
        >
          <Image
            src={dtmLogo}
            alt="Drone Tasking Manager Logo"
            className="naxatw-h-8 naxatw-w-40"
          />
        </a>
        {!isApprovalPage && (
          <>
            <FlexRow className="naxatw-gap-4">
              <NavLink
                to="/projects"
                className={({ isActive }) =>
                  `${
                    isActive || pathname.includes('project')
                      ? 'naxatw-border-b-2 naxatw-border-red'
                      : 'hover:naxatw-border-b-2 hover:naxatw-border-grey-900'
                  } -naxatw-mb-[1.2rem] naxatw-px-3 naxatw-pb-2 naxatw-text-body-btn`
                }
              >
                Projects
              </NavLink>
              <NavLink
                to="/dashboard"
                className={({ isActive }) =>
                  `${
                    isActive
                      ? 'naxatw-border-b-2 naxatw-border-red'
                      : 'hover:naxatw-border-b-2 hover:naxatw-border-grey-900'
                  } -naxatw-mb-[1.2rem] naxatw-px-3 naxatw-pb-2 naxatw-text-body-btn`
                }
              >
                Dashboard
              </NavLink>
            </FlexRow>
            <FlexRow className="naxatw-items-center" gap={2}>
              {/* <Icon name="notifications" /> */}
              {AUTH_PROVIDER === 'hanko' ? (
                <hotosm-auth
                  hanko-url={HANKO_API_URL}
                  base-path={PORTAL_SSO_URL}
                  redirect-after-login={hankoReturnUrl}
                  redirect-after-logout="/"
                />
              ) : (
                <UserProfile />
              )}
            </FlexRow>
          </>
        )}
      </FlexRow>
    </nav>
  );
}
