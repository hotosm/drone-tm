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
  classified_at?: string;
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
  status: 'assigned' | 'rejected' | 'invalid_exif' | 'duplicate' | 'unmatched';
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
 * Manually assign an image to a task, bypassing GPS-based matching
 */
export const assignImageToTask = async (
  projectId: string,
  imageId: string,
  taskId: string,
): Promise<{ message: string; image_id: string; status: string; task_id: string }> => {
  const response = await authenticated(api).post(
    `/projects/${projectId}/images/${imageId}/assign-task/`,
    { task_id: taskId },
    { headers: { 'Content-Type': 'application/json' } },
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

/**
 * Ingest existing S3 uploads — enqueues a background job to scan user-uploads/
 * and process any files not yet tracked in the database.
 */
export const ingestExistingUploads = async (
  projectId: string,
): Promise<{ message: string; job_id: string; project_id: string; batch_id: string }> => {
  const response = await authenticated(api).post(
    `/projects/${projectId}/ingest-uploads/`,
    {},
    { headers: { 'Content-Type': 'application/json' } },
  );
  return response.data;
};

// ─── Project-scoped classification endpoints ────────────────────────────────

/**
 * Start classification job for all staged images in a project (across batches)
 */
export const startProjectClassification = async (
  projectId: string,
): Promise<{ job_id: string; message: string; project_id: string; image_count: number }> => {
  const response = await authenticated(api).post(
    `/projects/${projectId}/classify/`,
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
 * Get project imagery status summary (counts by status, across all batches)
 */
export const getProjectStatus = async (
  projectId: string,
): Promise<BatchStatusSummary & { project_id: string }> => {
  const response = await authenticated(api).get(
    `/projects/${projectId}/imagery/status/`,
  );
  return response.data;
};

/**
 * Get all images for a project (across all batches), with incremental polling
 */
export const getProjectImages = async (
  projectId: string,
  since?: string,
  statusFilter?: string[],
): Promise<ImageClassificationResult[]> => {
  const params: Record<string, any> = {};
  if (since) params.last_timestamp = since;
  if (statusFilter?.length) params.status = statusFilter;
  const response = await authenticated(api).get(
    `/projects/${projectId}/imagery/images/`,
    { params, paramsSerializer: { indexes: null } },
  );
  return response.data.images || response.data;
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
  failure_reason?: string | null;
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

export interface FlightGapDetectionData {
  task_id: string;
  message: string;
  task_geometry: GeoJSON.Feature;
  gap_polygons: GeoJSON.FeatureCollection;
  gap_type: string;
  drone_type: string | null;
  altitude: number | null;
  rotation: number | null;
  overlap: number | null;
  images: GeoJSON.FeatureCollection;
  flightplan_url: string | null;
}

export interface FlightGapDetectionRequest {
  manualGapPolygons?: GeoJSON.FeatureCollection | null;
  droneType?: string | null;
}

export const getFlightGapDetectionData = async (
  projectId: string,
  taskId: string,
  request: FlightGapDetectionRequest = {},
): Promise<FlightGapDetectionData> => {
  const response = await authenticated(api).post(
    `/projects/${projectId}/imagery/task/${taskId}/find-gaps/`,
    {
      manual_gap_polygons: request.manualGapPolygons ?? null,
      drone_type: request.droneType ?? null,
    },
    {
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
  return response.data;
};

export interface FlightGapGenerationPlan {
  manualGapPolygons?: GeoJSON.FeatureCollection | null;
  gapType?: string | null;
  droneType?: string | null;
  altitude?: number | null;
  rotation?: number | null;
  overlap?: number | null;
}

export const downloadFlightGapGenerationPlan = async (
  projectId: string,
  taskId: string,
  request: FlightGapGenerationPlan = {},
): Promise<Blob> => {
  const response = await authenticated(api).post(
    `/projects/${projectId}/imagery/task/${taskId}/generate-flightplan/`,
    {
      manual_gap_polygons: request.manualGapPolygons ?? null,
      gap_type: request.gapType ?? null,
      drone_type: request.droneType ?? null,
      altitude: request.altitude ?? null,
      rotation: request.rotation ?? null,
      overlap: request.overlap ?? null
    },
    { responseType: 'blob',
      headers: { 'Content-Type': 'application/json' }
    }
  );
  return response.data;
};
