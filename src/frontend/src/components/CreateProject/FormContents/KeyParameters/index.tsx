/* eslint-disable no-unused-vars */
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { FormControl, Label, Input } from '@Components/common/FormUI';
import RadioButton from '@Components/common/RadioButton';
import { KeyParametersOptions, terrainOptions } from '@Constants/createProject';
import { setCreateProjectState } from '@Store/actions/createproject';
import ErrorMessage from '@Components/common/FormUI/ErrorMessage';

export default function KeyParameters({ formProps }: { formProps: any }) {
  const dispatch = useTypedDispatch();

  const { register, formState } = formProps;

  const keyParamOption = useTypedSelector(
    state => state.createproject.keyParamOption,
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
              {...register('gsd', {
                required: 'GSD is required',
              })}
            />
            <ErrorMessage message={formState?.errors?.gsd?.message} />
          </FormControl>
          <RadioButton
            options={terrainOptions}
            topic="Choose terrain"
            direction="column"
            onChangeData={() => {}}
            value="flat"
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
