/* eslint-disable camelcase */
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import ErrorMessage from '@Components/common/ErrorMessage';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { FormControl, Label, Input } from '@Components/common/FormUI';
import { Button } from '@Components/RadixComponents/Button';
import { toast } from 'react-toastify';
import { setCreateProjectState } from '@Store/actions/createproject';
import { convertGeojsonToFile } from '@Utils/convertLayerUtils';
import prepareFormData from '@Utils/prepareFormData';
import {
  getProjectWayPoints,
  postPreviewSplitBySquare,
} from '@Services/createproject';
import MapSection from './MapSection';

export default function GenerateTask({ formProps }: { formProps: any }) {
  const dispatch = useTypedDispatch();
  const [error, setError] = useState('');
  const isTerrainFollow = useTypedSelector(
    state => state.createproject.isTerrainFollow,
  );
  const demType = useTypedSelector(state => state.createproject.demType);

  const { register, watch } = formProps;
  const {
    front_overlap,
    side_overlap,
    altitude_from_ground,
    gsd_cm_px,
    outline,
    task_split_dimension,
    dem: demFile,
  } = watch();

  const dimension = watch('task_split_dimension');

  const projectArea = useTypedSelector(
    state => state.createproject.projectArea,
  );
  const noFlyZone = useTypedSelector(state => state.createproject.noFlyZone);

  const projectGeojsonFile =
    !!projectArea && convertGeojsonToFile(projectArea as Record<string, any>);
  const noFlyZoneGeojsonFile =
    !!noFlyZone && convertGeojsonToFile(noFlyZone as Record<string, any>);

  const payload = prepareFormData({
    project_geojson: projectGeojsonFile,
    dimension,
    ...(noFlyZone ? { no_fly_zones: noFlyZoneGeojsonFile } : {}), // add no fly zones it there are any
  });

  const {
    mutate: mutateProjectWayPoints,
    data: projectWayPoints,
    isPending: projectWaypointCountIsLoading,
  } = useMutation({
    mutationFn: (projectGeoJsonPayload: Record<string, any>) => {
      const { project_geojson, dem, ...params } = projectGeoJsonPayload;
      return getProjectWayPoints(params, {
        project_geojson,
        dem,
      });
    },
  });

  const { mutate, isPending } = useMutation<any, any, any, unknown>({
    mutationFn: postPreviewSplitBySquare,
    onSuccess: (res: any) => {
      dispatch(setCreateProjectState({ splitGeojson: res.data }));
      toast.success('Task Generated Successfully');
    },
    onError: err => {
      toast.error(err.message);
    },
  });

  // console.log(dem, isTerrainFollow, demType, 'types');

  return (
    <div className="naxatw-grid naxatw-h-full naxatw-grid-cols-3 naxatw-gap-5">
      <div className="naxatw-col-span-3 md:naxatw-col-span-1">
        <FormControl>
          <Label required>Dimension of Square (m)</Label>
          <Input
            placeholder="Enter Dimension (in m)"
            type="number"
            className="naxatw-mt-1"
            value={dimension}
            min={50}
            max={1000}
            {...register('task_split_dimension', {
              required: 'Required',
              valueAsNumber: true,
            })}
            onFocus={() => setError('')}
          />
          {error && <ErrorMessage message={error} />}
          <p className="naxatw-text-[#68707F]">Recommended : 50-1000</p>
        </FormControl>
        <Button
          withLoader
          isLoading={isPending}
          rightIcon="settings"
          disabled={!dimension}
          className="naxatw-mt-4 naxatw-bg-red"
          onClick={() => {
            if (!projectArea) return () => {};
            if (dimension < 50 || dimension > 1000)
              return setError('Dimension must in between 50-1000');
            dispatch(
              setCreateProjectState({
                splitGeojson: null,
                capturedProjectMap: false,
              }),
            );
            const projectWayPointsPayload = {
              front_overlap: front_overlap || 0,
              side_overlap: side_overlap || 0,
              altitude_from_ground: altitude_from_ground || 0,
              gsd_cm_px: gsd_cm_px || 0,
              meters: task_split_dimension,
              project_geojson: convertGeojsonToFile(outline),
              is_terrain_follow: isTerrainFollow,
              dem:
                isTerrainFollow && demType === 'manual'
                  ? demFile[0]?.file
                  : null,
            };
            mutateProjectWayPoints(projectWayPointsPayload);
            return mutate(payload);
          }}
        >
          Generate Task
        </Button>
        {!projectWaypointCountIsLoading && projectWayPoints && (
          <p className="naxatw-mt-4 naxatw-text-sm naxatw-font-semibold">
            The average number of waypoints is:
            <ul className="naxatw-ml-4 naxatw-list-disc">
              {projectWayPoints?.data?.waypoints && (
                <li>
                  <span className="naxatw-text-blue-500">
                    In waypoints mode: {projectWayPoints?.data?.waypoints}
                  </span>
                </li>
              )}
              {projectWayPoints?.data?.waylines && (
                <li>
                  <span className="naxatw-text-green-500">
                    In waylines mode: {projectWayPoints.data.waylines}
                  </span>
                </li>
              )}
            </ul>
          </p>
        )}
      </div>
      <div className="naxatw-col-span-3 naxatw-h-[50vh] naxatw-bg-green-50 md:naxatw-col-span-2 md:naxatw-h-full">
        <MapSection />
      </div>
    </div>
  );
}
