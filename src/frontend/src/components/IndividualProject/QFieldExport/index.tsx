import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import qrcode from "qrcode-generator";
import Modal from "@Components/common/Modal";
import { Button } from "@Components/RadixComponents/Button";
import { generateQFieldProject, getQFieldProjectStatus } from "@Services/qfield";
import { m } from "@/paraglide/messages";

interface QFieldExportDialogProps {
  show: boolean;
  onClose: () => void;
  projectId: string;
}

function QFieldExportDialog({ show, onClose, projectId }: QFieldExportDialogProps) {
  const [status, setStatus] = useState<"idle" | "checking" | "generating" | "ready">("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkExisting = useCallback(async () => {
    if (!projectId) return;
    setStatus("checking");
    setError(null);
    try {
      const res = await getQFieldProjectStatus(projectId);
      if (res.data?.exists && res.data?.url) {
        setDownloadUrl(res.data.url);
        setStatus("ready");
      } else {
        setStatus("idle");
      }
    } catch {
      setStatus("idle");
    }
  }, [projectId]);

  useEffect(() => {
    if (show) {
      checkExisting();
    } else {
      setStatus("idle");
      setDownloadUrl(null);
      setError(null);
    }
  }, [show, checkExisting]);

  const handleGenerate = async () => {
    setStatus("generating");
    setError(null);
    try {
      await generateQFieldProject(projectId);
      toast.success(m.qfield_generation_started());
      // Poll for completion
      const pollInterval = setInterval(async () => {
        try {
          const res = await getQFieldProjectStatus(projectId);
          if (res.data?.exists && res.data?.url) {
            clearInterval(pollInterval);
            setDownloadUrl(res.data.url);
            setStatus("ready");
          }
        } catch {
          // keep polling
        }
      }, 3000);
      // Stop polling after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setStatus((prev) => {
          if (prev === "generating") {
            setError(m.qfield_generation_taking_longer());
            return "idle";
          }
          return prev;
        });
      }, 300000);
    } catch (err: any) {
      setError(err?.response?.data?.detail || m.qfield_generation_start_failed());
      setStatus("idle");
      toast.error(m.qfield_generation_failed());
    }
  };

  const qfieldUrl = downloadUrl ? `qfield://local?import=${downloadUrl}` : null;

  const qrSvg = useMemo(() => {
    if (!qfieldUrl) return null;
    const qr = qrcode(0, "M");
    qr.addData(qfieldUrl);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  }, [qfieldUrl]);

  return (
    <Modal show={show} title={m.qfield_export_title()} onClose={onClose} zIndex={111111}>
      <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-4 naxatw-p-4">
        {status === "checking" && (
          <div className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-text-gray-500">
            <span className="material-icons naxatw-animate-spin naxatw-text-[1.25rem]">
              refresh
            </span>
            {m.qfield_checking_existing()}
          </div>
        )}

        {status === "idle" && (
          <>
            <p className="naxatw-text-center naxatw-text-sm naxatw-text-gray-600">
              {m.qfield_export_description()}
            </p>
            {error && <p className="naxatw-text-center naxatw-text-sm naxatw-text-red">{error}</p>}
            <Button className="naxatw-bg-[#D73F3F] naxatw-text-white" onClick={handleGenerate}>
              {m.qfield_generate_project()}
            </Button>
          </>
        )}

        {status === "generating" && (
          <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-3">
            <span className="material-icons naxatw-animate-spin naxatw-text-[2rem] naxatw-text-[#D73F3F]">
              refresh
            </span>
            <p className="naxatw-text-sm naxatw-text-gray-600">{m.qfield_generating_project()}</p>
            <p className="naxatw-text-xs naxatw-text-gray-400">
              {m.qfield_generation_may_take_minute()}
            </p>
          </div>
        )}

        {status === "ready" && qrSvg && (
          <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-4">
            <p className="naxatw-text-center naxatw-text-sm naxatw-text-gray-600">
              {m.qfield_scan_qr()}
            </p>
            <div
              className="naxatw-h-[200px] naxatw-w-[200px] naxatw-rounded-lg naxatw-border naxatw-p-2"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="naxatw-max-w-[280px] naxatw-break-all naxatw-text-center naxatw-text-xs naxatw-text-gray-400">
              {qfieldUrl}
            </p>
            <div className="naxatw-flex naxatw-gap-2">
              <Button
                variant="ghost"
                className="naxatw-border naxatw-text-sm"
                onClick={() => {
                  if (downloadUrl) window.open(downloadUrl, "_blank");
                }}
              >
                {m.qfield_download_zip()}
              </Button>
              <Button
                className="naxatw-bg-[#D73F3F] naxatw-text-sm naxatw-text-white"
                onClick={handleGenerate}
              >
                {m.qfield_regenerate()}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default QFieldExportDialog;
