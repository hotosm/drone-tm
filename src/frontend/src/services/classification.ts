import { authenticated, api } from './index';

export interface ImageClassificationResult {
  id: string;
  filename: string;
  status: 'staged' | 'uploaded' | 'classifying' | 'assigned' | 'rejected' | 'unmatched' | 'invalid_exif' | 'duplicate';
  task_id?: string;
  rejection_reason?: string;
  has_gps: boolean;
  s3_key: string;
  url?: string;
  thumbnail_url?: string;  // 200x200 thumbnail for grid display
  uploaded_at: string;
}

export interface BatchStatusSummary {
  total: number;
  staged: number;
  uploaded: number;
  classifying: number;
  assigned: number;
  rejected: number;
  unmatched: number;
  invalid_exif: number;
  duplicate: number;
}

export interface TaskGroupImage {
  id: string;
  filename: string;
  s3_key: string;
  thumbnail_url?: string;
  url?: string;
  status: 'assigned' | 'rejected' | 'invalid_exif';
  rejection_reason?: string;
  uploaded_at: string;
}

export interface TaskGroup {
  task_id: string | null;
  project_task_index: number | null;
  image_count: number;
  images: TaskGroupImage[];
}

export interface BatchReviewData {
  batch_id: string;
  task_groups: TaskGroup[];
  total_tasks: number;
  total_images: number;
}

/**
 * Start classification job for a batch of uploaded images
 */
export const startClassification = async (
  projectId: string,
  batchId: string,
): Promise<{ job_id: string; message: string }> => {
  const response = await authenticated(api).post(
    `/projects/${projectId}/classify-batch/?batch_id=${batchId}`,
    {},
    {
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
  return response.data;
};

/**
 * Get batch status summary (counts by status)
 */
export const getBatchStatus = async (
  projectId: string,
  batchId: string,
): Promise<BatchStatusSummary> => {
  const response = await authenticated(api).get(
    `/projects/${projectId}/batch/${batchId}/status/`,
  );
  return response.data;
};

/**
 * Poll for image updates in a batch (incremental updates)
 */
export const getBatchImages = async (
  projectId: string,
  batchId: string,
  since?: string,
): Promise<ImageClassificationResult[]> => {
  const params = since ? { last_timestamp: since } : {};
  const response = await authenticated(api).get(
    `/projects/${projectId}/batch/${batchId}/images/`,
    { params },
  );
  return response.data.images || response.data;
};

/**
 * Get batch review data grouped by tasks
 */
export const getBatchReview = async (
  projectId: string,
  batchId: string,
): Promise<BatchReviewData> => {
  const response = await authenticated(api).get(
    `/projects/${projectId}/batch/${batchId}/review/`,
  );
  return response.data;
};

/**
 * Accept a rejected image - assigns to task if within boundary, otherwise marks as unmatched
 */
export const acceptImage = async (
  projectId: string,
  imageId: string,
): Promise<{ message: string; image_id: string; status: string; task_id: string | null }> => {
  const response = await authenticated(api).post(
    `/projects/${projectId}/images/${imageId}/accept/`,
  );
  return response.data;
};

/**
 * Delete a batch and all its images from database and S3 storage
 */
export const deleteBatch = async (
  projectId: string,
  batchId: string,
): Promise<{ message: string; batch_id: string; job_id: string }> => {
  const response = await authenticated(api).delete(
    `/projects/${projectId}/batch/${batchId}/`,
  );
  return response.data;
};

export interface BatchMapData {
  batch_id: string;
  tasks: GeoJSON.FeatureCollection;
  images: GeoJSON.FeatureCollection;
  total_tasks: number;
  total_images: number;
}

/**
 * Get map data for batch review (task geometries and image point locations)
 */
export const getBatchMapData = async (
  projectId: string,
  batchId: string,
): Promise<BatchMapData> => {
  const response = await authenticated(api).get(
    `/projects/${projectId}/batch/${batchId}/map-data/`,
  );
  return response.data;
};
