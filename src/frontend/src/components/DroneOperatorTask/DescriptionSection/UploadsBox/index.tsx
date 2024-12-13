/* eslint-disable no-await-in-loop */
import { toggleModal } from '@Store/actions/common';
import { setFilesExifData } from '@Store/actions/droneOperatorTask';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import getExifData from '@Utils/getExifData';
import { toast } from 'react-toastify';

const UploadsBox = ({
  label = 'Upload Images, GCP, and align.laz',
}: {
  label?: string;
}) => {
  const dispatch = useTypedDispatch();
  const files = useTypedSelector(
    state => state.droneOperatorTask.filesExifData,
  );
  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    event.preventDefault();
    const selectedFiles = event.target.files;
    if (!selectedFiles || selectedFiles?.length === 0) return;
    const selectedFilesArray: File[] = Array.from(selectedFiles);
    try {
      const exifData = await Promise.all(
        selectedFilesArray.map(async (file: File) => {
          // Await the EXIF data for each file
          const singleFileExif = await getExifData(file);
          return singleFileExif;
        }),
      );
      dispatch(setFilesExifData(exifData));
    } catch (error) {
      toast.error('Error Reading File');
    }
    dispatch(toggleModal('raw-image-map-preview'));
  };

  return (
    <>
      <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-gap-5">
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
          <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
            {label}
          </p>
        </div>

        <label
          htmlFor="file-input"
          className="naxatw-relative naxatw-flex naxatw-h-fit naxatw-min-h-20 naxatw-items-center naxatw-justify-center naxatw-rounded-lg naxatw-border naxatw-border-dashed naxatw-border-gray-700 naxatw-py-3"
        >
          <div className="n naxatw-flex naxatw-flex-col naxatw-items-center">
            <span className="material-icons-outlined naxatw-text-red">
              cloud_upload
            </span>
            <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-text-center">
              <p className="naxatw-text-sm">
                The supported file formats are .jpg, .jpeg, .png.
              </p>
              <p className="naxatw-text-sm">
                The GCP file should be named gcp_list.txt
              </p>
              <p className="naxatw-text-sm">
                The align file should be named align.laz
              </p>
            </div>

            {files.length > 0 && (
              <p className="naxatw-text-sm naxatw-text-green-700">
                {files.length} items selected
              </p>
            )}
          </div>
          <input
            id="file-input"
            type="file"
            // @ts-ignore
            webkitDirectory=""
            directory=""
            multiple
            onChange={handleFileChange}
            className="naxatw-absolute naxatw-opacity-0"
          />
        </label>
      </div>
    </>
  );
};
export default UploadsBox;
