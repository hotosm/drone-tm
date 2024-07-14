import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { Button } from '@Components/RadixComponents/Button';
import RadioButton from '@Components/common/RadioButton';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import FileUpload from '@Components/common/UploadArea';
import { setCreateProjectState } from '@Store/actions/createproject';
import { uploadAreaOptions } from '@Constants/createProject';
import { validateGeoJSON } from '@Utils/convertLayerUtils';
import flatten from '@turf/flatten';
import area from '@turf/area';
import { FeatureCollection } from 'geojson';
import MapSection from './MapSection';

export default function DefineAOI({ formProps }: { formProps: any }) {
  const dispatch = useTypedDispatch();

  const { setValue } = formProps;

  const uploadedProjectArea = useTypedSelector(
    state => state.createproject.uploadedProjectArea,
  );
  const uploadedNoFlyZone = useTypedSelector(
    state => state.createproject.uploadedNoFlyZone,
  );
  const isNoflyzonePresent = useTypedSelector(
    state => state.createproject.isNoflyzonePresent,
  );

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
          trigger('outline_geojson');
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
          setValue('noflyzone_geojson', convertedGeojson);
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
            <p className="naxatw-text-body-btn">Project Area</p>
            {!uploadedProjectArea ? (
              <>
                <Button
                  className="naxatw-mt-2 naxatw-bg-red naxatw-text-white"
                  rightIcon="draw"
                >
                  Draw Project Area
                </Button>
                <FlexRow
                  className="naxatw-mt-1 naxatw-w-full naxatw-items-center naxatw-justify-center"
                  gap={3}
                >
                  <hr className="naxatw-w-[40%]" />
                  <span>or</span>
                  <hr className="naxatw-w-[40%]" />
                </FlexRow>
                <div className="naxatw-mt-2">
                  <FileUpload
                    // @ts-ignore
                    register={() => {}}
                    setValue={() => {}}
                    multiple={false}
                    onChange={handleProjectAreaFileChange}
                    fileAccept=".geojson, .kml"
                    placeholder="Upload project area  (zipped shapefile, geojson or kml files)"
                  />
                </div>
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
              </>
            )}
            {uploadedProjectArea && (
              <>
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
                        <FileUpload
                          // @ts-ignore
                          register={() => {}}
                          setValue={() => {}}
                          multiple={false}
                          onChange={handleNoFlyZoneFileChange}
                          fileAccept=".geojson, .kml"
                          placeholder="Upload project area (zipped shapefile, geojson or kml files)"
                        />
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="naxatw-col-span-2 naxatw-overflow-hidden naxatw-rounded-md naxatw-border naxatw-border-[#F3C6C6]">
            <MapSection />
          </div>
        </div>
      </div>
    </FlexColumn>
  );
}
