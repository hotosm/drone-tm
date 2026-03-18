import { useState } from 'react';
import Image from '@Components/RadixComponents/Image';
import { NavLink, useLocation } from 'react-router-dom';
import dtmLogo from '@Assets/images/DTM-logo-black.svg';
import UserProfile from '../UserProfile';
import { FlexRow } from '../Layouts';
import Icon from '../Icon';
import Drawer from '../Drawer';
import '@hotosm/tool-menu';

// Import Hanko web component when using SSO
const AUTH_PROVIDER = (import.meta as any).env.VITE_AUTH_PROVIDER || 'legacy';
const HANKO_URL =
  (import.meta as any).env.VITE_HANKO_URL || 'https://dev.login.hotosm.org';
const FRONTEND_URL =
  (import.meta as any).env.VITE_FRONTEND_URL || window.location.origin;

if (AUTH_PROVIDER === 'hanko') {
  import('@hotosm/hanko-auth');
}

export default function Navbar() {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathnameOnArray = pathname?.split('/');
  const isApprovalPage =
    pathnameOnArray?.includes('projects') &&
    pathnameOnArray?.includes('approval');

  const hankoReturnUrl = FRONTEND_URL;

  const navLinkClass = ({
    isActive,
    forceActive,
  }: {
    isActive: boolean;
    forceActive?: boolean;
  }) =>
    `${
      isActive || forceActive
        ? 'naxatw-border-b-2 naxatw-border-red'
        : 'hover:naxatw-border-b-2 hover:naxatw-border-grey-900'
    } -naxatw-mb-[1.4rem] naxatw-px-3 naxatw-pb-2 naxatw-text-body-btn`;

  const desktopAuth =
    AUTH_PROVIDER === 'hanko' ? (
      <hotosm-auth
        hanko-url={HANKO_URL}
        base-path={HANKO_URL}
        redirect-after-login={hankoReturnUrl}
        redirect-after-logout={FRONTEND_URL}
        button-variant="filled"
        button-color="danger"
      />
    ) : (
      <UserProfile />
    );

  const mobileAuth =
    AUTH_PROVIDER === 'hanko' ? (
      <hotosm-auth
        hanko-url={HANKO_URL}
        base-path={HANKO_URL}
        redirect-after-login={hankoReturnUrl}
        redirect-after-logout={FRONTEND_URL}
        button-variant="filled"
        button-color="danger"
        display="bar"
      />
    ) : (
      <UserProfile />
    );

  return (
    <>
      <nav className="naxatw-min-h-[3.5rem] naxatw-border-b naxatw-border-grey-300 naxatw-pb-0 naxatw-pt-2">
        <FlexRow className="naxatw-items-center naxatw-justify-between naxatw-px-4 md:naxatw-px-16">
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
              {/* Desktop nav */}
              <FlexRow className="naxatw-hidden naxatw-gap-4 md:naxatw-flex">
                <NavLink
                  to="/projects"
                  className={({ isActive }) =>
                    navLinkClass({
                      isActive,
                      forceActive: pathname.includes('project'),
                    })
                  }
                >
                  Projects
                </NavLink>
                <NavLink
                  to="/dashboard"
                  className={({ isActive }) => navLinkClass({ isActive })}
                >
                  Dashboard
                </NavLink>
              </FlexRow>
              <FlexRow
                className="naxatw-hidden naxatw-items-center md:naxatw-flex"
                gap={2}
              >
                {desktopAuth}
                <hotosm-tool-menu></hotosm-tool-menu>
              </FlexRow>

              {/* Mobile hamburger */}
              <button
                type="button"
                className="naxatw-flex naxatw-align-middle md:naxatw-hidden"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
              >
                <Icon name="menu" />
              </button>
            </>
          )}
        </FlexRow>
      </nav>

      {/* Mobile drawer */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-4 naxatw-p-4">
          <div className="naxatw-flex naxatw-items-center naxatw-justify-between">
            <a href="/" aria-label="Navigate to home page">
              <Image
                src={dtmLogo}
                alt="Drone Tasking Manager Logo"
                className="naxatw-h-8 naxatw-w-40"
              />
            </a>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
            <NavLink
              to="/projects"
              onClick={() => setDrawerOpen(false)}
              className={({ isActive }) =>
                `naxatw-rounded naxatw-px-3 naxatw-py-2 naxatw-text-body-btn ${
                  isActive || pathname.includes('project')
                    ? 'naxatw-bg-red/10 naxatw-text-red'
                    : 'hover:naxatw-bg-grey-100'
                }`
              }
            >
              Projects
            </NavLink>
            <NavLink
              to="/dashboard"
              onClick={() => setDrawerOpen(false)}
              className={({ isActive }) =>
                `naxatw-rounded naxatw-px-3 naxatw-py-2 naxatw-text-body-btn ${
                  isActive
                    ? 'naxatw-bg-red/10 naxatw-text-red'
                    : 'hover:naxatw-bg-grey-100'
                }`
              }
            >
              Dashboard
            </NavLink>
          </div>
          <div className="naxatw-border-t naxatw-border-grey-300 naxatw-pt-4">
            <FlexRow className="naxatw-items-center naxatw-justify-between">
              {mobileAuth}
            </FlexRow>
          </div>
        </div>
      </Drawer>
    </>
  );
}
