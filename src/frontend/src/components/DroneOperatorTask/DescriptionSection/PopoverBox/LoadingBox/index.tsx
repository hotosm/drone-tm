import Icon from '@Components/common/Icon';
import { toggleModal } from '@Store/actions/common';
import { useQueryClient } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';

interface IFilesUploadingPopOverProps {
  show: boolean;
  width?: number;
  filesLength?: number;
  uploadedFiles?: number;
}

const FilesUploadingPopOver = ({
  show = true,
  width = 0,
  filesLength,
  uploadedFiles,
}: IFilesUploadingPopOverProps) => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();

  // function to close modal and refetch task assets to update the UI
  function closeModal() {
    queryClient.invalidateQueries(['task-description']);
    setTimeout(() => {
      dispatch(toggleModal());
    }, 2000);
    return null;
  }
  return (
    <>
      <div
        className={`naxatw-absolute naxatw-left-1/2 naxatw-top-1/2 naxatw-z-[100000] naxatw-w-1/2 naxatw-translate-x-[-50%] naxatw-translate-y-[-50%] naxatw-bg-white ${show ? 'naxatw-block' : 'naxatw-hidden'} naxatw-rounded-xl naxatw-border naxatw-border-gray-200 naxatw-p-6 naxatw-shadow-sm`}
      >
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-[0.88rem]">
          <div className="naxatw-flex naxatw-flex-col naxatw-items-start naxatw-self-stretch">
            <p className="naxatw-flex naxatw-items-center naxatw-justify-start naxatw-gap-2 naxatw-text-[1.0625rem] naxatw-font-bold naxatw-leading-normal">
              {uploadedFiles !== filesLength ? (
                ' Uploading'
              ) : (
                <>
                  {' '}
                  Uploaded
                  <Icon name="check" className="naxatw-text-green-600" />
                </>
              )}
            </p>
            <p className="naxatw-text-[0.875rem naxatw-leading-normal naxatw-text-[#7A7676]">
              Selected picture is being uploaded{' '}
            </p>
          </div>
          <div className="naxatw-flex naxatw-flex-col naxatw-items-start naxatw-gap-1 naxatw-self-stretch">
            <p className="naxatw-text-[0.875rem] naxatw-text-[#7A7676]">
              {uploadedFiles === filesLength && uploadedFiles !== 0 ? (
                <>
                  {/* <p>Redirecting to Dashboard ...</p> */}
                  {closeModal()}
                </>
              ) : (
                `${uploadedFiles} / ${filesLength} Files Uploaded`
              )}
            </p>
            <div className="naxatw-h-[0.75rem] naxatw-w-full naxatw-rounded-3xl naxatw-bg-gray-300">
              <div
                className={`naxatw-h-[0.75rem] naxatw-animate-pulse naxatw-bg-[#D73F3F] ${width === 100 ? 'naxatw-rounded-3xl' : 'naxatw-rounded-l-3xl'} naxatw-transition-all`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default FilesUploadingPopOver;
