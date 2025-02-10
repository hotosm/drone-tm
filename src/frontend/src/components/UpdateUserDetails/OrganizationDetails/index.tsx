import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import ErrorMessage from '@Components/common/ErrorMessage';
import { FormControl, Input, Label } from '@Components/common/FormUI';
import { Flex, FlexColumn } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';
import { patchUserProfile } from '@Services/common';
import { getLocalStorageValue } from '@Utils/getLocalStorageValue';

const OrganizationDetails = () => {
  const userProfile = getLocalStorageValue('userprofile');

  const initialState = {
    organization_name: userProfile?.organization_name || null,
    organization_address: userProfile?.organization_address || null,
    job_title: userProfile?.job_title || null,
  };
  const queryClient = useQueryClient();

  const { register, handleSubmit, formState } = useForm({
    defaultValues: initialState,
  });

  const { mutate: updateOrganizationDetails, isPending } = useMutation<
    any,
    any,
    any,
    unknown
  >({
    mutationFn: payloadDataObject => patchUserProfile(payloadDataObject),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ['user-profile']});

      toast.success('Details Updated successfully');
    },
    onError: err => {
      // eslint-disable-next-line no-console
      console.log(err);
      toast.error(err?.response?.data?.detail || 'Something went wrong');
    },
  });

  const onSubmit = (formData: Record<string, any>) => {
    updateOrganizationDetails({ userId: userProfile?.id, data: formData });
  };

  return (
    <section className="naxatw-w-full naxatw-px-14">
      <Flex>
        <p className="naxatw-mb-2 naxatw-text-lg naxatw-font-bold">
          Organization Details
        </p>
      </Flex>
      <FlexColumn gap={5}>
        <FormControl>
          <Label>Organization Name</Label>
          <Input
            placeholder="Enter Organization Name"
            className="naxatw-mt-1"
            {...register('organization_name', {
              // required: 'Organization name is Required',
            })}
          />
          <ErrorMessage
            message={formState.errors?.organization_name?.message as string}
          />
        </FormControl>
        <FormControl>
          <Label>Organization Address</Label>
          <Input
            placeholder="Enter Organization Address"
            className="naxatw-mt-1"
            {...register('organization_address', {
              // required: 'Organization Address is Required',
            })}
          />
          <ErrorMessage
            message={formState.errors?.organization_address?.message as string}
          />
        </FormControl>
        <FormControl>
          <Label>Job Title</Label>
          <Input
            placeholder="Enter Job Title"
            className="naxatw-mt-1"
            {...register('job_title', {
              // required: 'Job Title is Required',
            })}
          />
          <ErrorMessage
            message={formState.errors?.job_title?.message as string}
          />
        </FormControl>
      </FlexColumn>
      <div className="naxatw-flex naxatw-justify-center naxatw-py-4">
        <Button
          className="naxatw-bg-red"
          onClick={e => {
            e.preventDefault();
            handleSubmit(onSubmit)();
          }}
          withLoader
          isLoading={isPending}
        >
          Save
        </Button>
      </div>
    </section>
  );
};

export default OrganizationDetails;
