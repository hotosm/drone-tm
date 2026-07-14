import { Link } from "react-router-dom";
import { m } from "@/paraglide/messages";

const TalkToUs = () => {
  return (
    <div className="naxatw-flex naxatw-justify-center naxatw-bg-red naxatw-py-24">
      <div className="naxatw-flex naxatw-max-w-[560px] naxatw-flex-col naxatw-gap-5 naxatw-text-white">
        <h2 className="naxatw-text-[60px]">{m.landing_talk_to_us_heading()}</h2>
        <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-justify-center">
          <p className="naxatw-text-xl">{m.landing_talk_to_us_other_queries()}</p>
          <Link
            className="naxatw-text-xl naxatw-font-bold hover:naxatw-underline"
            to="mailto:dronetm@hotosm.org"
          >
            {m.landing_talk_to_us_email()}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default TalkToUs;
