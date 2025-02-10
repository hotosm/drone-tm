import MapSection from '@Components/IndividualProject/ExportSection/MapSection';
import dtmLogo from '@Assets/images/DTM-logo-black.svg';
import Image from '@Components/RadixComponents/Image';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

interface IExportSectionProps {
  projectData: Record<string, any>;
}

const ExportSection = ({ projectData }: IExportSectionProps) => {
  return (
    <section className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-items-center naxatw-justify-between naxatw-px-3 md:naxatw-px-20">
      <div className="naxatw-w-full">
        <div className="naxatw-flex naxatw-h-1 naxatw-bg-red" />
        <h1 className="naxatw-py-2 naxatw-text-xl naxatw-font-semibold naxatw-leading-8 md:naxatw-py-7">
          {projectData?.name}
        </h1>
        <p className="naxatw-pb-3 naxatw-text-sm">{projectData?.description}</p>
        <div className="naxatw-mb-6 naxatw-w-fit naxatw-rounded-xl naxatw-border naxatw-px-4 naxatw-py-1 naxatw-text-gray-600">
          <div className="naxatw-flex naxatw-gap-1 naxatw-border-b naxatw-py-1">
            <p className="naxatw-w-28 naxatw-text-xs md:naxatw-w-36">
              Total project area:
            </p>
            <p className="naxatw-w-28 naxatw-text-xs naxatw-font-semibold">
              {projectData?.project_area?.toFixed(3)} km²
            </p>
          </div>
          <div className="naxatw-flex naxatw-gap-1 naxatw-border-b naxatw-py-1">
            <p className="naxatw-w-28 naxatw-text-xs md:naxatw-w-36">
              Project Created By
            </p>
            <p className="naxatw-w-28 naxatw-text-xs naxatw-font-semibold">
              {projectData?.author_name || ''}
            </p>
          </div>
          <div className="naxatw-flex naxatw-gap-1 naxatw-py-1">
            <p className="naxatw-w-28 naxatw-text-xs md:naxatw-w-36">
              Total Tasks
            </p>
            <p className="naxatw-w-28 naxatw-text-xs naxatw-font-semibold">
              {projectData?.tasks?.length || ''}
            </p>
          </div>
        </div>
        {projectData?.per_task_instructions && (
          <div>
            <h1 className="naxatw-py-1 naxatw-text-sm naxatw-font-semibold naxatw-leading-4 naxatw-text-red">
              Instruction
            </h1>
            <p className="naxatw-py-1 naxatw-text-sm">
              {projectData?.per_task_instructions || ''}
            </p>
          </div>
        )}
        <div>
          <h1 className="naxatw-py-3 naxatw-text-sm naxatw-font-semibold naxatw-leading-4 naxatw-text-red">
            Map
          </h1>
          <div className="naxatw-h-[280px] naxatw-w-full naxatw-rounded-lg md:naxatw-h-[375px]">
            <MapSection projectData={projectData} />
          </div>
        </div>
      </div>
      <div className="naxatw-flex naxatw-items-end naxatw-justify-center naxatw-py-5">
        <Image
          src={dtmLogo}
          alt="DTM-logo"
          className="naxatw-h-8 naxatw-w-40"
        />
      </div>
    </section>
  );
};

export default hasErrorBoundary(ExportSection);
