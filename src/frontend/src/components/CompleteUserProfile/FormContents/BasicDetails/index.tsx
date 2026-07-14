import { Flex, FlexColumn } from "@Components/common/Layouts";
import { FormControl, Select, Input, Label } from "@Components/common/FormUI";
import ErrorMessage from "@Components/common/ErrorMessage";
import { Controller } from "react-hook-form";
import { getLocalStorageValue } from "@Utils/getLocalStorageValue";
import { countries } from "countries-list";
import { m } from "@/paraglide/messages";

export default function BasicDetails({ formProps }: { formProps: any }) {
  const { register, formState, control } = formProps;

  const userProfile = getLocalStorageValue("userprofile");

  // eslint-disable-next-line no-unused-vars
  const countryList = Object.entries(countries).map(([_, value]) => ({
    name: value?.name,
    phone: value?.phone?.[0],
  }));

  return (
    <section className="naxatw-px-14">
      <Flex>
        <p className="naxatw-text-lg naxatw-font-bold">{m.profile_basic_details()}</p>
      </Flex>
      <FlexColumn gap={5} className="naxatw-mt-5">
        <Flex className="naxatw-h-14 naxatw-w-14 naxatw-items-center naxatw-justify-center naxatw-overflow-hidden naxatw-rounded-full naxatw-bg-grey-600">
          <img src={userProfile.profile_img} alt={m.common_profile_picture_alt()} />
        </Flex>
        <FormControl>
          <Label>{m.profile_name_label()}</Label>
          <Input
            placeholder={m.profile_name_placeholder()}
            className="naxatw-mt-1"
            {...register("name", {
              required: m.profile_name_required(),
            })}
            readOnly
          />
          <ErrorMessage message={formState.errors?.name?.message} />
        </FormControl>
        <FormControl>
          <Label>{m.profile_country_label()}</Label>
          <Controller
            control={control}
            name="country"
            defaultValue=""
            render={({ field: { value, onChange } }) => (
              <Select
                withSearch
                placeholder={m.profile_country_placeholder()}
                options={countryList}
                labelKey="name"
                valueKey="name"
                selectedOption={value}
                onChange={onChange}
              />
            )}
          />
          <ErrorMessage message={formState.errors?.country?.message} />
        </FormControl>
        <FormControl>
          <Label>{m.profile_city_label()}</Label>
          <Input
            placeholder={m.profile_city_placeholder()}
            className="naxatw-mt-1"
            {...register("city", {
              setValueAs: (value: string) => value?.trim(),
            })}
          />
          <ErrorMessage message={formState.errors?.city?.message} />
        </FormControl>
        <FormControl>
          <Label>{m.profile_phone_number_label()}</Label>
          <div className="naxatw-flex naxatw-space-x-1">
            {/* <Input
              placeholder="+977"
              className="naxatw-mt-1 naxatw-w-14"
              {...register('country_code', {
                required: 'Phone Number is Required',
              })}
            /> */}
            <Input
              placeholder={m.profile_phone_number_placeholder()}
              className="naxatw-mt-1 naxatw-w-full"
              type="number"
              {...register("phone_number", {
                minLength: {
                  value: 5,
                  message: m.profile_phone_number_invalid(),
                },
              })}
            />
          </div>
          <ErrorMessage message={formState.errors?.phone_number?.message} />
        </FormControl>
      </FlexColumn>
    </section>
  );
}
