import { toast } from "react-toastify";
import { Controller, useForm } from "react-hook-form";
import { FormControl, Input, Label, Select } from "@Components/common/FormUI";
import { Flex, FlexColumn } from "@Components/common/Layouts";
import { getLocalStorageValue } from "@Utils/getLocalStorageValue";
import ErrorMessage from "@Components/common/ErrorMessage";
import { Button } from "@Components/RadixComponents/Button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { patchUserProfile } from "@Services/common";
import { countries } from "countries-list";
import { m } from "@/paraglide/messages";

const BasicDetails = () => {
  const userProfile = getLocalStorageValue("userprofile");
  const initialState = {
    name: userProfile?.name,
    country: userProfile?.country || null,
    city: userProfile?.city || null,
    phone_number: userProfile?.phone_number || null,
  };
  const queryClient = useQueryClient();

  const { register, handleSubmit, formState, control } = useForm({
    defaultValues: initialState,
  });

  const { mutate: updateBasicInfo, isPending } = useMutation<any, any, any, unknown>({
    mutationFn: (payloadDataObject) => patchUserProfile(payloadDataObject),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      toast.success(m.profile_details_updated_success());
    },
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.log(err);
      toast.error(err?.response?.data?.detail || m.profile_something_went_wrong());
    },
  });

  const onSubmit = (formData: Record<string, any>) => {
    updateBasicInfo({ userId: userProfile?.id, data: formData });
  };

  // eslint-disable-next-line no-unused-vars
  const countryList = Object.entries(countries).map(([_, value]) => ({
    name: value?.name,
    phone: value?.phone?.[0],
  }));

  return (
    <section className="naxatw-w-full naxatw-px-14">
      <Flex>
        <p className="naxatw-text-lg naxatw-font-bold">{m.profile_basic_details()}</p>
      </Flex>
      <FlexColumn gap={5} className="naxatw-mt-5">
        <Flex className="naxatw-h-14 naxatw-w-14 naxatw-items-center naxatw-justify-center naxatw-overflow-hidden naxatw-rounded-full naxatw-bg-grey-600">
          <img src={userProfile?.profile_img} alt={m.profile_profile_pic_alt_hyphen()} />
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
          <ErrorMessage message={formState?.errors?.name?.message as string} />
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
          <ErrorMessage message={formState?.errors?.country?.message as string} />
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
          <ErrorMessage message={formState.errors?.city?.message as string} />
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
          <ErrorMessage message={formState.errors?.phone_number?.message as string} />
        </FormControl>
      </FlexColumn>
      <div className="naxatw-flex naxatw-justify-center naxatw-py-4">
        <Button
          className="naxatw-bg-red"
          onClick={(e) => {
            e.preventDefault();
            handleSubmit(onSubmit)();
          }}
          withLoader
          isLoading={isPending}
        >
          {m.profile_save()}
        </Button>
      </div>
    </section>
  );
};

export default BasicDetails;
