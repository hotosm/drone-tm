import { useEffect, useRef, useState } from "react";
import { FormControl, Label, Input } from "@Components/common/FormUI";
import ErrorMessage from "@Components/common/FormUI/ErrorMessage";
import { UseFormPropsType } from "@Components/common/FormUI/types";
import { Controller } from "react-hook-form";
import { getProjectsList } from "@Services/createproject";
import { m } from "@/paraglide/messages";
import AdvancedConfig from "./AdvancedConfig";

export default function BasicInformation({ formProps }: { formProps: UseFormPropsType }) {
  const { register, errors, control, watch } = formProps;
  const [nameExistsError, setNameExistsError] = useState("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nameValue = watch("name");

  useEffect(() => {
    setNameExistsError("");

    if (!nameValue || nameValue.trim().length === 0) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const trimmedName = nameValue.trim();
        const response = await getProjectsList({ search: trimmedName });
        const projects = response?.data?.results || [];
        const exactMatch = projects.some(
          (p: any) => p.name?.toLowerCase() === trimmedName.toLowerCase(),
        );
        if (exactMatch) {
          setNameExistsError(m.create_basic_name_exists());
        }
      } catch {
        // silently ignore lookup errors
      }
    }, 1200);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [nameValue]);

  return (
    <div className="naxatw-h-full">
      <FormControl className="naxatw-gap-1">
        <Label required>{m.create_basic_name_label()}</Label>
        <Input
          placeholder={m.create_basic_name_placeholder()}
          {...register("name", {
            required: m.create_basic_name_required(),
            setValueAs: (value: string) => value.trim(),
          })}
        />
        <ErrorMessage message={(errors?.name?.message as string) || nameExistsError} />
      </FormControl>
      <FormControl className="naxatw-mt-5 naxatw-gap-1">
        <Label>{m.create_basic_description_label()}</Label>
        <Controller
          control={control}
          name="description"
          render={({ field: { onChange, onBlur, value, ref, ...others } }) => (
            <textarea
              className="naxatw-flex naxatw-h-[100px] naxatw-rounded-[4px] naxatw-border naxatw-border-[#555555] naxatw-bg-transparent naxatw-p-2 naxatw-text-body-md file:naxatw-font-medium hover:naxatw-border-red focus:naxatw-border-red focus:naxatw-bg-transparent focus:naxatw-outline-none disabled:naxatw-cursor-not-allowed"
              placeholder={m.create_basic_description_placeholder()}
              onChange={onChange}
              value={value}
              {...others}
            />
          )}
        />
        <ErrorMessage message={errors?.description?.message as string} />
      </FormControl>
      <AdvancedConfig formProps={formProps} />
    </div>
  );
}
