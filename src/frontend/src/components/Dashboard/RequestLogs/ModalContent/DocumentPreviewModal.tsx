import DocViewer, { DocViewerRenderers } from '@cyntler/react-doc-viewer';
import { setCommonState } from '@Store/actions/common';
import { useTypedSelector } from '@Store/hooks';
import { useEffect } from 'react';
import { useDispatch } from 'react-redux';

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
