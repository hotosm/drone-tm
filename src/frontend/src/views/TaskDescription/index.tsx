import DroneOperatorDescriptionBox from '@Components/DroneOperatorTask/DescriptionSection';
import DroneOperatorTaskHeader from '@Components/DroneOperatorTask/Header';
import MapSection from '@Components/DroneOperatorTask/MapSection';
import useWindowDimensions from '@Hooks/useWindowDimensions';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

const TaskDescription = () => {
  const { width } = useWindowDimensions();
  return (
    <>
      <div className="naxatw-h-screen-nav">
        <div className="naxatw-mx-auto naxatw-w-11/12 naxatw-max-w-[90rem] naxatw-px-0 naxatw-pb-[2.9375rem] naxatw-pt-3 md:naxatw-px-8">
          <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
            <DroneOperatorTaskHeader />
            <div className="naxatw-grid naxatw-grid-cols-1 naxatw-gap-5 sm:naxatw-grid-cols-[30%_70%]">
              <DroneOperatorDescriptionBox />
              {width >= 640 && <MapSection />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default hasErrorBoundary(TaskDescription);
