/* eslint-disable no-nested-ternary */
import { useMemo } from "react";
import { toast } from "react-toastify";
import { useDispatch } from "react-redux";
import { Button } from "@Components/RadixComponents/Button";
import { descriptionItems, finalOutputLabels } from "@Constants/projectDescription";
import { toggleModal } from "@Store/actions/common";
import { useGetUserDetailsQuery } from "@Api/projects";
import Skeleton from "@Components/RadixComponents/Skeleton";
import { formatString, buildDownloadUrl, gsdToAltitude, altitudeToGsd } from "@Utils/index";
import ApprovalSection from "./ApprovalSection";

const statusAfterImageUploaded = [
  "READY_FOR_PROCESSING",
  "IMAGE_PROCESSING_FAILED",
  "IMAGE_PROCESSING_STARTED",
  "IMAGE_PROCESSING_FINISHED",
];

type DescriptionDataType = (typeof descriptionItems)[number]["expectedDataType"];

const hasDescriptionValue = (value: unknown, dataType: DescriptionDataType) => {
  if (dataType === "boolean") return typeof value === "boolean";
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
};

const formatNumber = (value: unknown, decimalPlaces: number) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value);
  return numericValue.toFixed(decimalPlaces).replace(/\.?0+$/, "");
};

const formatDate = (value: unknown) => {
  const dateValue = new Date(String(value));
  if (Number.isNaN(dateValue.getTime())) return String(value);

  return dateValue.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const formatDescriptionValue = (value: unknown, dataType: DescriptionDataType) => {
  if (dataType === "boolean") return value ? "Yes" : "No";
  if (dataType === "double") return formatNumber(value, 3);
  if (dataType === "number") return formatNumber(value, 2);
  if (dataType === "array") return Array.isArray(value) ? value.length : String(value);
  if (dataType === "date") return formatDate(value);
  if (dataType === "finalOutput") {
    const outputs = Array.isArray(value) ? value : [value];
    return outputs
      .map((output) => finalOutputLabels[String(output)] || formatString(String(output)))
      .join(", ");
  }
  return String(value);
};

const getDescriptionValue = (projectData: Record<string, any>, key: string) => {
  if (key === "gsd_cm_px") {
    if (projectData?.gsd_cm_px !== undefined && projectData?.gsd_cm_px !== null) {
      return projectData.gsd_cm_px;
    }

    const altitude = Number(projectData?.altitude_from_ground);
    return Number.isFinite(altitude) && altitude > 0 ? altitudeToGsd(altitude) : null;
  }

  if (key === "flight_altitude") {
    if (
      projectData?.altitude_from_ground !== undefined &&
      projectData?.altitude_from_ground !== null
    ) {
      return projectData.altitude_from_ground;
    }

    const gsd = Number(projectData?.gsd_cm_px);
    return Number.isFinite(gsd) && gsd > 0 ? gsdToAltitude(gsd) : null;
  }

  return projectData?.[key];
};

const DescriptionSection = ({
  page = "project-approval",
  projectData,
  isProjectDataLoading = false,
  onOpenUpload,
  onOpenClassify,
  onOpenVerify,
  onOpenWorkflow,
}: {
  projectData: Record<string, any>;
  page?: "project-description" | "project-approval";
  isProjectDataLoading?: boolean;
  onOpenUpload?: () => void;
  onOpenClassify?: () => void;
  onOpenVerify?: () => void;
  onOpenWorkflow?: () => void;
}) => {
  const dispatch = useDispatch();

  const { data: userDetails }: Record<string, any> = useGetUserDetailsQuery();

  // know if any of the task is completed (assets_url) is the key that provides the final results of a task OR any of the task's status is the image uploaded or next step
  const isAbleToStartProcessing = useMemo(
    () =>
      projectData?.tasks?.some(
        (task: Record<string, any>) =>
          task?.assets_url || statusAfterImageUploaded.includes(task?.state),
      ),
    [projectData?.tasks],
  );

  const handleDownloadFile = (url: string, filename: string) => {
    try {
      const link = document.createElement("a");
      link.href = buildDownloadUrl(url);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error(`There was an error while downloading the file: ${error}`);
    }
  };

  if (isProjectDataLoading)
    return (
      <div className="naxatw-py-4">
        <Skeleton className="naxatw-h-64 naxatw-bg-gray-100" />
      </div>
    );

  return (
    <div className="naxatw-mt-4 naxatw-flex naxatw-flex-col naxatw-gap-3">
      {page === "project-approval" && (
        <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
          Description
        </p>
      )}
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-3 naxatw-text-sm">
        <p>{projectData?.description || ""}</p>
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
          {projectData?.id && (
            <div className="naxatw-flex naxatw-gap-2">
              <p className="naxatw-w-[146px]">Project ID</p>
              <p>:</p>
              <p className="naxatw-font-semibold">{projectData.id}</p>
            </div>
          )}
          {descriptionItems.map((descriptionItem) => {
            const dataType = descriptionItem.expectedDataType;
            const value = getDescriptionValue(projectData, descriptionItem.key);
            if (hasDescriptionValue(value, dataType)) {
              const unit = descriptionItem?.unit || descriptionItem?.unite || "";
              return (
                <div className="naxatw-flex naxatw-gap-2" key={descriptionItem.key}>
                  <p className="naxatw-w-[146px]">{descriptionItem.label}</p>
                  <p>:</p>
                  <p className="naxatw-font-semibold">
                    {formatDescriptionValue(value, dataType)} {unit}
                  </p>
                </div>
              );
            }
            return null;
          })}

          {(projectData?.oam_upload_status === "UPLOADING" ||
            projectData?.oam_upload_status === "FAILED" ||
            projectData?.oam_upload_status === "UPLOADED") && (
            <div className="naxatw-flex naxatw-gap-2">
              <p className="naxatw-w-[146px]">Uploaded to OAM</p>
              <p>:</p>
              <p className="naxatw-font-semibold">{formatString(projectData?.oam_upload_status)}</p>
            </div>
          )}
        </div>
      </div>

      {page === "project-description" && (onOpenUpload || onOpenWorkflow) && (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3 naxatw-mt-2">
          <p className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-800">
            Imagery Workflow
          </p>

          {/* Step 1: Upload Imagery */}
          <button
            className="naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-rounded-lg naxatw-border naxatw-border-gray-200 naxatw-bg-white naxatw-p-3 naxatw-text-left naxatw-transition-all hover:naxatw-border-red-300 hover:naxatw-bg-red-50"
            onClick={onOpenUpload || onOpenWorkflow}
          >
            <div className="naxatw-flex naxatw-h-8 naxatw-w-8 naxatw-flex-shrink-0 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-bg-red naxatw-text-sm naxatw-font-bold naxatw-text-white">
              1
            </div>
            <div className="naxatw-flex-1">
              <p className="naxatw-text-sm naxatw-font-medium naxatw-text-gray-900">
                Upload Imagery
              </p>
              <p className="naxatw-text-xs naxatw-text-gray-500">
                Upload drone images to the project
              </p>
            </div>
            <span className="material-icons naxatw-text-gray-400">chevron_right</span>
          </button>

          {/* Step 2: Classify Imagery */}
          <button
            className={`naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-rounded-lg naxatw-border naxatw-p-3 naxatw-text-left naxatw-transition-all ${
              onOpenClassify
                ? "naxatw-border-gray-200 naxatw-bg-white hover:naxatw-border-red-300 hover:naxatw-bg-red-50"
                : "naxatw-border-gray-100 naxatw-bg-gray-50 naxatw-cursor-not-allowed naxatw-opacity-60"
            }`}
            onClick={onOpenClassify}
            disabled={!onOpenClassify}
          >
            <div
              className={`naxatw-flex naxatw-h-8 naxatw-w-8 naxatw-flex-shrink-0 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-text-sm naxatw-font-bold naxatw-text-white ${onOpenClassify ? "naxatw-bg-red" : "naxatw-bg-gray-400"}`}
            >
              2
            </div>
            <div className="naxatw-flex-1">
              <p className="naxatw-text-sm naxatw-font-medium naxatw-text-gray-900">
                Classify Imagery
              </p>
              <p className="naxatw-text-xs naxatw-text-gray-500">
                Classify quality and assign to tasks
              </p>
            </div>
            <span className="material-icons naxatw-text-gray-400">chevron_right</span>
          </button>

          {/* Step 3: Verify Imagery */}
          <button
            className={`naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-rounded-lg naxatw-border naxatw-p-3 naxatw-text-left naxatw-transition-all ${
              onOpenVerify
                ? "naxatw-border-gray-200 naxatw-bg-white hover:naxatw-border-red-300 hover:naxatw-bg-red-50"
                : "naxatw-border-gray-100 naxatw-bg-gray-50 naxatw-cursor-not-allowed naxatw-opacity-60"
            }`}
            onClick={onOpenVerify}
            disabled={!onOpenVerify}
          >
            <div
              className={`naxatw-flex naxatw-h-8 naxatw-w-8 naxatw-flex-shrink-0 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-text-sm naxatw-font-bold naxatw-text-white ${onOpenVerify ? "naxatw-bg-red" : "naxatw-bg-gray-400"}`}
            >
              3
            </div>
            <div className="naxatw-flex-1">
              <p className="naxatw-text-sm naxatw-font-medium naxatw-text-gray-900">
                Verify Imagery
              </p>
              <p className="naxatw-text-xs naxatw-text-gray-500">
                Review on map, mark tasks as fully flown
              </p>
            </div>
            <span className="material-icons naxatw-text-gray-400">chevron_right</span>
          </button>

          {/* Step 4: Processing */}
          <button
            className={`naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-rounded-lg naxatw-border naxatw-p-3 naxatw-text-left naxatw-transition-all ${
              isAbleToStartProcessing
                ? "naxatw-border-gray-200 naxatw-bg-white hover:naxatw-border-red-300 hover:naxatw-bg-red-50"
                : "naxatw-border-gray-100 naxatw-bg-gray-50 naxatw-cursor-not-allowed naxatw-opacity-60"
            }`}
            onClick={() => isAbleToStartProcessing && dispatch(toggleModal("processing-status"))}
            disabled={!isAbleToStartProcessing}
          >
            <div
              className={`naxatw-flex naxatw-h-8 naxatw-w-8 naxatw-flex-shrink-0 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-text-sm naxatw-font-bold naxatw-text-white ${isAbleToStartProcessing ? "naxatw-bg-red" : "naxatw-bg-gray-400"}`}
            >
              4
            </div>
            <div className="naxatw-flex-1">
              <p className="naxatw-text-sm naxatw-font-medium naxatw-text-gray-900">Processing</p>
              <p className="naxatw-text-xs naxatw-text-gray-500">
                Start ODM processing and monitor task status
              </p>
            </div>
            <span className="material-icons naxatw-text-gray-400">chevron_right</span>
          </button>
        </div>
      )}

      {page !== "project-approval" &&
        (!projectData?.requires_approval_from_regulator ||
          projectData?.regulator_approval_status === "APPROVED") &&
        isAbleToStartProcessing && (
          <div className="naxatw-flex naxatw-flex-wrap naxatw-gap-2">
            {projectData?.image_processing_status === "SUCCESS" && (
              <>
                <p className="naxatw-w-full naxatw-text-xs naxatw-font-semibold naxatw-uppercase naxatw-tracking-wide naxatw-text-gray-500">
                  Downloads
                </p>
                {projectData?.orthophoto_url && (
                  <Button
                    variant="outline"
                    className="naxatw-border-red naxatw-text-red"
                    leftIcon="download"
                    onClick={() =>
                      handleDownloadFile(
                        projectData.orthophoto_url,
                        `orthophoto_${projectData.id}.tif`,
                      )
                    }
                  >
                    Orthophoto (.tif)
                  </Button>
                )}
                {projectData?.dem_url && (
                  <Button
                    variant="outline"
                    className="naxatw-border-red naxatw-text-red"
                    leftIcon="download"
                    onClick={() =>
                      handleDownloadFile(projectData.dem_url, `dem_${projectData.id}.tif`)
                    }
                  >
                    DEM (.tif)
                  </Button>
                )}
                {projectData?.pointcloud_url && (
                  <Button
                    variant="outline"
                    className="naxatw-border-red naxatw-text-red"
                    leftIcon="download"
                    onClick={() =>
                      handleDownloadFile(
                        projectData.pointcloud_url,
                        `pointcloud_${projectData.id}.laz`,
                      )
                    }
                  >
                    Point Cloud (.laz)
                  </Button>
                )}
                {String(projectData?.author_id || "") === String(userDetails?.id || "") &&
                  projectData?.orthophoto_url && (
                    <>
                      {projectData?.oam_upload_status === "NOT_STARTED" ? (
                        <Button
                          className="naxatw-bg-red"
                          withLoader
                          leftIcon="upload"
                          onClick={() => {
                            dispatch(toggleModal("upload-to-oam"));
                          }}
                        >
                          Upload to OAM
                        </Button>
                      ) : projectData?.oam_upload_status === "FAILED" ? (
                        <Button
                          className="naxatw-bg-red"
                          withLoader
                          leftIcon="upload"
                          onClick={() => {
                            dispatch(toggleModal("upload-to-oam"));
                          }}
                        >
                          Re-upload to OAM
                        </Button>
                      ) : null}
                    </>
                  )}
              </>
            )}

            {projectData?.image_processing_status === "PROCESSING" && (
              <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-text-sm naxatw-text-gray-600">
                  <span className="material-icons naxatw-animate-spin !naxatw-text-base">sync</span>
                  <span>Imagery processing in progress...</span>
                </div>
                <p className="naxatw-text-xs naxatw-text-gray-400">
                  Download and upload options will be available once processing is complete.
                </p>
              </div>
            )}
          </div>
        )}

      {page === "project-approval" && projectData?.regulator_approval_status === "PENDING" && (
        <ApprovalSection />
      )}
    </div>
  );
};

export default DescriptionSection;
