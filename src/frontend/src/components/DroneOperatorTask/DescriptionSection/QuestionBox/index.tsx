/* eslint-disable no-console */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@Components/RadixComponents/Button';
import { setSecondPage } from '@Store/actions/droneOperatorTask';
import { useTypedDispatch } from '@Store/hooks';
import { postUnflyableComment } from '@Services/droneOperator';
import { useMutation } from '@tanstack/react-query';

const QuestionBox = () => {
  const dispatch = useTypedDispatch();
  const [flyable, setFlyable] = useState('yes');
  const [comment, setComment] = useState('');
  const variants = {
    open: { opacity: 1, y: 0 },
    closed: { opacity: 0, y: '-100%' },
  };
  function handleFlyableChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFlyable(e.target.value);
  }

  const projectId = '9deb9a04-374a-40ab-ae81-3d44812b27ec';
  const taskId = 'f2c7fde5-33d3-4a84-aa34-413a62409df2';
  const mutation = useMutation(
    (data: any) => postUnflyableComment({ projectId, taskId, data }),
    {
      onSuccess: () => {
        // Optionally, refetch queries or show a success message
        console.log('User created successfully');
      },
      onError: error => {
        // Handle error
        console.error('Error creating user:', error);
      },
    },
  );
  function handleSubmit() {
    if (flyable === 'no') {
      const data = {
        event: 'comment',
        newComment: comment,
      };
      mutation.mutate(data);
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
        </motion.div>
        <Button
          variant="ghost"
          rightIcon={flyable === 'yes' ? 'chevron_right' : ''}
          className="naxatw-w-fit naxatw-bg-[#D73F3F] naxatw-text-[#FFFFFF]"
          onClick={() => handleSubmit()}
          disabled={flyable === 'no' && comment.length < 6}
          isLoading={mutation.isLoading}
        >
          {flyable === 'no' ? 'Save' : 'Proceed'}
        </Button>
      </div>
    </>
  );
};
export default QuestionBox;
