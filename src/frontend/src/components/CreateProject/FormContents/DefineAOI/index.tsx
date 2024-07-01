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
  const uploadAreaOption = useTypedSelector(
    state => state.createproject.uploadAreaOption,
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
            <RadioButton
              topic="Select one of the option to upload area"
              options={uploadAreaOptions}
              direction="column"
              onChangeData={(val: 'draw' | 'upload_file') => {
                dispatch(setCreateProjectState({ uploadAreaOption: val }));
                dispatch(
                  setCreateProjectState({
                    measureType: val === 'draw' ? 'area' : null,
                  }),
                );
              }}
              value={uploadAreaOption}
            />
            {uploadAreaOption === 'upload_file' ? (
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
            ) : (
              <p className="naxatw-mt-4 naxatw-text-body-btn naxatw-text-red">
                Note: Start Drawing on the Map
              </p>
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
