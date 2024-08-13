import DroneOperatorDescriptionBox from '@Components/DroneOperatorTask/DescriptionSection';
import DroneOperatorTaskHeader from '@Components/DroneOperatorTask/Header';
import MapSection from '@Components/DroneOperatorTask/MapSection';

const TaskDescription = () => {
  return (
    <>
      <div className="naxatw-min-h-[calc(100vh-60px)]">
        <div className="naxatw-mx-auto naxatw-w-11/12 naxatw-max-w-[90rem] naxatw-px-8 naxatw-pb-[2.9375rem] naxatw-pt-3">
          <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
            <DroneOperatorTaskHeader />
            <div className="naxatw-grid naxatw-grid-cols-[30%_70%] naxatw-gap-5">
              <DroneOperatorDescriptionBox />
              <MapSection />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default TaskDescription;
