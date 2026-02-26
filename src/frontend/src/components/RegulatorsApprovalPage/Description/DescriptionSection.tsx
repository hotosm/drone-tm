/* eslint-disable no-nested-ternary */
import { useMemo } from 'react';
import { toast } from 'react-toastify';
import { useDispatch } from 'react-redux';
import { Button } from '@Components/RadixComponents/Button';
import { descriptionItems } from '@Constants/projectDescription';
import { toggleModal } from '@Store/actions/common';
import { useGetUserDetailsQuery } from '@Api/projects';
import Skeleton from '@Components/RadixComponents/Skeleton';
import { formatString } from '@Utils/index';
import ApprovalSection from './ApprovalSection';

const statusAfterImageUploaded = [
  'IMAGE_UPLOADED',
  'IMAGE_PROCESSING_FAILED',
  'IMAGE_PROCESSING_STARTED',
  'IMAGE_PROCESSING_FINISHED',
];

const DescriptionSection = ({
  page = 'project-approval',
  projectData,
  isProjectDataLoading = false,
  onOpenWorkflow,
}: {
  projectData: Record<string, any>;
  page?: 'project-description' | 'project-approval';
  isProjectDataLoading?: boolean;
  onOpenWorkflow?: () => void;
}) => {
  const dispatch = useDispatch();

  const { data: userDetails }: Record<string, any> = useGetUserDetailsQuery();

  // know if any of the task is completed (assets_url) is the key that provides the final results of a task OR any of the task's status is the image uploaded or next step
  const isAbleToStartProcessing = useMemo(
    () =>
      projectData?.tasks?.some(
        (task: Record<string, any>) =>
          task?.assets_url || statusAfterImageUploaded.includes(task?.state),
      ),
    [projectData?.tasks],
  );

  const taskStatusSummary = useMemo(() => {
    const tasks = projectData?.tasks;
    if (!tasks?.length) return null;
    const processed = tasks.filter(
      (t: Record<string, any>) => t?.state === 'IMAGE_PROCESSING_FINISHED',
    ).length;
    return `${processed}/${tasks.length}`;
  }, [projectData?.tasks]);

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
      toast.error(`There was an error while downloading file ${error}`);
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
            return null;
          })}

          {(projectData?.oam_upload_status === 'UPLOADING' ||
            projectData?.oam_upload_status === 'FAILED' ||
            projectData?.oam_upload_status === 'UPLOADED') && (
            <div className="naxatw-flex naxatw-gap-2">
              <p className="naxatw-w-[146px]">Uploaded to OAM</p>
              <p>:</p>
              <p className="naxatw-font-semibold">
                {formatString(projectData?.oam_upload_status)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Prominent Drone Image Processing Workflow Button */}
      {page === 'project-description' && onOpenWorkflow && (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3 naxatw-rounded-lg naxatw-border-2 naxatw-border-red-200 naxatw-bg-red-50 naxatw-p-6">
          <div className="naxatw-flex naxatw-items-start naxatw-gap-3">
            <span className="material-icons naxatw-text-2xl naxatw-text-red-600">
              cloud_upload
            </span>
            <div className="naxatw-flex-1">
              <p className="naxatw-mb-1 naxatw-text-base naxatw-font-semibold naxatw-text-red-900">
                Ready to process drone imagery?
              </p>
              <p className="naxatw-mb-3 naxatw-text-sm naxatw-text-red-700">
                Upload your drone images, classify them for quality, review results, and start processing.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="naxatw-w-full naxatw-bg-red naxatw-py-3 naxatw-text-base naxatw-font-semibold naxatw-text-white hover:naxatw-bg-red-700"
            leftIcon="settings"
            iconClassname="naxatw-text-xl"
            onClick={onOpenWorkflow}
          >
            Drone Image Processing Workflow
          </Button>
        </div>
      )}

      {page !== 'project-approval' &&
        (!projectData?.requires_approval_from_regulator ||
          projectData?.regulator_approval_status === 'APPROVED') &&
        isAbleToStartProcessing && (
          <div className="naxatw-flex naxatw-flex-wrap naxatw-gap-2">
            <Button
              className="naxatw-bg-red"
              leftIcon="monitoring"
              onClick={() => {
                dispatch(toggleModal('processing-status'));
              }}
            >
              Processing Status
              {taskStatusSummary && (
                <span className="naxatw-ml-1 naxatw-rounded-full naxatw-bg-white/20 naxatw-px-2 naxatw-py-0.5 naxatw-text-xs">
                  {taskStatusSummary}
                </span>
              )}
            </Button>

            {projectData?.image_processing_status === 'SUCCESS' && (
              <>
                <Button
                  className="naxatw-bg-red"
                  leftIcon="download"
                  onClick={() => handleDownloadResult()}
                >
                  Download Results
                </Button>
                {String(projectData?.author_id || '') ===
                  String(userDetails?.id || '') && (
                  <>
                    {projectData?.oam_upload_status === 'NOT_STARTED' ? (
                      <Button
                        className="naxatw-bg-red"
                        withLoader
                        leftIcon="upload"
                        onClick={() => {
                          dispatch(toggleModal('upload-to-oam'));
                        }}
                      >
                        Upload to OAM
                      </Button>
                    ) : projectData?.oam_upload_status === 'FAILED' ? (
                      <Button
                        className="naxatw-bg-red"
                        withLoader
                        leftIcon="upload"
                        onClick={() => {
                          dispatch(toggleModal('upload-to-oam'));
                        }}
                      >
                        Re-upload to OAM
                      </Button>
                    ) : (
                      <></>
                    )}
                  </>
                )}
              </>
            )}

            {projectData?.image_processing_status === 'PROCESSING' && (
              <Button
                className="naxatw-bg-gray-500"
                withLoader
                isLoading
                onClick={() => {}}
              >
                Processing
              </Button>
            )}
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
