import UppyFileUploader from '../UppyFileUploader';

interface ImageUploadProps {
  projectId: string;
  onUploadComplete?: (result: any, batchId?: string) => void;
}

const ImageUpload = ({ projectId, onUploadComplete }: ImageUploadProps) => {
  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-6">
      {projectId ? (
        <UppyFileUploader
          projectId={projectId}
          label=""
          onUploadComplete={onUploadComplete}
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
          note="Drag and drop images here, or click Browse Files"
          staging={true}
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
