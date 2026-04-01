import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import qrcode from 'qrcode-generator';
import Modal from '@Components/common/Modal';
import { Button } from '@Components/RadixComponents/Button';
import { generateQFieldProject, getQFieldProjectStatus } from '@Services/qfield';

interface QFieldExportDialogProps {
  show: boolean;
  onClose: () => void;
  projectId: string;
}

function QFieldExportDialog({ show, onClose, projectId }: QFieldExportDialogProps) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'generating' | 'ready'>('idle');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkExisting = useCallback(async () => {
    if (!projectId) return;
    setStatus('checking');
    setError(null);
    try {
      const res = await getQFieldProjectStatus(projectId);
      if (res.data?.exists && res.data?.url) {
        setDownloadUrl(res.data.url);
        setStatus('ready');
      } else {
        setStatus('idle');
      }
    } catch {
      setStatus('idle');
    }
  }, [projectId]);

  useEffect(() => {
    if (show) {
      checkExisting();
    } else {
      setStatus('idle');
      setDownloadUrl(null);
      setError(null);
    }
  }, [show, checkExisting]);

  const handleGenerate = async () => {
    setStatus('generating');
    setError(null);
    try {
      await generateQFieldProject(projectId);
      toast.success('QField project generation started');
      // Poll for completion
      const pollInterval = setInterval(async () => {
        try {
          const res = await getQFieldProjectStatus(projectId);
          if (res.data?.exists && res.data?.url) {
            clearInterval(pollInterval);
            setDownloadUrl(res.data.url);
            setStatus('ready');
          }
        } catch {
          // keep polling
        }
      }, 3000);
      // Stop polling after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setStatus((prev) => {
          if (prev === 'generating') {
            setError('Generation is taking longer than expected. Please check back later.');
            return 'idle';
          }
          return prev;
        });
      }, 300000);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to start generation');
      setStatus('idle');
      toast.error('Failed to generate QField project');
    }
  };

  const qfieldUrl = downloadUrl
    ? `qfield://local?import=${downloadUrl}`
    : null;

  const qrSvg = useMemo(() => {
    if (!qfieldUrl) return null;
    const qr = qrcode(0, 'M');
    qr.addData(qfieldUrl);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  }, [qfieldUrl]);

  return (
    <Modal show={show} title="Export for QField" onClose={onClose} zIndex={111111}>
      <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-4 naxatw-p-4">
        {status === 'checking' && (
          <div className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-text-gray-500">
            <span className="material-icons naxatw-animate-spin naxatw-text-[1.25rem]">refresh</span>
            Checking for existing project...
          </div>
        )}

        {status === 'idle' && (
          <>
            <p className="naxatw-text-center naxatw-text-sm naxatw-text-gray-600">
              Generate a QField-ready project with task boundaries and the
              flightplan plugin for offline field use.
            </p>
            {error && (
              <p className="naxatw-text-center naxatw-text-sm naxatw-text-red">{error}</p>
            )}
            <Button
              className="naxatw-bg-[#D73F3F] naxatw-text-white"
              onClick={handleGenerate}
            >
              Generate QField Project
            </Button>
          </>
        )}

        {status === 'generating' && (
          <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-3">
            <span className="material-icons naxatw-animate-spin naxatw-text-[2rem] naxatw-text-[#D73F3F]">refresh</span>
            <p className="naxatw-text-sm naxatw-text-gray-600">
              Generating QField project...
            </p>
            <p className="naxatw-text-xs naxatw-text-gray-400">
              This may take a minute
            </p>
          </div>
        )}

        {status === 'ready' && qrSvg && (
          <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-4">
            <p className="naxatw-text-center naxatw-text-sm naxatw-text-gray-600">
              Scan this QR code with your device to open the project in QField.
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
                  if (downloadUrl) window.open(downloadUrl, '_blank');
                }}
              >
                Download ZIP
              </Button>
              <Button
                className="naxatw-bg-[#D73F3F] naxatw-text-sm naxatw-text-white"
                onClick={handleGenerate}
              >
                Regenerate
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default QFieldExportDialog;
