import mobileView from '@Assets/images/LandingPage/MobileView.svg';
import Icon from '@Components/common/Icon';
import Image from '@Components/RadixComponents/Image';
import { Link } from 'react-router-dom';

const MobileAppDownload = () => {
  return (
    <div className="naxatw-bg-landing-white">
      <div className="naxatw-container !naxatw-max-w-full naxatw-pb-40">
        <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-justify-center naxatw-gap-10 naxatw-rounded-[40px] naxatw-bg-white naxatw-px-10 naxatw-py-10 sm:naxatw-flex-row lg:naxatw-gap-[120px]">
          <Image
            src={mobileView}
            alt="DTM-logo"
            className="naxatw-h-[480px] naxatw-w-full naxatw-min-w-52"
          />
          <div className="naxatw-flex naxatw-max-w-[425px] naxatw-flex-col naxatw-gap-10">
            <h1 className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-text-3xl naxatw-font-normal naxatw-text-[#D73F3F] sm:naxatw-items-start md:naxatw-text-[50px] lg:naxatw-max-w-64">
              Download our Mobile App
            </h1>
            <p className="naxatw-text-sm md:naxatw-text-base">
              Drone TM is an integrated open source digital public good solution
              that aims to harness the power of the crowd to help generate
              high-resolution aerial maps to improve resilience of the disaster
              prone communities across the world.
            </p>
            <div className="naxatw-flex naxatw-justify-center sm:naxatw-justify-start">
              <Link
                className="naxatw-group naxatw-flex naxatw-h-[60px] naxatw-items-center naxatw-justify-center naxatw-gap-4 !naxatw-rounded-full naxatw-bg-black !naxatw-px-8 naxatw-text-white"
                to="https://drive.google.com/uc?export=download&id=1T4OkRP0tP8lwt33gWldY5yLraHLBGwS-"
                target="_blank"
              >
                <span className="naxatw-text-base naxatw-font-medium group-hover:naxatw-underline">
                  Download APK
                </span>
                <Icon name="download" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MobileAppDownload;
