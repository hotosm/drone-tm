import UppyFileUploader from '../UppyFileUploader';

const UploadsBox = ({
  label = 'Upload Images, GCP, and align.laz',
}: {
  label?: string;
}) => {
  const pathname = window.location.pathname?.split('/');
  const projectId = pathname?.[2];
  const taskId = pathname?.[4];

  return (
    <UppyFileUploader
      projectId={projectId}
      taskId={taskId}
      label={label}
      note="Supported: .jpg, .jpeg, .png, .tif, .tiff, gcp_list.txt, align.laz"
    />
  );
};
export default UploadsBox;
