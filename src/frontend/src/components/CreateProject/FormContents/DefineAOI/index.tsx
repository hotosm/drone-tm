import { useCallback, useState } from 'react';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { Controller } from 'react-hook-form';
import ErrorMessage from '@Components/common/FormUI/ErrorMessage';
import { UseFormPropsType } from '@Components/common/FormUI/types';
import { FormControl } from '@Components/common/FormUI';
import { Button } from '@Components/RadixComponents/Button';
import RadioButton from '@Components/common/RadioButton';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import FileUpload from '@Components/common/UploadArea';
import { setCreateProjectState } from '@Store/actions/createproject';
import flatten from '@turf/flatten';
import area from '@turf/area';
import { FeatureCollection } from 'geojson';
import { uploadAreaOptions } from '@Constants/createProject';
import { validateGeoJSON } from '@Utils/convertLayerUtils';
import Icon from '@Components/common/Icon';
import MapSection from './MapSection';

export default function DefineAOI({
  formProps,
}: {
  formProps: UseFormPropsType;
}) {
  const dispatch = useTypedDispatch();

  const { setValue, control, errors } = formProps;

  const [resetDrawTool, setResetDrawTool] = useState<null | (() => void)>(null);

  const uploadedProjectArea = useTypedSelector(
    state => state.createproject.uploadedProjectArea,
  );
  const uploadedNoFlyZone = useTypedSelector(
    state => state.createproject.uploadedNoFlyZone,
  );
  const isNoflyzonePresent = useTypedSelector(
    state => state.createproject.isNoflyzonePresent,
  );
  const drawProjectAreaEnable = useTypedSelector(
    state => state.createproject.drawProjectAreaEnable,
  );
  const drawnProjectArea = useTypedSelector(
    state => state.createproject.drawnProjectArea,
  );

  const handleResetButtonClick = useCallback((resetFunction: any) => {
    setResetDrawTool(() => resetFunction);
  }, []);

  const handleDrawProjectAreaClick = () => {
    if (!drawProjectAreaEnable) {
      dispatch(setCreateProjectState({ drawProjectAreaEnable: true }));
      return;
    }
    dispatch(
      setCreateProjectState({
        uploadedProjectArea: drawnProjectArea,
        drawProjectAreaEnable: false,
      }),
    );
    if (resetDrawTool) {
      resetDrawTool();
    }
  };

  const projectArea =
    uploadedProjectArea && area(uploadedProjectArea as FeatureCollection);
  const noFlyZoneArea =
    uploadedNoFlyZone && area(uploadedNoFlyZone as FeatureCollection);

  const handleProjectAreaFileChange = (file: Record<string, any>[]) => {
    if (!file) return;
    const geojson = validateGeoJSON(file[0]?.file);
    try {
      geojson.then(z => {
        if (typeof z === 'object' && !Array.isArray(z) && z !== null) {
          const convertedGeojson = flatten(z);
          dispatch(
            setCreateProjectState({ uploadedProjectArea: convertedGeojson }),
          );
          setValue('outline_geojson', convertedGeojson);
        }
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.log(err);
    }
  };

  const handleNoFlyZoneFileChange = (file: Record<string, any>[]) => {
    if (!file) return;
    const geojson = validateGeoJSON(file[0]?.file);
    try {
      geojson.then(z => {
        if (typeof z === 'object' && !Array.isArray(z) && z !== null) {
          const convertedGeojson = flatten(z);
          dispatch(
            setCreateProjectState({ uploadedNoFlyZone: convertedGeojson }),
          );
          setValue('outline_no_fly_zones', convertedGeojson);
        }
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.log(err);
    }
  };

  return (
    <FlexColumn>
      <div className="naxatw-bg-white">
        <div className="naxatw-grid naxatw-grid-cols-3">
          <div className="naxatw-col-span-1 naxatw-px-10 naxatw-py-5">
            <p className="naxatw-text-body-btn">
              Project Area <span className="naxatw-text-red">*</span>
            </p>
            {!uploadedProjectArea ? (
              <>
                <FlexRow gap={3} className="naxatw-items-center">
                  <Button
                    className="naxatw-mt-2 naxatw-bg-red naxatw-text-white"
                    rightIcon="draw"
                    onClick={handleDrawProjectAreaClick}
                  >
                    {drawnProjectArea ? 'Save Drawn Area' : 'Draw Project Area'}
                  </Button>
                  {drawnProjectArea && (
                    <Icon
                      name="restart_alt"
                      className="naxatw-text-red"
                      onClick={() => {
                        dispatch(
                          setCreateProjectState({ drawnProjectArea: null }),
                        );
                        if (resetDrawTool) {
                          resetDrawTool();
                        }
                      }}
                    />
                  )}
                </FlexRow>
                {!drawProjectAreaEnable && (
                  <>
                    <FlexRow
                      className="naxatw-mt-1 naxatw-w-full naxatw-items-center naxatw-justify-center"
                      gap={3}
                    >
                      <hr className="naxatw-w-[40%]" />
                      <span>or</span>
                      <hr className="naxatw-w-[40%]" />
                    </FlexRow>
                    <FormControl className="naxatw-mt-2">
                      <Controller
                        control={control}
                        name="outline_geojson"
                        rules={{
                          required: 'Project Area is Required',
                        }}
                        render={({ field: { value } }) => (
                          <FileUpload
                            name="outline_geojson"
                            data={value}
                            onChange={handleProjectAreaFileChange}
                            fileAccept=".geojson, .kml"
                            placeholder="Upload project area (zipped shapefile, geojson or kml files)"
                            {...formProps}
                          />
                        )}
                      />
                      <ErrorMessage
                        message={errors?.outline_geojson?.message as string}
                      />
                    </FormControl>
                  </>
                )}
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  className="naxatw-mt-2 naxatw-border naxatw-border-red naxatw-text-red"
                  rightIcon="restart_alt"
                  onClick={() => {
                    dispatch(
                      setCreateProjectState({ uploadedProjectArea: null }),
                    );
                  }}
                >
                  Reset Project Area
                </Button>
                <p className="naxatw-mt-2 naxatw-text-body-md">
                  Total Area: {Math.trunc(projectArea as number)} m2
                </p>
                <div className="naxatw-mt-2">
                  <RadioButton
                    topic="No flying zone present in project area?"
                    options={uploadAreaOptions}
                    direction="column"
                    onChangeData={(val: 'yes' | 'no') => {
                      dispatch(
                        setCreateProjectState({ isNoflyzonePresent: val }),
                      );
                    }}
                    value={isNoflyzonePresent}
                  />
                </div>
                {isNoflyzonePresent === 'yes' && (
                  <div className="naxatw-mt-2">
                    {uploadedNoFlyZone ? (
                      <>
                        <Button
                          variant="ghost"
                          className="naxatw-mb-2 naxatw-border naxatw-border-red naxatw-text-red"
                          rightIcon="restart_alt"
                          onClick={() =>
                            dispatch(
                              setCreateProjectState({
                                uploadedNoFlyZone: null,
                              }),
                            )
                          }
                        >
                          Reset No Fly Zone
                        </Button>
                        <p className="naxatw-mt-2 naxatw-text-body-md">
                          Total Area: {Math.trunc(noFlyZoneArea as number)} m2
                        </p>
                      </>
                    ) : (
                      <>
                        <Button
                          className="naxatw-mb-2 naxatw-bg-red naxatw-text-white"
                          rightIcon="draw"
                        >
                          Draw No Fly Zone
                        </Button>
                        <FlexRow
                          className="naxatw-my-1 naxatw-w-full naxatw-items-center naxatw-justify-center"
                          gap={3}
                        >
                          <hr className="naxatw-w-[40%]" />
                          <span>or</span>
                          <hr className="naxatw-w-[40%]" />
                        </FlexRow>
                        <FormControl className="naxatw-mt-2">
                          <Controller
                            control={control}
                            name="outline_no_fly_zones"
                            render={({ field: { value } }) => (
                              <FileUpload
                                name="outline_no_fly_zones"
                                data={value}
                                onChange={handleNoFlyZoneFileChange}
                                fileAccept=".geojson, .kml"
                                placeholder="Upload project area (zipped shapefile, geojson or kml files)"
                                {...formProps}
                              />
                            )}
                          />
                        </FormControl>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="naxatw-col-span-2 naxatw-overflow-hidden naxatw-rounded-md naxatw-border naxatw-border-[#F3C6C6]">
            <MapSection onResetButtonClick={handleResetButtonClick} />
          </div>
        </div>
      </div>
    </FlexColumn>
  );
}
