import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { FlexColumn } from '@Components/common/Layouts';
import { FormControl, Label, Input } from '@Components/common/FormUI';
import RadioButton from '@Components/common/RadioButton';
import ErrorMessage from '@Components/common/ErrorMessage';
import { UseFormPropsType } from '@Components/common/FormUI/types';
import { setCreateProjectState } from '@Store/actions/createproject';
import { contributionsOptions } from '@Constants/createProject';

export default function Conditions({
  formProps,
}: {
  formProps: UseFormPropsType;
}) {
  const dispatch = useTypedDispatch();

  const { register, errors } = formProps;

  const contributionsOption = useTypedSelector(
    state => state.createproject.contributionsOption,
  );

  return (
    <FlexColumn gap={5} className="naxatw-px-10 naxatw-py-5">
      <FormControl>
        <Label required>Instructions for Drone Operators</Label>
        <Input
          placeholder="Enter Instructions for Drone Operators"
          {...register('per_task_instructions', {
            required: 'Instructions are required',
          })}
        />
        <ErrorMessage
          message={errors?.per_task_instructions?.message as string}
        />
      </FormControl>
      <RadioButton
        required
        topic="Publish"
        options={contributionsOptions}
        direction="column"
        onChangeData={val => {
          dispatch(setCreateProjectState({ contributionsOption: val }));
        }}
        value={contributionsOption}
      />
      <FormControl className="naxatw-gap-1">
        <div className="naxatw-w-full">
          <Label required>Deadline for Submission</Label>
          <Input
            placeholder="Deadline for Submission"
            type="date"
            className="naxatw-mt-1"
            {...register('deadline_at', {
              required: 'Deadline forRequired',
            })}
          />
        </div>
        <ErrorMessage message={errors?.deadline_at?.message as string} />
      </FormControl>
    </FlexColumn>
  );
}
