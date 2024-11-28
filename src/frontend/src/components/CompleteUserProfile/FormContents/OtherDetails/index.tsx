import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { FormControl, Input, Label } from '@Components/common/FormUI';
import { Flex, FlexColumn } from '@Components/common/Layouts';
import RadioButton from '@Components/common/RadioButton';
import { droneOperatorOptions } from '@Constants/index';
import FileUpload from '@Components/common/UploadArea';
import ErrorMessage from '@Components/common/FormUI/ErrorMessage';
import { setCommonState } from '@Store/actions/common';
import { Controller } from 'react-hook-form';

export default function OtherDetails({ formProps }: { formProps: any }) {
  const dispatch = useTypedDispatch();
  const isCertifiedDroneOperator = useTypedSelector(
    state => state.common.isCertifiedDroneUser,
  );
  const { register, setValue, control } = formProps;

  return (
    <section className="naxatw-px-14">
      <Flex>
        <p className="naxatw-mb-2 naxatw-text-lg naxatw-font-bold">
          Other Details
        </p>
      </Flex>
      <FlexColumn gap={5}>
        <FormControl>
          <Label required>Notify for projects withing Distance (in km)</Label>
          <Input
            placeholder="Enter"
            className="naxatw-mt-1"
            type="number"
            {...register('notify_for_projects_within_km', {
              required: 'Required',
              valueAsNumber: true,
            })}
          />
          <ErrorMessage
            message={
              formProps.formState.errors?.notify_for_projects_within_km?.message
            }
          />
        </FormControl>
        <FormControl>
          <Label required>Experience </Label>
          <Input
            placeholder="Enter years of experience"
            className="naxatw-mt-1"
            type="number"
            {...register('experience_years', {
              required: 'Required',
              valueAsNumber: true,
            })}
          />
          <ErrorMessage
            message={formProps.formState.errors?.experience_years?.message}
          />
        </FormControl>
        <FormControl>
          <Label required>Drone you own</Label>
          <Input
            placeholder="Enter the type of drone you own"
            className="naxatw-mt-1"
            {...register('drone_you_own', {
              required: 'Required',
            })}
          />
          <ErrorMessage
            message={formProps.formState.errors?.drone_you_own?.message}
          />
        </FormControl>
        <FormControl>
          <RadioButton
            topic="Certified Drone Operator?"
            options={droneOperatorOptions}
            direction="column"
            onChangeData={val => {
              dispatch(setCommonState({ isCertifiedDroneUser: val }));
              setValue('certified_drone_operator', val === 'yes');
            }}
            value={isCertifiedDroneOperator}
          />
          <ErrorMessage
            message={
              formProps.formState.errors?.certified_drone_operator?.message
            }
          />
          {isCertifiedDroneOperator === 'yes' && (
            <Controller
              control={control}
              name="certificate_file"
              rules={{
                required: 'Certificate file is required',
              }}
              render={({ field: { value }, fieldState: { error } }) => {
                return (
                  <>
                    <FileUpload
                      // @ts-ignore
                      register={() => {}}
                      // @ts-ignore
                      setValue={setValue}
                      name="certificate_file"
                      data={value}
                      onChange={() => {}}
                      fileAccept=".pdf, .jpeg, .png"
                      placeholder="The supported file formats are pdf, .jpeg, .png"
                    />
                    <ErrorMessage message={error?.message as string} />
                  </>
                );
              }}
            />
          )}
        </FormControl>
        <FormControl className="naxatw-flex-col naxatw-gap-1">
          <Label>Drone Registration Certificate</Label>
          <Controller
            control={control}
            name="registration_file"
            render={({ field: { value } }) => {
              return (
                <FileUpload
                  // @ts-ignore
                  register={() => {}}
                  // @ts-ignore
                  setValue={setValue}
                  name="registration_file"
                  data={value}
                  onChange={() => {}}
                  fileAccept=".pdf, .jpeg, .png"
                  placeholder="The supported file formats are pdf, .jpeg, .png"
                />
              );
            }}
          />
        </FormControl>
      </FlexColumn>
    </section>
  );
}
