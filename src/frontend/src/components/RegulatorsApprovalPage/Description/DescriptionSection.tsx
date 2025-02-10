/* eslint-disable no-nested-ternary */
import { useMemo } from 'react';
import { toast } from 'react-toastify';
import { useDispatch } from 'react-redux';
import { Button } from '@Components/RadixComponents/Button';
import { descriptionItems } from '@Constants/projectDescription';
import { toggleModal } from '@Store/actions/common';
import Skeleton from '@Components/RadixComponents/Skeleton';
import ApprovalSection from './ApprovalSection';

const DescriptionSection = ({
  page = 'project-approval',
  projectData,
  isProjectDataLoading = false,
}: {
  projectData: Record<string, any>;
  page?: 'project-description' | 'project-approval';
  isProjectDataLoading?: boolean;
}) => {
  const dispatch = useDispatch();

  // know if any of the task is completed (assets_url) is the key that provides the final results of a task
  const isAbleToStartProcessing = useMemo(
    () =>
      projectData?.tasks?.some((task: Record<string, any>) => task?.assets_url),
    [projectData?.tasks],
  );

  const handleDownloadResult = () => {
    if (!projectData?.assets_url) return;
    try {
      const link = document.createElement('a');
      link.href = projectData?.assets_url;
      link.setAttribute('download', '');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error(`There wan an error while downloading file ${error}`);
    }
  };

  if (isProjectDataLoading)
    return (
      <div className="naxatw-py-4">
        <Skeleton className="naxatw-h-64 naxatw-bg-gray-100" />
      </div>
    );

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
          {descriptionItems.map(descriptionItem => {
            if (
              projectData?.[descriptionItem.key] ||
              descriptionItem.expectedDataType === 'boolean'
            ) {
              const dataType = descriptionItem.expectedDataType;
              const value = projectData?.[descriptionItem.key];
              const unite = descriptionItem?.unite || '';
              return (
                <div
                  className="naxatw-flex naxatw-gap-2"
                  key={descriptionItem.key}
                >
                  <p className="naxatw-w-[146px]">{descriptionItem.label}</p>
                  <p>:</p>
                  <p className="naxatw-font-semibold">
                    {dataType === 'boolean'
                      ? value
                        ? 'Yes'
                        : 'No'
                      : dataType === 'double'
                        ? value.toFixed(3)?.replace(/\.00$/, '') || ''
                        : dataType === 'array'
                          ? value?.length
                          : value}{' '}
                    {unite}
                  </p>
                </div>
              );
            }
            return <></>;
          })}
        </div>
      </div>
      {page !== 'project-approval' &&
        (!projectData?.requires_approval_from_regulator ||
          projectData?.regulator_approval_status === 'APPROVED') &&
        isAbleToStartProcessing && (
          <>
            {projectData?.image_processing_status === 'NOT_STARTED' ? (
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
              <div>
                <Button
                  className="naxatw-bg-red"
                  leftIcon="download"
                  onClick={() => handleDownloadResult()}
                >
                  Download Results
                </Button>
              </div>
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
          </>
        )}

      {page === 'project-approval' &&
        projectData?.regulator_approval_status === 'PENDING' && (
          <ApprovalSection />
        )}
    </div>
  );
};

export default DescriptionSection;
