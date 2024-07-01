import type {
  Control,
  FieldErrors,
  FieldValues,
  UseFormGetValues,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from 'react-hook-form';

export interface UseFormPropsType {
  register: UseFormRegister<FieldValues>;
  control: Control;
  errors: FieldErrors<FieldValues>;
  setValue: UseFormSetValue<FieldValues>;
  getValues?: UseFormGetValues<FieldValues>;
  watch?: UseFormWatch<FieldValues>;
}
