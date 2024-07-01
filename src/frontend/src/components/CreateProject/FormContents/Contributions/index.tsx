/* eslint-disable no-unused-vars */
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { FormControl, Label, Input } from '@Components/common/FormUI';
import { setCreateProjectState } from '@Store/actions/createproject';
import RadioButton from '@Components/common/RadioButton';
import { contributionsOptions } from '@Constants/createProject';

export default function Conditions({ formProps }: { formProps: any }) {
  const dispatch = useTypedDispatch();
  const contributionsOption = useTypedSelector(
    state => state.createproject.contributionsOption,
  );

  return (
    <div className="naxatw-px-10 naxatw-py-5">
      <RadioButton
        topic="Publish"
        options={contributionsOptions}
        direction="row"
        onChangeData={val => {
          dispatch(setCreateProjectState({ contributionsOption: val }));
        }}
        value={contributionsOption}
      />
      <FormControl className="naxatw-mt-4 naxatw-gap-1">
        <Label>Deadline for Submission</Label>
        <Input placeholder="Enter GSD in meter" />
      </FormControl>
    </div>
  );
}
