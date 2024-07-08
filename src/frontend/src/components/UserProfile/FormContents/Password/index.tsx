import ErrorMessage from '@Components/common/ErrorMessage';
import { FormControl, Input, Label } from '@Components/common/FormUI';
import { FlexColumn } from '@Components/common/Layouts';

export default function PasswordSection({ formProps }: { formProps: any }) {
  const { register } = formProps;
  return (
    <section className="naxatw-px-14 naxatw-py-10">
      <FlexColumn gap={5}>
        <FormControl>
          <Label required>Password</Label>
          <Input
            className="naxatw-mt-1"
            placeholder="Enter Password"
            {...register('password', {
              required: 'Required',
            })}
          />
          <ErrorMessage
            message={formProps.formState.errors?.password?.message}
          />
        </FormControl>
        <FormControl>
          <Label required>Confirm Password</Label>
          <Input
            className="naxatw-mt-1"
            placeholder="Enter Password Again"
            {...register('confirm_password', {
              required: 'Required',
            })}
          />
          <ErrorMessage
            message={formProps.formState.errors?.password?.message}
          />
        </FormControl>
      </FlexColumn>
    </section>
  );
}
