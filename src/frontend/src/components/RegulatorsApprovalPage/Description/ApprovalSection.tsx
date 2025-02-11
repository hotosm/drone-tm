import { Button } from '@Components/RadixComponents/Button';
import { regulatorComment } from '@Services/createproject';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'react-toastify';

const ApprovalSection = () => {
  const { id } = useParams();
  const [comment, setComment] = useState('');
  const queryClient = useQueryClient();

  const { mutate: commentToProject, isPending } = useMutation<
    any,
    any,
    any,
    unknown
  >({
    mutationFn: regulatorComment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-detail'] });
      toast.success('Approval status saved with comment successfully');
      setComment('');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || err?.message || '');
    },
  });

  const handleApprovalStatus = (status: string) => {
    commentToProject({
      regulator_comment: comment,
      regulator_approval_status: status,
      projectId: id,
    });
  };

  return (
    <>
      {' '}
      <div className="naxatw-mt-6 naxatw-flex naxatw-flex-col naxatw-gap-1">
        <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem]">
          Comment
        </p>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Comment"
          name=""
          id=""
          cols={4}
          className="naxatw-w-full naxatw-rounded-md naxatw-border naxatw-border-gray-800 naxatw-p-1"
        />
      </div>
      <div className="naxatw-flex naxatw-items-start naxatw-justify-start naxatw-gap-2">
        <Button
          variant="outline"
          onClick={() => handleApprovalStatus('REJECTED')}
          className="naxatw-border-red naxatw-font-primary naxatw-text-red"
          isLoading={isPending}
          disabled={isPending}
        >
          Reject
        </Button>
        <Button
          variant="ghost"
          onClick={() => handleApprovalStatus('APPROVED')}
          className="naxatw-bg-red naxatw-font-primary naxatw-text-white"
          isLoading={isPending}
          disabled={isPending}
        >
          Accept
        </Button>
      </div>{' '}
    </>
  );
};

export default ApprovalSection;
