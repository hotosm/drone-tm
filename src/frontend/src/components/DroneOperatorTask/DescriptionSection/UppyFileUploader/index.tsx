import { useEffect, useCallback, useContext, useRef } from 'react';
import AwsS3 from '@uppy/aws-s3';
import { Dashboard } from '@uppy/react';
import { UppyContext } from '@uppy/react';
import { toast } from 'react-toastify';
import { authenticated, api } from '@Services/index';
import { useTypedDispatch } from '@Store/hooks';
import { deleteBatch } from '@Services/classification';

import '@uppy/core/css/style.min.css';
import '@uppy/dashboard/css/style.min.css';
import './uppy-theme.css';

interface UppyFileUploaderProps {
  projectId: string;
  taskId?: string;
  label?: string;
  onUploadComplete?: (result: any, batchId?: string) => void;
  onCancel?: (batchId: string) => void;
  allowedFileTypes?: string[];
  note?: string;
  staging?: boolean; // If true, uploads to user-uploads staging directory
}

const UppyFileUploader = ({
  projectId,
  taskId,
  label = 'Upload Files',
  onUploadComplete,
  onCancel,
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
  staging = false,
}: UppyFileUploaderProps) => {
  const dispatch = useTypedDispatch();
  // Generate a batch ID when upload starts (for staging uploads only)
  const batchIdRef = useRef<string | null>(null);
  // Track if we've shown the success notification to prevent duplicates
  const notificationShownRef = useRef<boolean>(false);

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

    // Remove existing AwsS3 plugin and re-add with fresh configuration
    const pluginId = 'AwsS3';
    const existingPlugin = uppy.getPlugin(pluginId);
    if (existingPlugin) {
      uppy.removePlugin(existingPlugin);
    }
    uppy.use(AwsS3, {
      id: pluginId,
      // Limit files uploaded simultaneously.
      // Note this is a limit for the number of files, not connections.
      // ~5–15 MB files, part size 5MB, gives 1-3 parts per file.
      // 2 files × 2 parts = 4 concurrent PUTs, which is enough
      // to saturate the bandwidth in many places
      limit: 2,
      retryDelays: [0, 1000, 3000, 5000],
      shouldUseMultipart: true,
      createMultipartUpload: async file => {
        try {
          const requestData: any = {
            project_id: projectId,
            file_name: file.name,
            staging,
          };

          // Only include task_id if not staging and taskId is provided
          if (!staging && taskId) {
            requestData.task_id = taskId;
          }

          const response = await authenticated(api).post(
            '/projects/initiate-multipart-upload/',
            requestData,
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
          const requestBody: any = {
            upload_id: data.uploadId,
            file_key: data.key,
            parts: data.parts,
            project_id: projectId,
            filename: file.name,
          };

          // Include batch_id for staging uploads
          if (staging && batchIdRef.current) {
            requestBody.batch_id = batchIdRef.current;
          }

          await authenticated(api).post(
            '/projects/complete-multipart-upload/',
            requestBody,
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

    // Cleanup function
    return () => {
      // Clear files when component unmounts
      uppy.cancelAll();
    };
  }, [uppy, projectId, taskId, allowedFileTypes, staging]);


  useEffect(() => {
    // Reset batch ID when component mounts to ensure fresh state
    batchIdRef.current = null;
    notificationShownRef.current = false;

    // Generate batch ID when upload starts (for staging uploads only)
    const handleUpload = () => {
      if (staging && !batchIdRef.current) {
        // Generate a UUID v4 for the batch
        batchIdRef.current = crypto.randomUUID();
      }
      // Reset notification flag when new upload starts
      notificationShownRef.current = false;
    };

    const handleUploadError = (file: any, error: Error) => {
      toast.error(`Upload failed for ${file?.name}: ${error.message}`);
    };

    const handleComplete = (result: any) => {
      const successfulUploads = result.successful?.length || 0;
      const failedUploads = result.failed?.length || 0;

      // Only show notification once per upload batch
      if (successfulUploads > 0 && !notificationShownRef.current) {
        toast.success(`${successfulUploads} file(s) uploaded successfully`);
        notificationShownRef.current = true;

        if (onUploadComplete) {
          onUploadComplete(result, staging ? batchIdRef.current || undefined : undefined);
        }

        // Reset batch ID after successful upload
        if (staging) {
          batchIdRef.current = null;
        }
      }

      if (failedUploads > 0) {
        toast.error(`${failedUploads} file(s) failed to upload`);
      }
    };

    // Handle cancel-all event to clean up batch when user cancels upload
    const handleCancelAll = async () => {
      // Notify parent component first
      if (staging && batchIdRef.current) {
        onCancel?.(batchIdRef.current);

        // Then cleanup database records when user cancels upload via Uppy UI
        try {
          await deleteBatch(projectId, batchIdRef.current);
          toast.warning('Upload cancelled. Staging images cleared.');
        } catch (error: any) {
          console.error('Failed to cleanup batch after cancel:', error);
          toast.error('Warning: Failed to cleanup staging images');
        } finally {
          batchIdRef.current = null;
          notificationShownRef.current = false;
        }
      }
    };

    uppy.on('upload', handleUpload);
    uppy.on('upload-error', handleUploadError);
    uppy.on('complete', handleComplete);
    uppy.on('cancel-all', handleCancelAll);

    return () => {
      uppy.off('upload', handleUpload);
      uppy.off('upload-error', handleUploadError);
      uppy.off('complete', handleComplete);
      uppy.off('cancel-all', handleCancelAll);
    };
  }, [uppy, dispatch, onUploadComplete, onCancel, staging, projectId]);

  return (
    <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-gap-3">
      {label && (
        <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
          {label}
        </p>
      )}

      <Dashboard
        uppy={uppy}
        proudlyDisplayPoweredByUppy={false}
        width='100%'
        height='48vh'
        note={note}
        theme="light"
        hideProgressAfterFinish={false}
        hideUploadButton={false}
      />
    </div>
  );
};

export default UppyFileUploader;
