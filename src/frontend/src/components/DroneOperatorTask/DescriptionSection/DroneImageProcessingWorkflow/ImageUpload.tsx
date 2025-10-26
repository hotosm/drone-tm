import { useContext } from 'react';
import { UppyContext, useUppyState } from '@uppy/react';
import { Button } from '@Components/RadixComponents/Button';
import UppyFileUploader from '../UppyFileUploader';

interface ImageUploadProps {
  projectId: string;
  onUploadComplete?: (result: any) => void;
}

const ImageUpload = ({ projectId, onUploadComplete }: ImageUploadProps) => {
  const { uppy } = useContext(UppyContext);

  if (!uppy) {
    throw new Error('ImageUpload must be used within UppyContextProvider');
  }

  // Track upload progress
  const files = useUppyState(uppy, state => state.files);
  const filesArray = Object.values(files);
  const totalProgress = useUppyState(uppy, state => state.totalProgress);

  const completedCount = filesArray.filter(f => f.progress?.uploadComplete).length;
  const uploadingCount = filesArray.filter(f => f.progress?.uploadStarted && !f.progress?.uploadComplete).length;
  const totalSize = filesArray.reduce((sum, f) => sum + (f.size || 0), 0);

  const handleComplete = (result: any) => {
    console.log('Upload completed:', result);
    if (onUploadComplete) {
      onUploadComplete(result);
    }
  };

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-6">

      {projectId ? (
        <>
          {/* File Uploader */}
          <UppyFileUploader
            projectId={projectId}
            label="Upload Drone Images"
            onUploadComplete={handleComplete}
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
            staging={true}
          />

          {/* Upload Queue */}
          {filesArray.length > 0 && (
            <div className="naxatw-rounded-xl naxatw-border naxatw-border-gray-200 naxatw-bg-white naxatw-p-6">
              <div className="naxatw-mb-4 naxatw-flex naxatw-items-center naxatw-justify-between">
                <div>
                  <h3 className="naxatw-text-lg naxatw-font-semibold naxatw-text-[#484848]">
                    Upload Queue
                  </h3>
                  <div className="naxatw-text-sm naxatw-text-gray-600">
                    {completedCount} / {filesArray.length} completed
                  </div>
                </div>
                {uploadingCount === 0 && completedCount < filesArray.length && (
                  <Button
                    variant="ghost"
                    className="naxatw-bg-[#D73F3F] naxatw-text-white"
                    leftIcon="upload"
                    onClick={() => uppy.upload()}
                  >
                    Upload All ({filesArray.length})
                  </Button>
                )}
              </div>

              {/* File List */}
              <div className="naxatw-max-h-96 naxatw-space-y-3 naxatw-overflow-y-auto">
                {filesArray.map(file => (
                  <div
                    key={file.id}
                    className="naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-rounded-lg naxatw-bg-gray-50 naxatw-p-3"
                  >
                    {/* Status Icon */}
                    <div className="naxatw-flex-shrink-0">
                      {file.progress?.uploadComplete ? (
                        <span className="material-icons naxatw-text-green-600">
                          check_circle
                        </span>
                      ) : file.error ? (
                        <span className="material-icons naxatw-text-red-600">
                          cancel
                        </span>
                      ) : file.progress?.uploadStarted ? (
                        <span className="material-icons naxatw-animate-spin naxatw-text-blue-600">
                          sync
                        </span>
                      ) : (
                        <span className="material-icons naxatw-text-gray-400">
                          description
                        </span>
                      )}
                    </div>

                    {/* File Info */}
                    <div className="naxatw-min-w-0 naxatw-flex-1">
                      <div className="naxatw-mb-1 naxatw-flex naxatw-items-center naxatw-justify-between">
                        <p className="naxatw-truncate naxatw-text-sm naxatw-font-medium naxatw-text-[#484848]">
                          {file.name}
                        </p>
                        <span className="naxatw-ml-2 naxatw-text-xs naxatw-text-gray-500">
                          {((file.size || 0) / 1024 / 1024).toFixed(2)} MB
                        </span>
                      </div>

                      {/* Progress Bar */}
                      {file.progress?.uploadStarted && !file.progress?.uploadComplete && (
                        <div className="naxatw-h-1.5 naxatw-w-full naxatw-rounded-full naxatw-bg-gray-200">
                          <div
                            className="naxatw-h-1.5 naxatw-rounded-full naxatw-bg-blue-600 naxatw-transition-all naxatw-duration-300"
                            style={{
                              width: `${file.progress.percentage || 0}%`,
                            }}
                          />
                        </div>
                      )}

                      {/* Status Text */}
                      {file.progress?.uploadComplete && (
                        <p className="naxatw-text-xs naxatw-text-green-600">
                          Upload complete
                        </p>
                      )}
                      {file.error && (
                        <p className="naxatw-text-xs naxatw-text-red-600">
                          {file.error}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className="naxatw-mt-4 naxatw-border-t naxatw-border-gray-200 naxatw-pt-4">
                <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-text-sm">
                  <span className="naxatw-text-gray-600">Total size:</span>
                  <span className="naxatw-font-medium naxatw-text-[#484848]">
                    {(totalSize / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
                {uploadingCount > 0 && (
                  <div className="naxatw-mt-2 naxatw-flex naxatw-items-center naxatw-justify-between naxatw-text-sm">
                    <span className="naxatw-text-gray-600">Overall progress:</span>
                    <span className="naxatw-font-medium naxatw-text-blue-600">
                      {totalProgress}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center naxatw-rounded naxatw-border-2 naxatw-border-dashed naxatw-border-gray-300 naxatw-bg-gray-50">
          <p className="naxatw-text-gray-500">Project ID not found</p>
        </div>
      )}
    </div>
  );
};

export default ImageUpload;
