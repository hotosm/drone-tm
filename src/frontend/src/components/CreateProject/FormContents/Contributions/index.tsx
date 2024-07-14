/* eslint-disable no-unused-vars */
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { FormControl, Label, Input } from '@Components/common/FormUI';
import { setCreateProjectState } from '@Store/actions/createproject';
import RadioButton from '@Components/common/RadioButton';
import { contributionsOptions } from '@Constants/createProject';
import { FlexColumn } from '@Components/common/Layouts';
import ErrorMessage from '@Components/common/ErrorMessage';

export default function Conditions({ formProps }: { formProps: any }) {
  const dispatch = useTypedDispatch();

  const { register, formState } = formProps;

  const contributionsOption = useTypedSelector(
    state => state.createproject.contributionsOption,
  );

  return (
    <FlexColumn gap={5} className="naxatw-px-10 naxatw-py-5">
      <FormControl>
        <Label>Instructions for Drone Operators</Label>
        <Input
          placeholder="Enter Instructions for Drone Operators"
          {...register('per_task_instructions', {
            required: 'Instructions are required',
          })}
        />
        <ErrorMessage
          message={formState?.errors?.per_task_instructions?.message}
        />
      </FormControl>
      <RadioButton
        topic="Publish"
        options={contributionsOptions}
        direction="column"
        onChangeData={val => {
          dispatch(setCreateProjectState({ contributionsOption: val }));
        }}
        value={contributionsOption}
      />
      <FormControl className="naxatw-gap-1">
        <Label>Deadline for Submission</Label>
        <Input placeholder="Enter GSD in meter" />
      </FormControl>
    </FlexColumn>
  );
}
