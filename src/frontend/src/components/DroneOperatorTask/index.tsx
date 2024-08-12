import DroneOperatorTaskHeader from './Header';
import DroneOperatorDescriptionBox from './DescriptionSection';
import DroneOperatorMapBox from './MapSection';

const DroneOperatorTaskComponent = () => {
  return (
    <>
      <div className="naxatw-mx-auto naxatw-w-11/12 naxatw-max-w-[90rem] naxatw-px-8 naxatw-pb-[2.9375rem] naxatw-pt-3">
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
          <DroneOperatorTaskHeader />
          <div className="naxatw-grid naxatw-grid-cols-[30%_70%] naxatw-gap-5">
            <DroneOperatorDescriptionBox />
            <DroneOperatorMapBox />
          </div>
        </div>
      </div>
    </>
  );
};

export default DroneOperatorTaskComponent;
