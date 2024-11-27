import ApprovalSection from './ApprovalSection';

const DescriptionSection = ({
  projectData,
}: {
  projectData: Record<string, any>;
}) => {
  return (
    <div className="naxatw-mt-4 naxatw-flex naxatw-flex-col naxatw-gap-3">
      <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
        Description
      </p>
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-3 naxatw-text-sm">
        <p>{projectData?.description || ''}</p>
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
          <div className="naxatw-flex naxatw-gap-2">
            <p className="naxatw-w-[118px]">Total Project Area </p>
            <p>:</p>
            <p className="naxatw-font-semibold">
              {projectData?.project_area?.toFixed(3)?.replace(/\.00$/, '') ||
                ''}{' '}
              km²
            </p>
          </div>
          <div className="naxatw-flex naxatw-gap-2">
            <p className="naxatw-w-[118px]">Project Created By </p>
            <p>:</p>{' '}
            <p className="naxatw-font-semibold">
              {projectData?.author_name || ''}
            </p>
          </div>
          <div className="naxatw-flex naxatw-gap-2">
            <p className="naxatw-w-[118px]"> Total Tasks </p>
            <p>:</p>{' '}
            <p className="naxatw-font-semibold">
              {projectData?.tasks?.length || ''}
            </p>
          </div>
          {projectData?.regulator_comment && (
            <div className="naxatw-flex naxatw-gap-2">
              <p className="naxatw-w-[118px]"> Regulator Comment </p>
              <p>:</p>{' '}
              <p className="naxatw-font-semibold">
                {projectData?.regulator_comment || ''}
              </p>
            </div>
          )}
          <div className="naxatw-flex naxatw-gap-2">
            <p className="naxatw-w-[118px]">Regulator Approval Status</p>
            <p>:</p>{' '}
            <p className="naxatw-font-semibold">
              {projectData?.regulator_approval_status || ''}
            </p>
          </div>
        </div>
      </div>
      <ApprovalSection />
    </div>
  );
};

export default DescriptionSection;