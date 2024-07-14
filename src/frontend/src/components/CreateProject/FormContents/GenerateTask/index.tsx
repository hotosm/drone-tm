/* eslint-disable no-unused-vars */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { toast } from 'react-toastify';
import { setCreateProjectState } from '@Store/actions/createproject';
import { FormControl, Label, Input } from '@Components/common/FormUI';
import { Button } from '@Components/RadixComponents/Button';
import { convertGeojsonToFile } from '@Utils/convertLayerUtils';
import { postPreviewSplitBySquare } from '@Services/createproject';
import prepareFormData from '@Utils/prepareFormData';
import MapSection from './MapSection';

export default function GenerateTask({ formProps }: { formProps: any }) {
  const dispatch = useTypedDispatch();

  const [dimension, setDimension] = useState<number | null>(null);

  const uploadedProjectArea = useTypedSelector(
    state => state.createproject.uploadedProjectArea,
  );

  const geojsonFile =
    !!uploadedProjectArea && convertGeojsonToFile(uploadedProjectArea);

  const payload = prepareFormData({ project_geojson: geojsonFile });

  const { mutate, isLoading } = useMutation<any, any, any, unknown>({
    mutationFn: postPreviewSplitBySquare,
    onSuccess: (res: any) => {
      dispatch(setCreateProjectState({ splitGeojson: res.data }));
      toast.success('Task Generated Successfully');
    },
    onError: err => {
      toast.error(err.message);
    },
  });

  return (
    <div>
      <div className="naxatw-grid naxatw-grid-cols-3 naxatw-bg-white">
        <div className="naxatw-col-span-1 naxatw-px-10 naxatw-py-5">
          <FormControl>
            <Label>Dimension of Square (meter)</Label>
            <Input
              placeholder="Enter Distance (in m)"
              type="number"
              className="naxatw-mt-1"
              value={dimension as number}
              onChange={e => setDimension(+e.target.value)}
            />
          </FormControl>
          <Button
            withLoader
            isLoading={isLoading}
            rightIcon="settings"
            className="naxatw-mt-4 naxatw-bg-red"
            onClick={() => {
              if (!uploadedProjectArea) return;
              mutate(payload);
            }}
          >
            Generate Task
          </Button>
        </div>
        <div className="naxatw-col-span-2 naxatw-overflow-hidden naxatw-rounded-md naxatw-border naxatw-border-[#F3C6C6]">
          <MapSection />
        </div>
      </div>
    </div>
  );
}
