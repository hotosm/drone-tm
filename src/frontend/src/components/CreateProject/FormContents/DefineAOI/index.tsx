import { useEffect, useState } from 'react';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { Controller } from 'react-hook-form';
import ErrorMessage from '@Components/common/FormUI/ErrorMessage';
import { UseFormPropsType } from '@Components/common/FormUI/types';
import { FormControl, Label } from '@Components/common/FormUI';
import FileUpload from '@Components/common/UploadArea';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { m2ToKm2 } from '@Utils/index';
import { setCreateProjectState } from '@Store/actions/createproject';
import flatten from '@turf/flatten';
import area from '@turf/area';
import type { AllGeoJSON } from '@turf/helpers';
import type { FeatureCollection } from 'geojson';
import { validateGeoJSON } from '@Utils/convertLayerUtils';
import { toast } from 'react-toastify';
import SwitchTab from '@Components/common/SwitchTab';
import { uploadOrDrawAreaOptions } from '@Constants/createProject';
import MapSection from './MapSection';

function isAllGeoJSON(obj: unknown): obj is AllGeoJSON {
  return typeof obj === 'object' && obj !== null && 'type' in obj;
}

const DefineAOI = ({ formProps }: { formProps: UseFormPropsType }) => {
  const dispatch = useTypedDispatch();
  const [selectedTab, setSelectedTab] = useState<string>('project');
  const projectArea = useTypedSelector(
    state => state.createproject.projectArea,
  );
  const noFlyZoneArea = useTypedSelector(
    state => state.createproject.noFlyZone,
  );
  const totalProjectArea = useTypedSelector(
    state => state.createproject.totalProjectArea,
  );
  const totalNoFlyZoneArea = useTypedSelector(
    state => state.createproject.totalNoFlyZoneArea,
  );

  const { setValue, control, errors } = formProps;

  const handleProjectAreaFileChange = (file: Record<string, any>[]) => {
    if (!file) return;
    const geojson: any = validateGeoJSON(file[0]?.file);

    try {
      geojson.then((z: any) => {
        if (isAllGeoJSON(z) && !Array.isArray(z)) {
          const convertedGeojson = flatten(z);
          dispatch(setCreateProjectState({ projectArea: convertedGeojson }));
          setValue('outline', convertedGeojson);
        }
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.log(err);
    }
  };

  // @ts-ignore
  const validateAreaOfFileUpload = async (file: any) => {
    try {
      if (!file || !file[0]?.file) {
        toast.error('Please upload a valid file');
        return false;
      }
      const geojson: any = await validateGeoJSON(file[0]?.file);
      if (isAllGeoJSON(geojson) && !Array.isArray(geojson)) {
        const convertedGeojson = flatten(geojson);
        const uploadedArea: any =
          convertedGeojson && area(convertedGeojson as FeatureCollection);
        if (uploadedArea && uploadedArea > 100000000) {
          toast.error('Drawn Area should not exceed 100km²');
          return false;
        }
        return true;
      }
      toast.error('Invalid GeoJSON file. Please upload a valid file.');
      return false;
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.log(err);
      toast.error('Failed to process file. Please upload a valid GeoJSON file.');
      return false;
    }
  };

  const handleNoFlyZoneFileChange = (file: Record<string, any>[]) => {
    if (!file) return;
    const geojson = validateGeoJSON(file[0]?.file);
    try {
      geojson.then(z => {
        if (isAllGeoJSON(z) && !Array.isArray(z)) {
          const convertedGeojson = flatten(z);
          dispatch(setCreateProjectState({ noFlyZone: convertedGeojson }));
          setValue('no_fly_zones', convertedGeojson);
        }
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.log(err);
    }
  };

  useEffect(() => {
    const calculatedTotalProjectArea =
      projectArea && area(projectArea as FeatureCollection);
    const calculatedTotalNoFlyZoneArea =
      noFlyZoneArea && area(noFlyZoneArea as FeatureCollection);

    if (calculatedTotalProjectArea) {
      dispatch(
        setCreateProjectState({ totalProjectArea: calculatedTotalProjectArea }),
      );
    } else {
      dispatch(setCreateProjectState({ totalProjectArea: 0 }));
    }

    if (calculatedTotalNoFlyZoneArea) {
      dispatch(
        setCreateProjectState({
          totalNoFlyZoneArea: calculatedTotalNoFlyZoneArea,
        }),
      );
    } else {
      dispatch(setCreateProjectState({ totalNoFlyZoneArea: 0 }));
    }

    setValue('outline', projectArea);
    setValue('no_fly_zones', noFlyZoneArea);
  }, [projectArea, noFlyZoneArea, dispatch, setValue]);

  return (
    <div className="naxatw-h-full naxatw-bg-white">
      <div className="naxatw-grid naxatw-h-full naxatw-grid-cols-3 naxatw-gap-5">
        <div className="naxatw-col-span-3 naxatw-overflow-y-auto naxatw-py-5 md:naxatw-col-span-1">
          <FormControl className="naxatw-flex naxatw-flex-col naxatw-gap-1">
            <Label>Draw/Upload Area</Label>
            <SwitchTab
              options={uploadOrDrawAreaOptions}
              valueKey="value"
              selectedValue={selectedTab}
              activeClassName="naxatw-bg-red naxatw-text-white"
              onChange={(selected: any) => {
                setSelectedTab(selected.value);
              }}
            />
          </FormControl>

          {selectedTab === 'project' ? (
            <>
              {totalProjectArea > 0 && (
                <p className="naxatw-mt-2 naxatw-text-body-md">
                  Total Project Area:{' '}
                  {m2ToKm2(Math.trunc(totalProjectArea as number))}
                </p>
              )}
              {!projectArea && (
                <FormControl className="naxatw-mt-4">
                  <Controller
                    control={control}
                    name="outline"
                    rules={{
                      required: 'Project Area is Required',
                    }}
                    render={({ field: { value } }) => {
                      return (
                        <FileUpload
                          name="outline"
                          data={value}
                          onChange={handleProjectAreaFileChange}
                          fileAccept=".geojson"
                          placeholder="Upload project area (.geojson file)"
                          isValid={validateAreaOfFileUpload}
                          {...formProps}
                        />
                      );
                    }}
                  />
                  <ErrorMessage message={errors?.outline?.message as string} />
                </FormControl>
              )}
            </>
          ) : (
            <>
              {totalNoFlyZoneArea > 0 && (
                <p className="naxatw-mt-2 naxatw-text-body-md">
                  Total Project Area:{' '}
                  {m2ToKm2(Math.trunc(totalNoFlyZoneArea as number))}
                </p>
              )}
              {!noFlyZoneArea && (
                <FormControl className="naxatw-mt-4">
                  <Controller
                    control={control}
                    name="no_fly_zones"
                    render={({ field: { value } }) => (
                      <FileUpload
                        name="no_fly_zones"
                        data={value}
                        onChange={handleNoFlyZoneFileChange}
                        isValid={validateAreaOfFileUpload}
                        fileAccept=".geojson, .kml"
                        placeholder="Upload no fly zone area (.geojson)"
                        {...formProps}
                      />
                    )}
                  />
                </FormControl>
              )}
            </>
          )}
        </div>

        <div className="naxatw-col-span-3 naxatw-h-[50vh] naxatw-overflow-hidden md:naxatw-col-span-2 md:naxatw-h-full">
          <MapSection selectedTab={selectedTab} setValue={setValue} />
        </div>
      </div>
    </div>
  );
};

export default hasErrorBoundary(DefineAOI);
