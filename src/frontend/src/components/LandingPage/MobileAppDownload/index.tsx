import mobileView from "@Assets/images/LandingPage/MobileView.webp";
import Icon from "@Components/common/Icon";
import Image from "@Components/RadixComponents/Image";
import { Link } from "react-router-dom";
import { m } from "@/paraglide/messages";

const MobileAppDownload = () => {
  return (
    <div className="naxatw-bg-landing-white">
      <div className="naxatw-container !naxatw-max-w-full naxatw-pb-40">
        <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-justify-center naxatw-gap-10 naxatw-rounded-[40px] naxatw-bg-white naxatw-px-10 naxatw-py-10 sm:naxatw-flex-row lg:naxatw-gap-[120px] xl:naxatw-gap-[300px]">
          <Image
            src={mobileView}
            alt={m.landing_mobile_app_image_alt()}
            className="naxatw-h-[480px] naxatw-w-full naxatw-min-w-52"
          />
          <div className="naxatw-flex naxatw-max-w-[425px] naxatw-flex-col naxatw-gap-10">
            <h1 className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-text-3xl naxatw-font-normal naxatw-text-[#D73F3F] sm:naxatw-items-start md:naxatw-text-[50px] lg:naxatw-max-w-64">
              {m.landing_mobile_app_heading()}
            </h1>
            <p className="naxatw-text-sm md:naxatw-text-base">
              {m.landing_mobile_app_description()}
            </p>
            <div className="naxatw-flex naxatw-justify-center sm:naxatw-justify-start">
              <Link
                className="naxatw-group naxatw-flex naxatw-h-[60px] naxatw-items-center naxatw-justify-center naxatw-gap-4 !naxatw-rounded-full naxatw-bg-black !naxatw-px-8 naxatw-text-white"
                to="https://d2ymfcf63vwwpt.cloudfront.net/publicuploads/DroneTM.apk"
              >
                <span className="naxatw-text-base naxatw-font-medium group-hover:naxatw-underline">
                  {m.landing_mobile_app_download_apk()}
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
