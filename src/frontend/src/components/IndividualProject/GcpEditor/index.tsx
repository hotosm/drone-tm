import { useEffect, createElement, useRef } from 'react';
import '@hotosm/gcp-editor';
import '@hotosm/gcp-editor/style.css';
import { useDispatch } from 'react-redux';
import { setProjectState } from '@Store/actions/project';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { processAllImagery } from '@Services/project';
import { useParams } from 'react-router-dom';
import { toast } from 'react-toastify';

const GcpEditor = ({
  cogUrl,
  finalButtonText,
  //   handleProcessingStart,
  rawImageUrl,
}: any) => {
  const triggeredEvent = useRef(false);
  const { id } = useParams();
  const dispatch = useDispatch();
  const CUSTOM_EVENT: any = 'start-processing-click';
  const queryClient = useQueryClient();

  const { mutate: startImageProcessing } = useMutation({
    mutationFn: processAllImagery,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-detail'] });
      dispatch(setProjectState({ showGcpEditor: false }));
      toast.success('Processing started');
    },
  });

  const startProcessing = (data: any) => {
    const gcpData = data.detail;
    const blob = new Blob([gcpData], { type: 'text/plain;charset=utf-8;' });
    const gcpFile = new File([blob], 'gcp.txt');
    startImageProcessing({ projectId: id, gcp_file: gcpFile });
  };

  const handleProcessingStart = (data: any) => {
    if (triggeredEvent.current) return;
    startProcessing(data);
    triggeredEvent.current = true;
  };

  useEffect(() => {
    document.addEventListener(
      CUSTOM_EVENT,
      handleProcessingStart,
      // When we use the {once: true} option when adding an event listener, the listener will be invoked at most once and immediately removed as soon as the event is invoked.
      { once: true },
    );

    return () => {
      document.removeEventListener(CUSTOM_EVENT, handleProcessingStart);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [CUSTOM_EVENT, dispatch]);

  return createElement('gcp-editor', {
    cogUrl,
    customEvent: CUSTOM_EVENT,
    finalButtonText,
    rawImageUrl,
  });
};

export default GcpEditor;
