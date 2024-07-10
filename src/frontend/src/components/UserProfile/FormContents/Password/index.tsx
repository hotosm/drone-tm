import ErrorMessage from '@Components/common/ErrorMessage';
import { FormControl, Input, Label } from '@Components/common/FormUI';
import { Flex, FlexColumn } from '@Components/common/Layouts';

export default function PasswordSection({ formProps }: { formProps: any }) {
  const { register, formState } = formProps;
  return (
    <section className="naxatw-px-14">
      <Flex>
        <p className="naxatw-text-lg naxatw-font-bold">Change Password</p>
      </Flex>
      <FlexColumn gap={5}>
        <FormControl>
          <Label required>Password</Label>
          <Input
            type="password"
            className="naxatw-mt-1"
            placeholder="Enter Password"
            {...register('password', {
              required: 'Required',
            })}
          />
          <ErrorMessage message={formState.errors?.password?.message} />
        </FormControl>
        <FormControl>
          <Label required>Confirm Password</Label>
          <Input
            type="password"
            className="naxatw-mt-1"
            placeholder="Enter Password Again"
            {...register('confirm_password', {
              required: 'Required',
            })}
          />
          <ErrorMessage message={formState.errors?.password?.message} />
        </FormControl>
      </FlexColumn>
    </section>
  );
}
