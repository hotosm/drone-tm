import { FlexRow } from '@Components/common/Layouts';
import { Link } from 'react-router-dom';

export default function Navbar() {
  return (
    <header>
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

          <a href="https://hotosm.github.io/drone-tm/ ">
            <p className="naxatw-pr-3 hover:naxatw-underline">Documentations</p>
          </a>
        </FlexRow>
      </FlexRow>
    </header>
  );
}
