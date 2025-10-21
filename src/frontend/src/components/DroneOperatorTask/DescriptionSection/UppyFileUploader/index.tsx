import { useEffect, useCallback, useContext } from 'react';
import AwsS3 from '@uppy/aws-s3';
import { Dropzone, useUppyState, UppyContext } from '@uppy/react';
import { toast } from 'react-toastify';
import { authenticated, api } from '@Services/index';
import { useTypedDispatch } from '@Store/hooks';
import { setFilesExifData } from '@Store/actions/droneOperatorTask';
import getExifData from '@Utils/getExifData';

interface UppyFileUploaderProps {
  projectId: string;
  taskId?: string;
  label?: string;
  onUploadComplete?: (result: any) => void;
  allowedFileTypes?: string[];
  note?: string;
}

const UppyFileUploader = ({
  projectId,
  taskId,
  label = 'Upload Files',
  onUploadComplete,
  allowedFileTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/tiff',
    '.jpg',
    '.jpeg',
    '.png',
    '.tif',
    '.tiff',
    '.txt',
    '.laz',
  ],
  note = 'Drag and drop files here, or click to browse',
}: UppyFileUploaderProps) => {
  const dispatch = useTypedDispatch();

  // Get the shared Uppy instance from context
  const { uppy } = useContext(UppyContext);

  if (!uppy) {
    throw new Error('UppyFileUploader must be used within UppyContextProvider');
  }

  // Configure AWS S3 plugin for this component
  useEffect(() => {
    // Add restrictions specific to this uploader
    uppy.setOptions({
      restrictions: {
        ...uppy.opts.restrictions,
        allowedFileTypes,
      },
    });

    // Check if AwsS3 plugin is already added, if not add it
    const pluginId = 'AwsS3';
    if (!uppy.getPlugin(pluginId)) {
      uppy.use(AwsS3, {
        id: pluginId,
      limit: 4, // Upload 4 parts simultaneously
      retryDelays: [0, 1000, 3000, 5000],
      shouldUseMultipart: true,
      createMultipartUpload: async file => {
        try {
          const response = await authenticated(api).post(
            '/projects/initiate-multipart-upload/',
            {
              project_id: projectId,
              task_id: taskId,
              file_name: file.name,
            },
            {
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );

          return {
            uploadId: response.data.upload_id,
            key: response.data.file_key,
          };
        } catch (error: any) {
          toast.error(`Failed to initiate upload for ${file.name}`);
          throw error;
        }
      },
      signPart: async (file, partData) => {
        try {
          const response = await authenticated(api).post(
            '/projects/sign-part-upload/',
            {
              upload_id: partData.uploadId,
              file_key: partData.key,
              part_number: partData.partNumber,
              expiry: 5,
            },
            {
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );

          return {
            url: response.data.url,
          };
        } catch (error: any) {
          toast.error(
            `Failed to sign part ${partData.partNumber} for ${file.name}`,
          );
          throw error;
        }
      },
      completeMultipartUpload: async (file, data) => {
        try {
          await authenticated(api).post(
            '/projects/complete-multipart-upload/',
            {
              upload_id: data.uploadId,
              file_key: data.key,
              parts: data.parts,
            },
            {
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );

          return {
            location: data.key,
          };
        } catch (error: any) {
          toast.error(`Failed to complete upload for ${file.name}`);
          throw error;
        }
      },
      abortMultipartUpload: async (file, data) => {
        try {
          await authenticated(api).post(
            '/projects/abort-multipart-upload/',
            {
              upload_id: data.uploadId,
              file_key: data.key,
            },
            {
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );
        } catch (error: any) {
          console.error(`Failed to abort upload for ${file.name}:`, error);
        }
      },
      listParts: async (file, data) => {
        try {
          const response = await authenticated(api).get(
            `/projects/list-parts/?upload_id=${data.uploadId}&file_key=${data.key}`,
          );

          return response.data.parts || [];
        } catch (error: any) {
          console.error(`Failed to list parts for ${file.name}:`, error);
          return [];
        }
      },
    });
    }

    // Cleanup function
    return () => {
      // Clear files when component unmounts
      uppy.cancelAll();
    };
  }, [uppy, projectId, taskId, allowedFileTypes]);

  // Use useUppyState to reactively track files
  const files = useUppyState(uppy, state => state.files);
  const filesArray = Object.values(files);

  // Extract EXIF data when files are added
  const handleFilesAdded = useCallback(
    async (addedFiles: any[]) => {
      try {
        // Extract EXIF data from image files
        const imageFiles = addedFiles.filter(file =>
          file.type?.startsWith('image/'),
        );

        if (imageFiles.length > 0) {
          const exifDataPromises = imageFiles.map(async file => {
            const exifData = await getExifData(file.data);
            return exifData;
          });

          const exifData = await Promise.all(exifDataPromises);
          dispatch(setFilesExifData(exifData));
        }
      } catch (error) {
        console.error('Error extracting EXIF data:', error);
        toast.error('Error reading file metadata');
      }
    },
    [dispatch],
  );

  useEffect(() => {
    uppy.on('files-added', handleFilesAdded);

    uppy.on('upload-error', (file, error) => {
      toast.error(`Upload failed for ${file?.name}: ${error.message}`);
    });

    uppy.on('complete', result => {
      const successfulUploads = result.successful?.length || 0;
      const failedUploads = result.failed?.length || 0;

      if (successfulUploads > 0) {
        toast.success(`${successfulUploads} file(s) uploaded successfully`);
        if (onUploadComplete) {
          onUploadComplete(result);
        }
      }

      if (failedUploads > 0) {
        toast.error(`${failedUploads} file(s) failed to upload`);
      }
    });

    return () => {
      // Event listeners are automatically cleaned up when component unmounts
    };
  }, [uppy, handleFilesAdded, dispatch, onUploadComplete]);

  return (
    <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-gap-5">
      {label && (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
          <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
            {label}
          </p>
        </div>
      )}

      <div className="naxatw-rounded-lg naxatw-border naxatw-border-dashed naxatw-border-gray-700">
        <Dropzone note={note} />
      </div>

      {filesArray.length > 0 && (
        <p className="naxatw-text-sm naxatw-text-green-700">
          {filesArray.length} items selected
        </p>
      )}

      {filesArray.length > 0 && (
        <button
          type="button"
          onClick={() => uppy.upload()}
          className="naxatw-rounded-md naxatw-bg-[#D73F3F] naxatw-px-6 naxatw-py-2 naxatw-text-white hover:naxatw-bg-[#c13636]"
        >
          Upload {filesArray.length} file(s)
        </button>
      )}
    </div>
  );
};

export default UppyFileUploader;
