import UppyImageUploader from '../UppyImageUploader';

const UploadsBox = ({
  label = 'Upload Images, GCP, and align.laz',
}: {
  label?: string;
}) => {
  const pathname = window.location.pathname?.split('/');
  const projectId = pathname?.[2];
  const taskId = pathname?.[4];

  return (
    <UppyImageUploader
      projectId={projectId}
      taskId={taskId}
      label={label}
      replaceExisting={false}
    />
  );
};
export default UploadsBox;
