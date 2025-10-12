import { useEffect, useState, useCallback } from 'react';
import Uppy from '@uppy/core';
import AwsS3 from '@uppy/aws-s3';
import { DragDrop, ProgressBar } from '@uppy/react';
import { toast } from 'react-toastify';
import { authenticated, api } from '@Services/index';
import { useTypedDispatch } from '@Store/hooks';
import { setFilesExifData } from '@Store/actions/droneOperatorTask';
import { toggleModal } from '@Store/actions/common';
import getExifData from '@Utils/getExifData';

import '@uppy/core/dist/style.min.css';
import '@uppy/drag-drop/dist/style.min.css';
import '@uppy/progress-bar/dist/style.min.css';

interface UppyImageUploaderProps {
  projectId: string;
  taskId: string;
  replaceExisting?: boolean;
  label?: string;
}

const UppyImageUploader = ({
  projectId,
  taskId,
  replaceExisting = false,
  label = 'Upload Images, GCP, and align.laz',
}: UppyImageUploaderProps) => {
  const dispatch = useTypedDispatch();
  const [filesCount, setFilesCount] = useState(0);

  const handleFilesAdded = useCallback(
    async (files: any[]) => {
      try {
        // Extract EXIF data from image files
        const imageFiles = files.filter(file =>
          file.type?.startsWith('image/')
        );

        if (imageFiles.length > 0) {
          const exifDataPromises = imageFiles.map(async file => {
            const exifData = await getExifData(file.data);
            return exifData;
          });

          const exifData = await Promise.all(exifDataPromises);
          dispatch(setFilesExifData(exifData));
        }

        setFilesCount(files.length);
      } catch (error) {
        console.error('Error extracting EXIF data:', error);
        toast.error('Error reading file metadata');
      }
    },
    [dispatch]
  );

  const [uppy] = useState(() =>
    new Uppy({
      id: 'drone-image-uploader',
      autoProceed: false,
      restrictions: {
        maxFileSize: 500 * 1024 * 1024, // 500 MB per file
        allowedFileTypes: [
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
      },
    }).use(AwsS3Multipart, {
      limit: 4, // Upload 4 parts simultaneously
      retryDelays: [0, 1000, 3000, 5000],
      companionUrl: '', // Not using Companion server
      createMultipartUpload: async file => {
        try {
          const response = await authenticated(api).post(
            '/projects/initiate-multipart-upload/',
            {
              project_id: projectId,
              task_id: taskId,
              file_name: file.name,
            }
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
            }
          );

          return {
            url: response.data.url,
          };
        } catch (error: any) {
          toast.error(
            `Failed to sign part ${partData.partNumber} for ${file.name}`
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
            }
          );
        } catch (error: any) {
          toast.error(`Failed to complete upload for ${file.name}`);
          throw error;
        }
      },
      abortMultipartUpload: async (file, data) => {
        try {
          await authenticated(api).post('/projects/abort-multipart-upload/', {
            upload_id: data.uploadId,
            file_key: data.key,
          });
        } catch (error: any) {
          console.error(`Failed to abort upload for ${file.name}:`, error);
        }
      },
    })
  );

  useEffect(() => {
    uppy.on('files-added', files => {
      handleFilesAdded(files);
    });

    uppy.on('upload-success', () => {
      // File uploaded successfully
    });

    uppy.on('upload-error', (file, error) => {
      toast.error(`Upload failed for ${file?.name}: ${error.message}`);
    });

    uppy.on('complete', result => {
      const successfulUploads = result.successful?.length || 0;
      const failedUploads = result.failed?.length || 0;

      if (successfulUploads > 0) {
        toast.success(`${successfulUploads} file(s) uploaded successfully`);
        // Trigger map preview after upload
        dispatch(toggleModal('raw-image-map-preview'));
      }

      if (failedUploads > 0) {
        toast.error(`${failedUploads} file(s) failed to upload`);
      }
    });

    return () => {
      uppy.close({ reason: 'unmount' });
    };
  }, [uppy, handleFilesAdded, dispatch]);

  return (
    <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-gap-5">
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
        <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
          {label}
        </p>
      </div>

      <div className="naxatw-rounded-lg naxatw-border naxatw-border-dashed naxatw-border-gray-700">
        <DragDrop
          uppy={uppy}
          locale={{
            strings: {
              dropHereOr: 'Drop files here or %{browse}',
              browse: 'browse',
            },
          }}
          note="Supported: .jpg, .jpeg, .png, .tif, .tiff, gcp_list.txt, align.laz"
        />
      </div>

      {filesCount > 0 && (
        <p className="naxatw-text-sm naxatw-text-green-700">
          {filesCount} items selected
        </p>
      )}

      <ProgressBar uppy={uppy} hideAfterFinish={false} />

      {filesCount > 0 && (
        <button
          type="button"
          onClick={() => uppy.upload()}
          className="naxatw-rounded-md naxatw-bg-[#D73F3F] naxatw-px-6 naxatw-py-2 naxatw-text-white hover:naxatw-bg-[#c13636]"
        >
          Upload {filesCount} file(s)
        </button>
      )}
    </div>
  );
};

export default UppyImageUploader;
