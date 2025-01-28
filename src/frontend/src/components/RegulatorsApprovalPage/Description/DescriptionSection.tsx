/* eslint-disable no-nested-ternary */
import { useDispatch } from 'react-redux';
import { Button } from '@Components/RadixComponents/Button';
import { toggleModal } from '@Store/actions/common';
import ApprovalSection from './ApprovalSection';

const DescriptionSection = ({
  page = 'project-approval',
  projectData,
}: {
  projectData: Record<string, any>;
  page?: 'project-description' | 'project-approval';
}) => {
  const dispatch = useDispatch();

  return (
    <div className="naxatw-mt-4 naxatw-flex naxatw-flex-col naxatw-gap-3">
      {page === 'project-approval' && (
        <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
          Description
        </p>
      )}
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-3 naxatw-text-sm">
        <p>{projectData?.description || ''}</p>
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
          <div className="naxatw-flex naxatw-gap-2">
            <p className="naxatw-w-[146px]">Total Project Area </p>
            <p>:</p>
            <p className="naxatw-font-semibold">
              {projectData?.project_area?.toFixed(3)?.replace(/\.00$/, '') ||
                ''}{' '}
              km²
            </p>
          </div>
          <div className="naxatw-flex naxatw-gap-2">
            <p className="naxatw-w-[146px]">Project Created By </p>
            <p>:</p>{' '}
            <p className="naxatw-font-semibold">
              {projectData?.author_name || ''}
            </p>
          </div>
          <div className="naxatw-flex naxatw-gap-2">
            <p className="naxatw-w-[146px]"> Total Tasks </p>
            <p>:</p>{' '}
            <p className="naxatw-font-semibold">
              {projectData?.tasks?.length || ''}
            </p>
          </div>
          {projectData?.regulator_comment && (
            <div className="naxatw-flex naxatw-gap-2">
              <p className="naxatw-w-[146px]">Local Regulator Comment </p>
              <p>:</p>{' '}
              <p className="naxatw-font-semibold">
                {projectData?.regulator_comment || ''}
              </p>
            </div>
          )}
          {projectData?.regulator_approval_status && (
            <div className="naxatw-flex naxatw-gap-2">
              <p className="naxatw-w-[146px]">
                Local Regulator Approval Status
              </p>
              <p>:</p>{' '}
              <p className="naxatw-font-semibold">
                {projectData?.regulator_approval_status || ''}
              </p>
            </div>
          )}
        </div>
      </div>
      {page !== 'project-approval' &&
      projectData?.image_processing_status === 'NOT_STARTED' ? (
        <div>
          <Button
            className="naxatw-bg-red"
            withLoader
            leftIcon="play_arrow"
            onClick={() => {
              dispatch(toggleModal('choose-processing-parameter'));
            }}
          >
            Start Processing
          </Button>
        </div>
      ) : projectData?.image_processing_status === 'SUCCESS' ? (
        <></>
      ) : projectData?.image_processing_status === 'PROCESSING' ? (
        <div>
          <Button
            className="naxatw-bg-gray-500"
            withLoader
            isLoading
            onClick={() => {}}
          >
            Processing
          </Button>
        </div>
      ) : (
        <div>
          <Button
            className="naxatw-bg-red"
            withLoader
            leftIcon="replay"
            onClick={() => {
              dispatch(toggleModal('choose-processing-parameter'));
            }}
          >
            Re-start Processing
          </Button>
        </div>
      )}

      {page === 'project-approval' &&
        projectData?.regulator_approval_status === 'PENDING' && (
          <ApprovalSection />
        )}
    </div>
  );
};

export default DescriptionSection;
