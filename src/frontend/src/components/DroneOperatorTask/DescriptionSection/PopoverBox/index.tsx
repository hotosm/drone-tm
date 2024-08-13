import Icon from '@Components/common/Icon';
import { useNavigate } from 'react-router-dom';

interface IFilesUploadingPopOverProps {
  show: boolean;
  width?: number;
  filesLength?: number;
  uploadedFiles?: number;
}

const FilesUploadingPopOver = ({
  show,
  width = 0,
  filesLength,
  uploadedFiles,
}: IFilesUploadingPopOverProps) => {
  const navigate = useNavigate();

  // function to redirect to dashboard after 2 seconds
  function redirectToDashboard() {
    setTimeout(() => {
      navigate('/dashboard');
    }, 2000);
    return null;
  }
  return (
    <>
      <div
        className={`naxatw-absolute naxatw-left-1/2 naxatw-top-1/2 naxatw-w-1/2 naxatw-translate-x-[-50%] naxatw-translate-y-[-50%] naxatw-bg-white ${show ? 'naxatw-block' : 'naxatw-hidden'} naxatw-rounded-xl naxatw-border naxatw-border-gray-200 naxatw-px-5 naxatw-py-3 naxatw-shadow-sm`}
      >
        <h1 className="naxatw-flex naxatw-items-center naxatw-justify-center naxatw-gap-2 naxatw-text-center naxatw-text-base">
          Files
          {uploadedFiles !== filesLength ? (
            ' Uploading'
          ) : (
            <>
              {' '}
              Uploaded
              <Icon name="check" className="naxatw-text-green-600" />
            </>
          )}
        </h1>
        <div className="naxatw-h-[4rem] naxatw-w-full naxatw-bg-gray-300">
          <div
            className="naxatw-h-[4rem] naxatw-bg-[#D73F3F]"
            style={{ width: `${width}%` }}
          />
        </div>
        <h5 className="naxatw-mt-3 naxatw-text-center">
          {uploadedFiles === filesLength && uploadedFiles !== 0 ? (
            <>
              <p>Redirecting to Dashboard ...</p>
              {redirectToDashboard()}
            </>
          ) : (
            `${uploadedFiles} / ${filesLength} Files Uploaded`
          )}
        </h5>
      </div>
    </>
  );
};

export default FilesUploadingPopOver;
