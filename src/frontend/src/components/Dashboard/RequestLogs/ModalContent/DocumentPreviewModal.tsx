import DocViewer, { DocViewerRenderers } from '@cyntler/react-doc-viewer';
import { useTypedSelector } from '@Store/hooks';

const DocumentPreviewModal = () => {
  const documentDetails = useTypedSelector(
    state => state.common.selectedDocumentDetails,
  );

  return (
    <div className="naxatw-h-full naxatw-w-full">
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
