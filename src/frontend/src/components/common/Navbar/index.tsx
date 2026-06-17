import { useState } from "react";
import Image from "@Components/RadixComponents/Image";
import { NavLink, useLocation } from "react-router-dom";
import dtmLogo from "@Assets/images/drone-tasking-manager.svg";
import UserProfile from "../UserProfile";
import { FlexRow } from "../Layouts";
import Icon from "../Icon";
import Drawer from "../Drawer";
import LanguageSwitcher from "../LanguageSwitcher";
import "@hotosm/tool-menu";
import { getRuntimeConfig } from "@/runtimeConfig";
import { useGetUserDetailsQuery } from "@Api/projects";
import { getLocalStorageValue } from "@Utils/getLocalStorageValue";
import { m } from "@/paraglide/messages";

// Import Hanko web component when using SSO
const AUTH_PROVIDER = getRuntimeConfig("VITE_AUTH_PROVIDER", "legacy");
const HANKO_URL = getRuntimeConfig("VITE_HANKO_URL", "https://dev.login.hotosm.org");
const FRONTEND_URL = (import.meta as any).env.VITE_FRONTEND_URL || window.location.origin;

if (AUTH_PROVIDER === "hanko") {
  import("@hotosm/hanko-auth");
}

export default function Navbar() {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathnameOnArray = pathname?.split("/");
  const isApprovalPage =
    pathnameOnArray?.includes("projects") && pathnameOnArray?.includes("approval");

  // Get user role for Hanko auth callback
  const signedInAs = localStorage.getItem("signedInAs") || "PROJECT_CREATOR";

  // For Hanko SSO: fetch user profile to keep localStorage in sync
  // (In legacy auth, UserProfile component handles this)
  const userProfile = getLocalStorageValue("userprofile");
  useGetUserDetailsQuery({
    enabled: AUTH_PROVIDER === "hanko" && !!userProfile?.id,
  });
  // Build return URL for Hanko SSO that goes through /hanko-auth callback
  const hankoReturnUrl = `${FRONTEND_URL}/hanko-auth?role=${signedInAs}`;

  const navLinkClass = ({ isActive, forceActive }: { isActive: boolean; forceActive?: boolean }) => {
    const active = isActive || forceActive;
    return `naxatw-text-sm naxatw-text-grey-800 hover:naxatw-no-underline naxatw-px-2 naxatw-py-1 ${
      active
        ? "naxatw-font-bold naxatw-tracking-[0]"
        : "naxatw-tracking-[0.04em] hover:naxatw-font-bold hover:naxatw-tracking-[0]"
    }`;
  };

  const desktopAuth =
    AUTH_PROVIDER === "hanko" ? (
      <hotosm-auth
        hanko-url={HANKO_URL}
        base-path={HANKO_URL}
        redirect-after-login={hankoReturnUrl}
        redirect-after-logout={FRONTEND_URL}
        button-variant="filled"
        button-color="primary"
      />
    ) : (
      <UserProfile />
    );

  const mobileAuth =
    AUTH_PROVIDER === "hanko" ? (
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
          {/* Left: logo + divider + nav */}
          <FlexRow className="naxatw-items-center naxatw-gap-6">
            <a
              className="naxatw-flex naxatw-cursor-pointer naxatw-items-center naxatw-gap-2 hover:naxatw-no-underline"
              role="presentation"
              aria-label={m.nav_home_aria_label()}
              href="/"
            >
              <Image
                src={dtmLogo}
                alt="Drone Tasking Manager logo"
                className="naxatw-h-8 naxatw-w-8"
              />
              <span className="naxatw-text-hot-gray-950 naxatw-text-[20px] naxatw-font-bold naxatw-leading-tight">
                Drone Tasking Manager
              </span>
            </a>
            {!isApprovalPage && (
              <FlexRow className="naxatw-hidden naxatw-items-center naxatw-gap-4 md:naxatw-flex">
                <span
                  className="naxatw-h-5 naxatw-w-px naxatw-bg-grey-300"
                  aria-hidden="true"
                />
                <NavLink
                  to="/projects"
                  className={({ isActive }) =>
                    navLinkClass({
                      isActive,
                      forceActive: pathname.includes("project"),
                    })
                  }
                >
                  {m.nav_projects()}
                </NavLink>
                <NavLink to="/dashboard" className={({ isActive }) => navLinkClass({ isActive })}>
                  {m.nav_dashboard()}
                </NavLink>
              </FlexRow>
            )}
          </FlexRow>

          {!isApprovalPage && (
            <>
              {/* Right: auth + lang + tool-menu */}
              <FlexRow className="naxatw-hidden naxatw-items-center md:naxatw-flex" gap={2}>
                {desktopAuth}
                <LanguageSwitcher />
                <hotosm-tool-menu></hotosm-tool-menu>
              </FlexRow>

              {/* Mobile hamburger */}
              <span className="naxatw-flex naxatw-items-center naxatw-gap-2 md:naxatw-hidden">
                <LanguageSwitcher />
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  aria-label={m.nav_open_menu_aria_label()}
                >
                  <Icon name="menu" />
                </button>
              </span>
            </>
          )}
        </FlexRow>
      </nav>

      {/* Mobile drawer */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-4 naxatw-p-4">
          <div className="naxatw-flex naxatw-items-center naxatw-justify-between">
            <a href="/" aria-label={m.nav_home_aria_label()}>
              <Image
                src={dtmLogo}
                alt="Drone Tasking Manager logo"
                className="naxatw-h-8 naxatw-w-8"
              />
            </a>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label={m.nav_close_menu_aria_label()}
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
                  isActive || pathname.includes("project")
                    ? "naxatw-bg-red/10 naxatw-text-red"
                    : "hover:naxatw-bg-grey-100"
                }`
              }
            >
              {m.nav_projects()}
            </NavLink>
            <NavLink
              to="/dashboard"
              onClick={() => setDrawerOpen(false)}
              className={({ isActive }) =>
                `naxatw-rounded naxatw-px-3 naxatw-py-2 naxatw-text-body-btn ${
                  isActive ? "naxatw-bg-red/10 naxatw-text-red" : "hover:naxatw-bg-grey-100"
                }`
              }
            >
              {m.nav_dashboard()}
            </NavLink>
          </div>
          <div className="naxatw-border-t naxatw-border-grey-300 naxatw-pt-4">
            <FlexRow className="naxatw-items-center naxatw-justify-between">{mobileAuth}</FlexRow>
          </div>
        </div>
      </Drawer>
    </>
  );
}
