/* eslint-disable camelcase */
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { FormControl, Label, Input } from '@Components/common/FormUI';
import RadioButton from '@Components/common/RadioButton';
import ErrorMessage from '@Components/common/FormUI/ErrorMessage';
import { UseFormPropsType } from '@Components/common/FormUI/types';
import { setCreateProjectState } from '@Store/actions/createproject';
import { KeyParametersOptions, terrainOptions } from '@Constants/createProject';

export default function KeyParameters({
  formProps,
}: {
  formProps: UseFormPropsType;
}) {
  const dispatch = useTypedDispatch();

  const { register, errors } = formProps;

  const keyParamOption = useTypedSelector(
    state => state.createproject.keyParamOption,
  );
  const isTerrainFollow = useTypedSelector(
    state => state.createproject.isTerrainFollow,
  );

  return (
    <div className="naxatw-px-10 naxatw-py-5">
      <RadioButton
        options={KeyParametersOptions}
        direction="row"
        onChangeData={val => {
          dispatch(setCreateProjectState({ keyParamOption: val }));
        }}
        value={keyParamOption}
      />
      {keyParamOption === 'basic' ? (
        <>
          <FormControl className="naxatw-mt-4 naxatw-gap-1">
            <Label>Ground Sampling Distance (meter)</Label>
            <Input
              placeholder="Enter GSD in meter"
              type="number"
              {...register('gsd_cm_px', {
                required: 'GSD is required',
                valueAsNumber: true,
              })}
            />
            <ErrorMessage message={errors?.gsd_cm_px?.message as string} />
          </FormControl>
          <RadioButton
            options={terrainOptions}
            topic="Choose terrain"
            direction="column"
            onChangeData={val => {
              dispatch(
                setCreateProjectState({
                  isTerrainFollow: val,
                }),
              );
            }}
            value={isTerrainFollow}
          />
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
}
