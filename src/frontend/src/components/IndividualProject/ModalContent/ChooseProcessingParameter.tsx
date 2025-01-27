import RadioButton from '@Components/common/RadioButton';
import { Button } from '@Components/RadixComponents/Button';
import { startProcessingOptions } from '@Constants/projectDescription';
import { processAllImagery } from '@Services/project';
import { toggleModal } from '@Store/actions/common';
import { setProjectState } from '@Store/actions/project';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';

const ChooseProcessingParameter = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const pathname = window.location.pathname?.split('/');
  const projectId = pathname?.[2];

  const [value, setValue] = useState('with_gcp');
  const { mutate: startImageProcessing } = useMutation({
    mutationFn: processAllImagery,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-detail'] });
      toast.success('Processing started');
    },
  });

  return (
    <div>
      <p className="naxatw-text-sm naxatw-text-[#7A7676]">
        Choose Processing Parameter
      </p>
      <div className="naxatw-py-1 naxatw-text-gray-700">
        <RadioButton
          className="!naxatw-text-black"
          options={startProcessingOptions}
          direction="column"
          onChangeData={selectedValue => setValue(selectedValue)}
          value={value}
        />
      </div>
      <div className="naxatw naxatw-flex naxatw-justify-center naxatw-pt-3">
        <Button
          withLoader
          className="naxatw-bg-red"
          onClick={() => {
            if (value === 'with_gcp') {
              dispatch(setProjectState({ showGcpEditor: true }));
            } else {
              startImageProcessing({ projectId });
            }
            dispatch(toggleModal());
          }}
        >
          Proceed
        </Button>
      </div>
    </div>
  );
};

export default ChooseProcessingParameter;
