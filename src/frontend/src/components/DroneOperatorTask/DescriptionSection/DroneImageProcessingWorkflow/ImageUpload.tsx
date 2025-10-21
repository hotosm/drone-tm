import UppyFileUploader from '../UppyFileUploader';

interface ImageUploadProps {
  projectId: string;
}

const ImageUpload = ({ projectId }: ImageUploadProps) => {

  const handleUploadComplete = (result: any) => {
    console.log('Upload completed:', result);
    // TODO: Handle upload completion (e.g., move to next step, show success message)
  };

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-4">
      <p className="naxatw-text-sm naxatw-text-[#484848]">
        Upload your drone images. The system will extract EXIF data to generate
        tasks automatically.
      </p>

      {projectId ? (
        <UppyFileUploader
          projectId={projectId}
          label="Upload Drone Images"
          onUploadComplete={handleUploadComplete}
          allowedFileTypes={[
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/tiff',
            '.jpg',
            '.jpeg',
            '.png',
            '.tif',
            '.tiff',
          ]}
          note="Supported: .jpg, .jpeg, .png, .tif, .tiff - Drag and drop or click to browse"
        />
      ) : (
        <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center naxatw-rounded naxatw-border-2 naxatw-border-dashed naxatw-border-gray-300 naxatw-bg-gray-50">
          <p className="naxatw-text-gray-500">Project ID not found</p>
        </div>
      )}
    </div>
  );
};

export default ImageUpload;
