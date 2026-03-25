import { useEffect, createElement, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { setProjectState } from '@Store/actions/project';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveGcpFile } from '@Services/project';
import { useParams } from 'react-router-dom';
import { toast } from 'react-toastify';

const GcpEditor = ({
  cogUrl,
  finalButtonText,
  rawImageUrl,
}: any) => {
  const triggeredEvent = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const { id } = useParams();
  const dispatch = useDispatch();
  const CUSTOM_EVENT: any = 'save-gcp-click';
  const queryClient = useQueryClient();

  const { mutate: saveGcp } = useMutation({
    mutationFn: saveGcpFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-detail'] });
      dispatch(setProjectState({ showGcpEditor: false }));
      toast.success('GCP file saved for this project');
    },
    onError: () => {
      toast.error('Failed to save GCP file');
    },
  });

  const handleSaveGcp = (data: any) => {
    if (triggeredEvent.current) return;
    triggeredEvent.current = true;
    const gcpData = data.detail;
    const blob = new Blob([gcpData], { type: 'text/plain;charset=utf-8;' });
    const gcpFile = new File([blob], 'gcp.txt');
    saveGcp({ projectId: id!, gcp_file: gcpFile });
  };

  useEffect(() => {
    // Lazy-load gcp-editor so it's only fetched when needed
    Promise.all([
      import('@hotosm/gcp-editor'),
      import('@hotosm/gcp-editor/style.css'),
    ]).then(() => {
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    // Lazy-load gcp-editor and suppress duplicate custom element registration
    // errors from its bundled (older) copy of @hotosm/ui
    const originalDefine = customElements.define.bind(customElements);
    customElements.define = ((name: string, ctor: CustomElementConstructor, options?: ElementDefinitionOptions) => {
      if (customElements.get(name)) return;
      originalDefine(name, ctor, options);
    }) as typeof customElements.define;

    Promise.all([
      import('@hotosm/gcp-editor'),
      import('@hotosm/gcp-editor/style.css'),
    ]).then(() => {
      customElements.define = originalDefine;
      setLoaded(true);
    });

    return () => {
      customElements.define = originalDefine;
    };
  }, []);

  useEffect(() => {
    document.addEventListener(
      CUSTOM_EVENT,
      handleSaveGcp,
      { once: true },
    );

    return () => {
      document.removeEventListener(CUSTOM_EVENT, handleSaveGcp);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [CUSTOM_EVENT, dispatch]);

  if (!loaded) return null;

  return createElement('gcp-editor', {
    cogUrl,
    customEvent: CUSTOM_EVENT,
    finalButtonText,
    rawImageUrl,
  });
};

export default GcpEditor;
