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
  status: 'assigned' | 'rejected' | 'invalid_exif' | 'duplicate';
  rejection_reason?: string;
  uploaded_at: string;
}

export interface TaskGroup {
  task_id: string | null;
  project_task_index: number | null;
  image_count: number;
  images: TaskGroupImage[];
  is_verified?: boolean;
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
  options?: { waitForCleanup?: boolean },
): Promise<{ message: string; batch_id: string; job_id?: string; deleted_count?: number; deleted_s3_count?: number }> => {
  const response = await authenticated(api).delete(
    `/projects/${projectId}/batch/${batchId}/`,
    {
      params: options?.waitForCleanup ? { wait_for_cleanup: true } : undefined,
    },
  );
  return response.data;
};

export interface BatchMapData {
  batch_id: string;
  tasks: GeoJSON.FeatureCollection;
  images: GeoJSON.FeatureCollection;
  total_tasks: number;
  total_images: number;
  total_images_with_gps: number;
  total_images_without_gps: number;
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

export type TaskProcessingState =
  | 'IMAGE_UPLOADED'
  | 'IMAGE_PROCESSING_STARTED'
  | 'IMAGE_PROCESSING_FINISHED'
  | 'IMAGE_PROCESSING_FAILED';

export interface ProcessingTask {
  task_id: string;
  task_index: number;
  image_count: number;
  state: TaskProcessingState;
  failure_reason?: string | null;
}

export interface ProcessingSummary {
  batch_id: string;
  total_tasks: number;
  total_images: number;
  tasks: ProcessingTask[];
}

/**
 * Get processing summary for a batch - tasks and image counts ready for ODM
 */
export const getProcessingSummary = async (
  projectId: string,
  batchId: string,
): Promise<ProcessingSummary> => {
  const response = await authenticated(api).get(
    `/projects/${projectId}/batch/${batchId}/processing-summary/`,
  );
  return response.data;
};

/**
 * Finalize a batch - moves images to task folders WITHOUT triggering ODM.
 * Called when user clicks 'Finish' without processing.
 */
export const finalizeBatch = async (
  projectId: string,
  batchId: string,
): Promise<{ message: string; batch_id: string; total_moved: number; task_count: number }> => {
  const response = await authenticated(api).post(
    `/projects/${projectId}/batch/${batchId}/finalize/`,
  );
  return response.data;
};

/**
 * Start batch processing - moves images to task folders and triggers ODM
 */
export const startBatchProcessing = async (
  projectId: string,
  batchId: string,
): Promise<{ message: string; job_id: string; batch_id: string }> => {
  const response = await authenticated(api).post(
    `/projects/${projectId}/batch/${batchId}/process/`,
  );
  return response.data;
};

export interface TaskImageData {
  id: string;
  filename: string;
  s3_key: string;
  thumbnail_url?: string;
  url?: string;
  status: string;
  rejection_reason?: string;
  location?: {
    type: string;
    coordinates: [number, number];
  };
}

export interface TaskVerificationData {
  task_id: string;
  project_task_index: number;
  image_count: number;
  images: TaskImageData[];
  task_geometry: GeoJSON.Feature;
  coverage_percentage?: number;
  is_verified: boolean;
}

/**
 * Get task images and geometry for verification modal
 */
export const getTaskVerificationData = async (
  projectId: string,
  batchId: string,
  taskId: string,
): Promise<TaskVerificationData> => {
  const response = await authenticated(api).get(
    `/projects/${projectId}/batch/${batchId}/task/${taskId}/verification/`,
  );
  return response.data;
};

/**
 * Mark a task as verified (fully flown) after visual inspection
 */
export const markTaskAsVerified = async (
  projectId: string,
  taskId: string,
): Promise<{ message: string; task_id: string }> => {
  const response = await authenticated(api).post(
    `/projects/${projectId}/tasks/${taskId}/mark-verified/`,
  );
  return response.data;
};

/**
 * Delete an image from a task
 */
export const deleteTaskImage = async (
  projectId: string,
  imageId: string,
): Promise<{ message: string; image_id: string }> => {
  const response = await authenticated(api).delete(
    `/projects/${projectId}/images/${imageId}/`,
  );
  return response.data;
};

// ─── Project-level (task-centric) endpoints ─────────────────────────────────

export interface TaskImagerySummary {
  task_id: string;
  project_task_index: number;
  task_state: string;
  total_images: number;
  assigned_images: number;
  rejected_images: number;
  invalid_exif_images: number;
  duplicate_images: number;
  unmatched_images: number;
  latest_upload: string | null;
  has_ready_imagery: boolean;
}

export interface ProjectReviewData {
  project_id: string;
  task_groups: TaskGroup[];
  total_tasks: number;
  total_images: number;
}

export interface ProjectMapData {
  project_id: string;
  tasks: GeoJSON.FeatureCollection;
  images: GeoJSON.FeatureCollection;
  total_tasks: number;
  total_images: number;
  total_images_with_gps: number;
  total_images_without_gps: number;
}

/**
 * Get per-task imagery summary aggregated across all batches
 */
export const getProjectTaskImagerySummary = async (
  projectId: string,
): Promise<TaskImagerySummary[]> => {
  const response = await authenticated(api).get(
    `/projects/${projectId}/imagery/tasks/`,
  );
  return response.data;
};

/**
 * Get project-level review data: images grouped by task across all batches
 */
export const getProjectReview = async (
  projectId: string,
): Promise<ProjectReviewData> => {
  const response = await authenticated(api).get(
    `/projects/${projectId}/imagery/review/`,
  );
  return response.data;
};

/**
 * Get project-level map data: task geometries + all image points across batches
 */
export const getProjectMapData = async (
  projectId: string,
): Promise<ProjectMapData> => {
  const response = await authenticated(api).get(
    `/projects/${projectId}/imagery/map-data/`,
  );
  return response.data;
};

/**
 * Get task verification data aggregated across all batches (no batch_id needed)
 */
export const getProjectTaskVerificationData = async (
  projectId: string,
  taskId: string,
): Promise<TaskVerificationData> => {
  const response = await authenticated(api).get(
    `/projects/${projectId}/imagery/task/${taskId}/verification/`,
  );
  return response.data;
};
