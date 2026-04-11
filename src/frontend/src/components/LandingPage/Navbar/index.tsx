import { FlexRow } from "@Components/common/Layouts";
import { Link } from "react-router-dom";
import packageInfo from "../../../../package.json";

export default function Navbar() {
  return (
    <header>
      <FlexRow
        gap={10}
        className="naxatw-justify-between naxatw-border-landing-white naxatw-bg-landing-red naxatw-px-2 sm:naxatw-px-20 naxatw-py-2 naxatw-text-xs naxatw-text-landing-white"
      >
        <span className="naxatw-opacity-75 naxatw-whitespace-nowrap">v{packageInfo.version}</span>
        <FlexRow gap={5} className="naxatw-h-fit naxatw-text-xs naxatw-leading-none">
          {/* <p className="naxatw-border-r naxatw-pr-3">About</p>
          <p className="naxatw-border-r naxatw-pr-3">FAQs</p> */}
          <Link className="naxatw-border-r naxatw-pr-3 hover:naxatw-underline" to="/tutorials">
            Tutorials
          </Link>

          <a href="https://docs.drone.hotosm.org ">
            <p className="naxatw-border-r naxatw-pr-3 hover:naxatw-underline">Documentation</p>
          </a>

          <a href="https://github.com/hotosm/Drone-TM/#drone-support">
            <p className="naxatw-pr-3 hover:naxatw-underline">Supported Drones</p>
          </a>
        </FlexRow>
      </FlexRow>
    </header>
  );
}
