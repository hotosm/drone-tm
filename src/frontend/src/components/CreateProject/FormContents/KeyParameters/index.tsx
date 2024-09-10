/* eslint-disable camelcase */
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { FormControl, Label, Input } from '@Components/common/FormUI';
import RadioButton from '@Components/common/RadioButton';
import ErrorMessage from '@Components/common/FormUI/ErrorMessage';
import { UseFormPropsType } from '@Components/common/FormUI/types';
import { setCreateProjectState } from '@Store/actions/createproject';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
// import { terrainOptions } from '@Constants/createProject';
import { FlexRow } from '@Components/common/Layouts';
import Switch from '@Components/RadixComponents/Switch';
import FileUpload from '@Components/common/UploadArea';
import {
  FinalOutputOptions,
  imageMergeTypeOptions,
  measurementTypeOptions,
} from '@Constants/createProject';
import InfoMessage from '@Components/common/FormUI/InfoMessage';
import { altitudeToGsd, gsdToAltitude } from '@Utils/index';
import { Controller } from 'react-hook-form';
import OutputOptions from './OutputOptions';

const KeyParameters = ({ formProps }: { formProps: UseFormPropsType }) => {
  const dispatch = useTypedDispatch();

  const { register, errors, watch, control, setValue } = formProps;
  const final_output = watch('final_output');
  const gsdInputValue = watch('gsd_cm_px');
  const altitudeInputValue = watch('altitude_from_ground');

  const keyParamOption = useTypedSelector(
    state => state.createproject.keyParamOption,
  );
  const measurementType = useTypedSelector(
    state => state.createproject.measurementType,
  );
  const isTerrainFollow = useTypedSelector(
    state => state.createproject.isTerrainFollow,
  );
  const imageMergeType = useTypedSelector(
    state => state.createproject.imageMergeType,
  );

  return (
    <div className="naxatw-h-fit naxatw-px-10 naxatw-py-5">
      {/* <RadioButton
        options={KeyParametersOptions}
        direction="row"
        onChangeData={val => {
          dispatch(setCreateProjectState({ keyParamOption: val }));
        }}
        value={keyParamOption}
      /> */}
      {keyParamOption === 'basic' ? (
        <>
          <FormControl>
            <Label>Measurement Type</Label>
            <RadioButton
              options={measurementTypeOptions}
              direction="row"
              onChangeData={val => {
                dispatch(setCreateProjectState({ measurementType: val }));
                setValue('gsd_cm_px', '');
                setValue('altitude_from_ground', '');
              }}
              value={measurementType}
            />
          </FormControl>

          {measurementType === 'gsd' ? (
            <FormControl className="naxatw-mt-4 naxatw-gap-1">
              <Label required>Ground Sampling Distance (cm/pixel)</Label>
              <Input
                placeholder="Enter GSD in cm/pixel"
                type="number"
                max={10}
                min={0}
                {...register('gsd_cm_px', {
                  required: 'GSD is required',
                  valueAsNumber: true,
                  max: {
                    value: 10,
                    message: 'GSD must be 10 or less',
                  },
                  min: {
                    value: 0,
                    message: 'GSD cannot be negative',
                  },
                })}
              />
              {gsdInputValue ? (
                <InfoMessage
                  message={`Equivalent altitude is ${gsdToAltitude(Number(gsdInputValue))}`}
                />
              ) : (
                <></>
              )}
              <ErrorMessage message={errors?.gsd_cm_px?.message as string} />
            </FormControl>
          ) : (
            <FormControl className="naxatw-mt-4 naxatw-gap-1">
              <Label required>Altitude From Ground (meter)</Label>
              <Input
                placeholder="Enter Altitude From Ground in meter"
                type="number"
                max={300}
                min={0}
                {...register('altitude_from_ground', {
                  required: 'Altitude From Round is Required',
                  valueAsNumber: true,
                  max: {
                    value: 300,
                    message: 'Altitude is too high',
                  },
                  min: {
                    value: 0,
                    message: 'Altitude cannot be negative',
                  },
                })}
              />
              {altitudeInputValue ? (
                <InfoMessage
                  message={`Equivalent gsd is ${altitudeToGsd(Number(altitudeInputValue))}`}
                />
              ) : (
                <></>
              )}

              <ErrorMessage
                message={errors?.altitude_from_ground?.message as string}
              />
            </FormControl>
          )}
          <FormControl className="naxatw-mt-5">
            {/* <Label>Measurement Type</Label> */}
            <RadioButton
              options={imageMergeTypeOptions}
              direction="row"
              onChangeData={val => {
                dispatch(setCreateProjectState({ imageMergeType: val }));
                setValue('front_overlap', '');
                setValue('side_overlap', '');
                setValue('forward_spacing', '');
                setValue('side_spacing', '');
              }}
              value={imageMergeType}
            />
          </FormControl>
          {imageMergeType === 'overlap' ? (
            <FlexRow className="naxatw-grid naxatw-grid-cols-2 naxatw-gap-3">
              <FormControl className="naxatw-mt-2 naxatw-gap-1">
                <Label required>Front Overlap in (%)</Label>
                <Input
                  placeholder="Image Overlap"
                  type="number"
                  max={100}
                  min={0}
                  {...register('front_overlap', {
                    required: 'Front Overlap is required',
                    valueAsNumber: true,
                    max: 100,
                    min: 0,
                  })}
                />
                <ErrorMessage
                  message={errors?.forward_overlap_percent?.message as string}
                />
                <p className="naxatw-text-[#68707F]">Recommended : 75%</p>
              </FormControl>
              <FormControl className="naxatw-mt-2 naxatw-gap-1">
                <Label required>Side Overlap in (%)</Label>
                <Input
                  placeholder="Image Overlap"
                  type="number"
                  max={100}
                  min={0}
                  {...register('side_overlap', {
                    required: 'Side Overlap is required',
                    valueAsNumber: true,
                    min: 0,
                    max: 100,
                  })}
                />
                <ErrorMessage
                  message={errors?.side_overlap_percent?.message as string}
                />
                <p className="naxatw-text-[#68707F]">Recommended : 60%</p>
              </FormControl>
            </FlexRow>
          ) : (
            <FlexRow className="naxatw-grid naxatw-grid-cols-2 naxatw-gap-3">
              <FormControl className="naxatw-mt-4 naxatw-gap-1">
                <Label required>Forward spacing in (m)</Label>
                <Input
                  placeholder="Image Spacing"
                  type="number"
                  max={100}
                  min={0}
                  {...register('forward_spacing', {
                    required: 'Forward Spacing is required',
                    valueAsNumber: true,
                    max: 100,
                    min: 0,
                  })}
                />
                <ErrorMessage
                  message={errors?.forward_spacing?.message as string}
                />
              </FormControl>
              <FormControl className="naxatw-mt-4 naxatw-gap-1">
                <Label required>Side Overlap in (m)</Label>
                <Input
                  placeholder="Image Spacing"
                  type="number"
                  max={100}
                  min={0}
                  {...register('side_spacing', {
                    required: 'Side Spacing is required',
                    valueAsNumber: true,
                    min: 0,
                    max: 100,
                  })}
                />
                <ErrorMessage
                  message={errors?.side_spacing?.message as string}
                />
              </FormControl>
            </FlexRow>
          )}
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>Final Output</Label>
            <div className="naxatw-my-4 naxatw-grid naxatw-grid-cols-4 naxatw-gap-3">
              {FinalOutputOptions?.map((option, index) => (
                <OutputOptions
                  key={option.label}
                  icon={option.icon}
                  name={`final_output.${index}`}
                  checked={final_output?.[index]}
                  label={option.label}
                  value={option.value}
                  register={register}
                />
              ))}
            </div>
          </FormControl>

          <FormControl className="naxatw-mt-4">
            <FlexRow className="naxatw-mb-4 naxatw-items-center naxatw-gap-[10px]">
              <p className="naxatw-text-body-md">Follow the Terrain</p>
              <Switch
                checked={isTerrainFollow}
                onClick={() => {
                  dispatch(
                    setCreateProjectState({
                      isTerrainFollow: !isTerrainFollow,
                    }),
                  );
                }}
              />
            </FlexRow>
          </FormControl>
          {isTerrainFollow && (
            <FormControl className="naxatw-mt-2">
              <Controller
                control={control}
                name="dem"
                rules={{
                  required: 'Dem data is Required',
                }}
                render={({ field: { value } }) => {
                  return (
                    <FileUpload
                      name="dem"
                      data={value}
                      fileAccept=".tif, .tiff"
                      placeholder="Upload dem data (tif/tiff files)"
                      {...formProps}
                    />
                  );
                }}
              />
              <ErrorMessage message={errors?.dem?.message as string} />
            </FormControl>
          )}
        </>
      ) : (
        <>
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>Altitude</Label>
            <Input placeholder="Enter Altitude in meter" />
          </FormControl>
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>Gimbal Angle</Label>
            <Input placeholder="Enter Gimble Angle" />
          </FormControl>
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>Distance Between Paths</Label>
            <Input placeholder="Enter Distance Between Paths in meter" />
          </FormControl>
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>Image Overlap</Label>
            <Input placeholder="Enter Image Overlap" />
          </FormControl>
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>Line Orientation</Label>
            <Input placeholder="Enter Line Orientation" />
          </FormControl>
        </>
      )}
    </div>
  );
};

export default hasErrorBoundary(KeyParameters);
