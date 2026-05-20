import ErrorMessage from "@Components/common/ErrorMessage";
import { FormControl, Input, Label } from "@Components/common/FormUI";
import { Flex, FlexColumn } from "@Components/common/Layouts";
import { m } from "@/paraglide/messages";

export default function PasswordSection({ formProps }: { formProps: any }) {
  const { register, formState, watch } = formProps;

  const password = watch("password");
  return (
    <section className="naxatw-px-14">
      <Flex>
        <p className="naxatw-text-lg naxatw-font-bold">{m.profile_change_password()}</p>
      </Flex>
      <FlexColumn gap={5}>
        <FormControl>
          <Label required>{m.profile_password_label()}</Label>
          <Input
            type="password"
            className="naxatw-mt-1"
            placeholder={m.profile_password_placeholder()}
            {...register("password", {
              required: m.profile_password_required(),
              minLength: {
                value: 8,
                message: m.profile_password_min_length(),
              },
            })}
          />
          <ErrorMessage message={formState.errors?.password?.message} />
        </FormControl>
        <FormControl>
          <Label required>{m.profile_confirm_password_label()}</Label>
          <Input
            type="password"
            className="naxatw-mt-1"
            placeholder={m.profile_confirm_password_placeholder()}
            {...register("confirm_password", {
              validate: (value: string) => value === password || m.profile_password_mismatch(),
              // required: 'Confirm Password is Required',
            })}
          />
          <ErrorMessage message={formState.errors?.confirm_password?.message} />
        </FormControl>
      </FlexColumn>
    </section>
  );
}
