import UppyFileUploader from "../UppyFileUploader";

const IMAGE_FILE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/tiff",
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
];

interface ImageUploadProps {
  projectId: string;
  onUploadStart?: () => void;
  onUploadComplete?: (result: any, batchId?: string) => void;
}

const ImageUpload = ({ projectId, onUploadStart, onUploadComplete }: ImageUploadProps) => {
  return (
    <div className="naxatw-flex naxatw-h-full naxatw-flex-col">
      {projectId ? (
        <UppyFileUploader
          projectId={projectId}
          label=""
          onUploadStart={onUploadStart}
          onUploadComplete={onUploadComplete}
          allowedFileTypes={IMAGE_FILE_TYPES}
          note="Drag and drop images here, or click Browse Files"
          staging={true}
        />
      ) : (
        <div className="naxatw-flex naxatw-flex-1 naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center naxatw-rounded naxatw-border-2 naxatw-border-dashed naxatw-border-gray-300 naxatw-bg-gray-50">
          <p className="naxatw-text-gray-500">Project ID not found</p>
        </div>
      )}
    </div>
  );
};

export default ImageUpload;
