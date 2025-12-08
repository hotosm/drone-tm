import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBatchReview, BatchReviewData, TaskGroup } from '@Services/classification';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';

interface ImageReviewProps {
  projectId: string;
  batchId: string;
}

const ImageReview = ({ projectId, batchId }: ImageReviewProps) => {
  const [selectedImage, setSelectedImage] = useState<{
    url: string;
    filename: string;
  } | null>(null);

  const { data: reviewData, isLoading, error } = useQuery<BatchReviewData>({
    queryKey: ['batchReview', projectId, batchId],
    queryFn: () => getBatchReview(projectId, batchId),
    enabled: !!projectId && !!batchId,
  });

  if (isLoading) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <p className="naxatw-text-gray-500">Loading review data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <p className="naxatw-text-red-500">
          Error loading review data: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  if (!reviewData || reviewData.task_groups.length === 0) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <p className="naxatw-text-gray-500">
          No classified images available for review.
        </p>
      </div>
    );
  }

  const handleImageClick = (imageUrl: string, filename: string) => {
    setSelectedImage({ url: imageUrl, filename });
  };

  const closeModal = () => {
    setSelectedImage(null);
  };

  return (
    <FlexColumn className="naxatw-gap-4">
      {/* Summary Section */}
      <div className="naxatw-rounded naxatw-border naxatw-border-gray-300 naxatw-bg-gray-50 naxatw-p-4">
        <FlexRow className="naxatw-gap-6">
          <div>
            <p className="naxatw-text-sm naxatw-text-gray-600">Total Tasks</p>
            <p className="naxatw-text-2xl naxatw-font-semibold naxatw-text-gray-900">
              {reviewData.total_tasks}
            </p>
          </div>
          <div>
            <p className="naxatw-text-sm naxatw-text-gray-600">Total Images</p>
            <p className="naxatw-text-2xl naxatw-font-semibold naxatw-text-gray-900">
              {reviewData.total_images}
            </p>
          </div>
        </FlexRow>
      </div>

      <p className="naxatw-text-sm naxatw-text-[#484848]">
        Review the classified images grouped by tasks. Click on any image to view it in full size.
      </p>

      {/* Task Groups */}
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-6">
        {reviewData.task_groups.map((group: TaskGroup, index: number) => (
          <div
            key={group.task_id || `unmatched-${index}`}
            className="naxatw-rounded naxatw-border naxatw-border-gray-300 naxatw-bg-white naxatw-p-4"
          >
            {/* Task Header */}
            <div className="naxatw-mb-4 naxatw-flex naxatw-items-center naxatw-justify-between naxatw-border-b naxatw-pb-3">
              <div>
                <h4 className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-900">
                  {group.task_id && group.project_task_index !== null
                    ? `Task #${group.project_task_index}`
                    : 'Unmatched Images'}
                </h4>
                {!group.task_id && (
                  <p className="naxatw-text-sm naxatw-text-amber-600">
                    These images could not be matched to any task boundary
                  </p>
                )}
              </div>
              <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                <span className="naxatw-rounded-full naxatw-bg-blue-100 naxatw-px-3 naxatw-py-1 naxatw-text-sm naxatw-font-medium naxatw-text-blue-800">
                  {group.image_count} {group.image_count === 1 ? 'image' : 'images'}
                </span>
              </div>
            </div>

            {/* Image Grid */}
            <div className="naxatw-grid naxatw-grid-cols-8 naxatw-gap-2">
              {group.images.map((image) => (
                <div
                  key={image.id}
                  className="naxatw-group naxatw-relative naxatw-aspect-square naxatw-cursor-pointer naxatw-overflow-hidden naxatw-rounded naxatw-border naxatw-border-gray-200 naxatw-transition-all hover:naxatw-border-blue-500 hover:naxatw-shadow-md"
                  onClick={() => handleImageClick(image.url || image.thumbnail_url || '', image.filename)}
                  title={image.filename}
                >
                  <img
                    src={image.thumbnail_url || image.url}
                    alt={image.filename}
                    className="naxatw-h-full naxatw-w-full naxatw-object-cover"
                    loading="lazy"
                  />
                  <div className="naxatw-absolute naxatw-inset-0 naxatw-bg-black naxatw-opacity-0 naxatw-transition-opacity group-hover:naxatw-opacity-10" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Full Image Modal */}
      {selectedImage && (
        <div
          className="naxatw-fixed naxatw-inset-0 naxatw-z-[9999] naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black naxatw-bg-opacity-75"
          onClick={closeModal}
        >
          <div className="naxatw-relative naxatw-max-h-[90vh] naxatw-max-w-[90vw]">
            <button
              className="naxatw-absolute naxatw-right-4 naxatw-top-4 naxatw-rounded-full naxatw-bg-white naxatw-p-2 naxatw-text-gray-800 naxatw-shadow-lg hover:naxatw-bg-gray-100"
              onClick={closeModal}
            >
              <span className="material-icons">close</span>
            </button>
            <img
              src={selectedImage.url}
              alt={selectedImage.filename}
              className="naxatw-max-h-[90vh] naxatw-max-w-[90vw] naxatw-rounded naxatw-object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="naxatw-absolute naxatw-bottom-4 naxatw-left-4 naxatw-rounded naxatw-bg-black naxatw-bg-opacity-75 naxatw-px-4 naxatw-py-2 naxatw-text-white">
              {selectedImage.filename}
            </div>
          </div>
        </div>
      )}
    </FlexColumn>
  );
};

export default ImageReview;
