import Image from "@Components/RadixComponents/Image";
import dtmLogo from "@Assets/images/drone-tasking-manager.svg";

// The mark is icon-only, so the wordmark is live text rather than baked into the SVG
const DtmLogo = ({ className = "naxatw-text-hot-gray-950" }: { className?: string }) => (
  <span className="naxatw-flex naxatw-items-center naxatw-gap-2">
    <Image src={dtmLogo} alt="" className="naxatw-h-8 naxatw-w-8" />
    <span className={`naxatw-text-[20px] naxatw-font-bold naxatw-leading-tight ${className}`}>
      Drone Tasking Manager
    </span>
  </span>
);

export default DtmLogo;
