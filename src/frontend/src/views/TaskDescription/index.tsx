import DroneOperatorDescriptionBox from '@Components/DroneOperatorTask/DescriptionSection';
import DroneOperatorTaskHeader from '@Components/DroneOperatorTask/Header';
import MapSection from '@Components/DroneOperatorTask/MapSection';
import useWindowDimensions from '@Hooks/useWindowDimensions';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

const TaskDescription = () => {
  const { width } = useWindowDimensions();
  return (
    <>
      <div className="main-content">
        <div className="naxatw-mx-auto naxatw-px-3 naxatw-pb-[2.9375rem] lg:naxatw-px-20">
          <div className="naxatw-flex naxatw-flex-col naxatw-gap-3 naxatw-pt-8">
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
