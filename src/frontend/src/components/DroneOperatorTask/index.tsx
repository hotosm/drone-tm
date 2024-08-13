import DroneOperatorTaskHeader from './Header';
import DroneOperatorDescriptionBox from './DescriptionSection';
import DroneOperatorMapBox from './MapSection';

const DroneOperatorTaskComponent = () => {
  return (
    <>
      <div className="naxatw-mx-auto naxatw-w-11/12 naxatw-max-w-[90rem] naxatw-px-8 naxatw-pb-[2.9375rem] naxatw-pt-3">
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
          <DroneOperatorTaskHeader />
          <div className="naxatw-flex naxatw-flex-col-reverse naxatw-gap-5 md:naxatw-grid md:naxatw-grid-cols-[40%_60%] lg:naxatw-grid-cols-[30%_70%]">
            <DroneOperatorDescriptionBox />
            <DroneOperatorMapBox />
          </div>
        </div>
      </div>
    </>
  );
};

export default DroneOperatorTaskComponent;
