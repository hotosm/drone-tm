import { Link } from 'react-router-dom';

const TalkToUs = () => {
  return (
    <div className="naxatw-flex naxatw-justify-center naxatw-bg-red naxatw-py-24">
      <div className="naxatw-flex naxatw-max-w-[560px] naxatw-flex-col naxatw-gap-5 naxatw-text-white">
        <h2 className="naxatw-text-[60px]">Talk to Us</h2>
        <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-justify-center">
          <p className="naxatw-text-xl">For other queries mail us at </p>
          <Link
            className="naxatw-text-xl naxatw-font-bold hover:naxatw-underline"
            to="mailto:dronetm@hotosm.org"
          >
            dronetm@hotosm.org
          </Link>
        </div>
      </div>
    </div>
  );
};

export default TalkToUs;
