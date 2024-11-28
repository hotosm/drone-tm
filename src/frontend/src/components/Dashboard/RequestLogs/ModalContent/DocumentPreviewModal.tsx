import DocViewer, { DocViewerRenderers } from '@cyntler/react-doc-viewer';
import { setCommonState } from '@Store/actions/common';
import { useTypedSelector } from '@Store/hooks';
import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';

const DocumentPreviewModal = () => {
  const dispatch = useDispatch();
  const documentDetails = useTypedSelector(
    state => state.common.selectedDocumentDetails,
  );

  useEffect(() => {
    return () => {
      dispatch(setCommonState({ selectedDocumentDetails: null }));
    };
  }, [dispatch]);

  const downloadFile = () => {
    fetch(`${documentDetails?.uri}`, {
      method: 'GET',
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Network response was ${response.statusText}`);
        }
        return response.blob();
      })
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `certificate.${documentDetails?.fileType}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(error =>
        toast.error(`There wan an error while downloading file
        ${error}`),
      );
  };

  return (
    <div className="naxatw-relative naxatw-h-full naxatw-w-full naxatw-bg-white naxatw-pt-10">
      {documentDetails?.fileType !== 'pdf' && (
        <div className="naxatw-absolute naxatw-right-0 naxatw-top-0 naxatw-flex naxatw-w-full naxatw-justify-end naxatw-bg-white naxatw-px-4 naxatw-py-3 naxatw-shadow-2xl">
          <div
            className="material-icons-outlined naxatw-cursor-pointer"
            onClick={() => downloadFile()}
            tabIndex={0}
            onKeyDown={() => {}}
            role="button"
            title="download"
          >
            cloud_download
          </div>
        </div>
      )}

      {documentDetails && (
        <DocViewer
          documents={[documentDetails]}
          pluginRenderers={DocViewerRenderers}
          config={{ header: { disableHeader: true } }}
        />
      )}
    </div>
  );
};

export default DocumentPreviewModal;
