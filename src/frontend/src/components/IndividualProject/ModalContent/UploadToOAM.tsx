import Skeleton from "@Components/RadixComponents/Skeleton";
import { getOAMUploadDetails, startOAMUpload } from "@Services/project";
import { toggleModal } from "@Store/actions/common";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";
import { m } from "@/paraglide/messages";

type OAMLink = {
  item_id: string;
  browser_url: string;
  api_url: string;
};

type OAMHandoff = {
  project_id: string;
  external_id: string;
  status: string;
  prefill: {
    title: string;
    provider: string;
    platform: string;
    license: string;
    acquisition_start: string;
    acquisition_end: string;
    sensor?: string | null;
  };
  source_host: string;
  uploader_url: string;
  catalogue_url: string;
  link?: OAMLink | null;
  legacy_publication: boolean;
  warnings: string[];
};

const formatDateRange = (start: string, end: string) => {
  const from = start.slice(0, 10);
  const to = end.slice(0, 10);
  return from === to ? from : `${from} - ${to}`;
};

const ReviewRow = ({ label, value }: { label: string; value: string }) => (
  <div className="naxatw-flex naxatw-gap-2 naxatw-text-sm">
    <p className="naxatw-w-[150px] naxatw-flex-shrink-0 naxatw-text-gray-500">{label}</p>
    <p className="naxatw-break-all naxatw-font-medium naxatw-text-gray-800">{value}</p>
  </div>
);

const ExternalLink = ({ href, label }: { href: string; label: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="naxatw-flex naxatw-items-center naxatw-gap-1 naxatw-text-sm naxatw-text-blue-700 naxatw-underline-offset-2 hover:naxatw-underline"
  >
    {label}
    <i className="material-icons naxatw-text-base">open_in_new</i>
  </a>
);

const UploadToOAM = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const projectId = window.location.pathname?.split("/")?.[2];
  const [republishLegacy, setRepublishLegacy] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["oam-upload", projectId],
    queryFn: () => getOAMUploadDetails(projectId),
    select: (response: Record<string, any>) => response?.data as OAMHandoff,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Publication reconciliation makes the cached project stale.
  const publishedItemId = data?.link?.item_id;
  useEffect(() => {
    if (publishedItemId) {
      queryClient.invalidateQueries({ queryKey: ["project-detail", projectId] });
    }
  }, [publishedItemId, projectId, queryClient]);

  // Do not await this before navigation, which would trigger popup blocking.
  const { mutate: recordHandoff } = useMutation({
    mutationFn: () => startOAMUpload(projectId, republishLegacy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-detail", projectId] });
    },
    onError: () => {
      toast.warning(m.individual_project_oam_status_not_recorded());
    },
  });

  if (isLoading) {
    return <Skeleton className="naxatw-h-48 naxatw-bg-gray-100" />;
  }

  if (isError || !data) {
    const status = (error as Record<string, any>)?.response?.status;
    return (
      <p className="naxatw-text-sm naxatw-text-red">
        {status === 404
          ? m.individual_project_oam_no_orthophoto()
          : m.individual_project_oam_load_failed()}
      </p>
    );
  }

  if (data.link) {
    return (
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
        <div className="naxatw-flex naxatw-items-start naxatw-gap-2 naxatw-rounded-lg naxatw-border naxatw-border-green-200 naxatw-bg-green-50 naxatw-p-3">
          <i className="material-icons naxatw-text-green-700">check_circle</i>
          <div>
            <p className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-800">
              {m.individual_project_oam_published_title()}
            </p>
            <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-600">
              {m.individual_project_oam_published_desc()}
            </p>
          </div>
        </div>
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
          <ReviewRow label={m.individual_project_oam_item_id()} value={data.link.item_id} />
          <ReviewRow label={m.individual_project_oam_external_id()} value={data.external_id} />
        </div>
        <div className="naxatw-flex naxatw-flex-wrap naxatw-gap-4">
          <ExternalLink
            href={data.link.browser_url}
            label={m.individual_project_oam_view_in_browser()}
          />
          <ExternalLink href={data.link.api_url} label={m.individual_project_oam_view_in_api()} />
        </div>
      </div>
    );
  }

  const { prefill } = data;
  const awaiting = data.status === "UPLOADING";
  const blockedByLegacy = data.legacy_publication && !republishLegacy;

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-4">
      <div>
        <h3 className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-800">
          {m.individual_project_oam_review_title()}
        </h3>
        <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-500">
          {m.individual_project_oam_review_desc()}
        </p>
      </div>

      <div className="naxatw-flex naxatw-flex-col naxatw-gap-1 naxatw-rounded-lg naxatw-border naxatw-border-gray-200 naxatw-p-3">
        <ReviewRow label={m.individual_project_oam_field_title()} value={prefill.title} />
        <ReviewRow label={m.individual_project_oam_field_provider()} value={prefill.provider} />
        <ReviewRow
          label={m.individual_project_oam_field_acquisition()}
          value={formatDateRange(prefill.acquisition_start, prefill.acquisition_end)}
        />
        <ReviewRow label={m.individual_project_oam_field_license()} value={prefill.license} />
        {prefill.sensor && (
          <ReviewRow label={m.individual_project_oam_field_sensor()} value={prefill.sensor} />
        )}
        <ReviewRow label={m.individual_project_oam_field_source()} value={data.source_host} />
        <ReviewRow label={m.individual_project_oam_external_id()} value={data.external_id} />
      </div>

      {data.warnings.length > 0 && (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-1 naxatw-rounded-lg naxatw-border naxatw-border-amber-200 naxatw-bg-amber-50 naxatw-p-3">
          <p className="naxatw-text-xs naxatw-font-semibold naxatw-text-amber-800">
            {m.individual_project_oam_check_before_publish()}
          </p>
          <ul className="naxatw-list-disc naxatw-pl-4">
            {data.warnings.map((warning) => (
              <li key={warning} className="naxatw-text-xs naxatw-text-amber-800">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.legacy_publication && (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-2 naxatw-rounded-lg naxatw-border naxatw-border-amber-300 naxatw-bg-amber-50 naxatw-p-3">
          <p className="naxatw-text-xs naxatw-font-semibold naxatw-text-amber-900">
            {m.individual_project_oam_legacy_title()}
          </p>
          <p className="naxatw-text-xs naxatw-text-amber-800">
            {m.individual_project_oam_legacy_desc()}
          </p>
          <ExternalLink
            href={data.catalogue_url}
            label={m.individual_project_oam_legacy_search()}
          />
          <button
            type="button"
            className="naxatw-self-start naxatw-text-xs naxatw-text-amber-900 naxatw-underline naxatw-underline-offset-2"
            onClick={() => setRepublishLegacy((previous) => !previous)}
          >
            {republishLegacy
              ? m.individual_project_oam_legacy_cancel()
              : m.individual_project_oam_legacy_confirm()}
          </button>
        </div>
      )}

      {awaiting && (
        <div className="naxatw-rounded-lg naxatw-border naxatw-border-blue-200 naxatw-bg-blue-50 naxatw-p-3">
          <p className="naxatw-text-xs naxatw-text-gray-700">
            {m.individual_project_oam_awaiting_desc()}
          </p>
          <button
            type="button"
            className="naxatw-mt-2 naxatw-text-xs naxatw-text-blue-700 naxatw-underline-offset-2 hover:naxatw-underline disabled:naxatw-text-gray-400"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {m.individual_project_oam_check_again()}
          </button>
        </div>
      )}

      <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-2">
        <p className="naxatw-text-center naxatw-text-xs naxatw-text-gray-500">
          {m.individual_project_oam_signed_in_note()}
        </p>
        {!blockedByLegacy && (
          <a
            href={data.uploader_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              recordHandoff();
              dispatch(toggleModal());
            }}
            className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-rounded naxatw-bg-red naxatw-px-8 naxatw-py-2 naxatw-text-sm naxatw-font-medium naxatw-text-white"
          >
            <i className="material-icons naxatw-text-base">open_in_new</i>
            {awaiting
              ? m.individual_project_oam_reopen_button()
              : m.individual_project_oam_confirm_button()}
          </a>
        )}
      </div>
    </div>
  );
};

export default UploadToOAM;
