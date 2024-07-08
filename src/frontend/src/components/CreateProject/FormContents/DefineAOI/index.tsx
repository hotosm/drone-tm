import { useEffect } from 'react';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { setCreateProjectState } from '@Store/actions/createproject';
import { FlexColumn } from '@Components/common/Layouts';
import RadioButton from '@Components/common/RadioButton';
import { uploadAreaOptions } from '@Constants/createProject';
import FileUpload from '@Components/common/UploadArea';
import { validateGeoJSON } from '@Utils/convertLayerUtils';
import flatten from '@turf/flatten';
import MapSection from './MapSection';

export default function DefineAOI({ formProps }: { formProps: any }) {
  const dispatch = useTypedDispatch();
  const { setValue } = formProps;

  const uploadedGeojson = useTypedSelector(
    state => state.createproject.uploadedGeojson,
  );
  const uploadNoFlyZone = useTypedSelector(
    state => state.createproject.uploadNoFlyZone,
  );

  const handleFileChange = (file: Record<string, any>[]) => {
    if (!file) return;
    const geojson = validateGeoJSON(file[0]?.file);
    try {
      geojson.then(z => {
        if (typeof z === 'object' && !Array.isArray(z) && z !== null) {
          const convertedGeojson = flatten(z);
          dispatch(
            setCreateProjectState({ uploadedGeojson: convertedGeojson }),
          );
        }
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.log(err);
    }
  };

  useEffect(() => {
    if (!uploadedGeojson) return;
    setValue('outline_geojson', uploadedGeojson);
  }, [uploadedGeojson]);

  return (
    <FlexColumn>
      <div className="naxatw-bg-white">
        <div className="naxatw-grid naxatw-grid-cols-3">
          <div className="naxatw-col-span-1 naxatw-px-10 naxatw-py-5">
            <p className="naxatw-text-body-btn">
              Define or Upload project area
            </p>
            <div className="naxatw-mt-2">
              <FileUpload
                // @ts-ignore
                register={() => {}}
                setValue={() => {}}
                multiple={false}
                onChange={handleFileChange}
                fileAccept=".geojson, .kml"
                placeholder="*The supported file formats are zipped shapefile, geojson or kml files."
              />
            </div>
            <div className="naxatw-mt-2">
              <RadioButton
                topic="No flying zone present in project area ?"
                options={uploadAreaOptions}
                direction="column"
                onChangeData={(val: 'yes' | 'no') => {
                  dispatch(setCreateProjectState({ uploadNoFlyZone: val }));
                }}
                value={uploadNoFlyZone}
              />
            </div>
            {uploadNoFlyZone === 'yes' && (
              <div className="naxatw-mt-2">
                <FileUpload
                  // @ts-ignore
                  register={() => {}}
                  setValue={() => {}}
                  multiple={false}
                  onChange={handleFileChange}
                  fileAccept=".geojson, .kml"
                  placeholder="*The supported file formats are zipped shapefile, geojson or kml files."
                />
              </div>
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
