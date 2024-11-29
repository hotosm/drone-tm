/* eslint-disable no-console */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@Components/RadixComponents/Button';
import { setSecondPage } from '@Store/actions/droneOperatorTask';
import { useTypedDispatch } from '@Store/hooks';
import { postUnflyableComment } from '@Services/droneOperator';
import { toast } from 'react-toastify';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import UploadsBox from '../UploadsBox';

interface IQuestionBoxProps {
  flyable: string;
  setFlyable: React.Dispatch<React.SetStateAction<any>>;
  haveNoImages: boolean;
}

const QuestionBox = ({
  flyable,
  setFlyable,
  haveNoImages,
}: IQuestionBoxProps) => {
  const { projectId, taskId } = useParams();
  const navigate = useNavigate();

  const dispatch = useTypedDispatch();
  const [comment, setComment] = useState('');
  const variants = {
    open: { opacity: 1, y: 0 },
    closed: { opacity: 0, y: '-100%' },
  };
  function handleFlyableChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFlyable(e.target.value);
  }

  const { mutate: mutateComment, isLoading: commentIsUpdating } = useMutation(
    (data: any) => postUnflyableComment({ projectId, taskId, data }),
    {
      onSuccess: () => {
        // Optionally, refetch queries or show a success message
        toast.success('Comment Added successfully');
        navigate(`/projects/${projectId}`);
      },
      onError: (error: Record<string, any>) => {
        // Handle error
        toast.error(error?.message);
      },
    },
  );
  function handleSubmit() {
    if (flyable === 'no') {
      const data = {
        event: 'comment',
        comment,
      };
      mutateComment(data);
    } else {
      dispatch(setSecondPage(true));
    }
  }

  return (
    <>
      <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-gap-5">
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
          <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-text-[#212121]">
            Is this task flyable ?
          </p>
          <div className="naxatw-flex naxatw-flex-col">
            <div className="naxatw-flex naxatw-items-center naxatw-gap-1">
              <input
                type="radio"
                id="yes"
                value="yes"
                checked={flyable === 'yes'}
                onChange={handleFlyableChange}
              />
              <label
                htmlFor="yes"
                className="naxatw-text-[0.875rem] naxatw-text-[#212121]"
              >
                Yes
              </label>
            </div>
            <div className="naxatw-flex naxatw-items-center naxatw-gap-1">
              <input
                type="radio"
                id="no"
                value="no"
                checked={flyable === 'no'}
                onChange={handleFlyableChange}
              />
              <label
                htmlFor="no"
                className="naxatw-text-[0.875rem] naxatw-text-[#212121]"
              >
                No
              </label>
            </div>
          </div>
        </div>
        <motion.div
          animate={flyable === 'yes' ? 'closed' : 'open'}
          variants={variants}
          className={` ${flyable === 'yes' ? 'naxatw-hidden' : 'naxatw-block'} naxatw-flex naxatw-flex-col naxatw-items-start naxatw-gap-1 naxatw-self-stretch`}
        >
          <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-text-[#484848]">
            Comment
          </p>
          <textarea
            className="naxatw-w-full naxatw-resize-none naxatw-rounded-[0.25rem] naxatw-border naxatw-border-[#555] naxatw-p-2"
            placeholder="Comment"
            value={comment}
            onChange={e => setComment(e.target.value)}
          />

          <div className="naxatw-my-4 naxatw-flex naxatw-w-full naxatw-justify-center">
            <Button
              variant="ghost"
              className="naxatw-w-fit naxatw-bg-[#D73F3F] naxatw-text-[#FFFFFF]"
              onClick={() => handleSubmit()}
              disabled={flyable === 'no' && comment.length < 6}
              isLoading={commentIsUpdating}
            >
              Save
            </Button>
          </div>
        </motion.div>
        {flyable === 'yes' && haveNoImages && <UploadsBox />}
      </div>
    </>
  );
};
export default QuestionBox;
