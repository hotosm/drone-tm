import ErrorMessage from "@Components/common/ErrorMessage";
import { FormControl, Input, Label } from "@Components/common/FormUI";
import { Flex, FlexColumn } from "@Components/common/Layouts";
import { m } from "@/paraglide/messages";

export default function OrganizationDetails({ formProps }: { formProps: any }) {
  const { register } = formProps;

  return (
    <section className="naxatw-px-14">
      <Flex>
        <p className="naxatw-text-lg naxatw-font-bold">{m.profile_organization_details()}</p>
      </Flex>
      <FlexColumn gap={5}>
        <FormControl>
          <Label>{m.profile_organization_name_label()}</Label>
          <Input
            placeholder={m.profile_organization_name_placeholder()}
            className="naxatw-mt-1"
            {...register("organization_name", {
              // required: 'Organization name is Required',
            })}
          />
          <ErrorMessage message={formProps.formState.errors?.organization_name?.message} />
        </FormControl>
        <FormControl>
          <Label>{m.profile_organization_address_label()}</Label>
          <Input
            placeholder={m.profile_organization_address_placeholder()}
            className="naxatw-mt-1"
            {...register("organization_address", {
              // required: 'Organization Address is Required',
            })}
          />
          <ErrorMessage message={formProps.formState.errors?.organization_address?.message} />
        </FormControl>
        <FormControl>
          <Label>{m.profile_job_title_label()}</Label>
          <Input
            placeholder={m.profile_job_title_placeholder()}
            className="naxatw-mt-1"
            {...register("job_title", {
              // required: 'Job Title is Required',
            })}
          />
          <ErrorMessage message={formProps.formState.errors?.job_title?.message} />
        </FormControl>
      </FlexColumn>
    </section>
  );
}
