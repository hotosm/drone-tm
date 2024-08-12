interface IFilesUploadingPopOverProps {
  show: boolean;
}

const FilesUploadingPopOver = ({ show }: IFilesUploadingPopOverProps) => {
  return (
    <>
      <div
        className={`naxatw-absolute naxatw-left-1/2 naxatw-top-1/2 naxatw-h-[25rem] naxatw-w-1/2 naxatw-translate-x-[-50%] naxatw-translate-y-[-50%] naxatw-bg-white ${show ? 'naxatw-block' : 'naxatw-hidden'} naxatw-rounded-xl naxatw-border naxatw-border-gray-200 naxatw-px-5 naxatw-py-3 naxatw-shadow-sm`}
      >
        <h1 className="naxatw-text-center naxatw-text-base">Files Uploading</h1>
        <div className="naxatw-h-[4rem] naxatw-w-full naxatw-bg-gray-300">
          <div
            className="naxatw-h-[4rem] naxatw-bg-[#D73F3F]"
            style={{ width: '50%' }}
          />
        </div>
        <h5 className="naxatw-mt-5 naxatw-text-center">
          4 / 12 Files Uploaded
        </h5>
      </div>
    </>
  );
};

export default FilesUploadingPopOver;
