import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { FlexColumn } from '@Components/common/Layouts';
import { FormControl, Label, Input } from '@Components/common/FormUI';
import ErrorMessage from '@Components/common/ErrorMessage';
import { UseFormPropsType } from '@Components/common/FormUI/types';
import RadioButton from '@Components/common/RadioButton';
import { lockApprovalOptions } from '@Constants/createProject';
import { setCreateProjectState } from '@Store/actions/createproject';
// import { contributionsOptions } from '@Constants/createProject';

export default function Conditions({
  formProps,
}: {
  formProps: UseFormPropsType;
}) {
  const dispatch = useTypedDispatch();
  const { register, errors } = formProps;
  const requireApprovalFromManagerForLocking = useTypedSelector(
    state => state.createproject.requireApprovalFromManagerForLocking,
  );

  return (
    <FlexColumn gap={5} className="">
      <FormControl>
        <Label>Instructions for Drone Operators</Label>
        <Input
          placeholder="Enter Instructions for Drone Operators"
          {...register('per_task_instructions', {
            // required: 'Instructions are required',
            setValueAs: (value: string) => value.trim(),
          })}
        />
        <ErrorMessage
          message={errors?.per_task_instructions?.message as string}
        />
      </FormControl>
      {/* <RadioButton
        required
        topic="Publish"
        options={contributionsOptions}
        direction="column"
        onChangeData={val => {
          dispatch(setCreateProjectState({ contributionsOption: val }));
        }}
        value={contributionsOption}
      /> */}
      <FormControl className="naxatw-gap-1">
        <div className="naxatw-w-full">
          <Label>Deadline for Submission</Label>
          <Input
            placeholder="Deadline for Submission"
            type="date"
            className="naxatw-mt-1"
            {...register('deadline_at', {
              // required: 'Deadline forRequired',
            })}
          />
        </div>
        <ErrorMessage message={errors?.deadline_at?.message as string} />
      </FormControl>
      <FormControl>
        <RadioButton
          required
          topic="Approval for task lock"
          options={lockApprovalOptions}
          direction="column"
          onChangeData={value => {
            dispatch(
              setCreateProjectState({
                requireApprovalFromManagerForLocking: value,
              }),
            );
          }}
          value={requireApprovalFromManagerForLocking}
        />
      </FormControl>
    </FlexColumn>
  );
}
