import ErrorMessage from '@Components/common/ErrorMessage';
import { FormControl, Input } from '@Components/common/FormUI';
import { FlexRow } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';
import { uploadToOAM } from '@Services/project';
import { toggleModal } from '@Store/actions/common';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getLocalStorageValue } from '@Utils/getLocalStorageValue';
import { useState, KeyboardEvent } from 'react';
import { useDispatch } from 'react-redux';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';

const UploadToOAM = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const pathname = window.location.pathname?.split('/');
  const projectId = pathname?.[2];
  const userProfile = getLocalStorageValue('userprofile');
  const [inputTag, setInputTag] = useState('');
  const [error, setError] = useState('');
  const [tagList, setTagList] = useState<string[]>([
    'dronetm',
    'hotosm',
    'naxa',
  ]);

  const addInputTagOnList = () => {
    if (!inputTag) return setError('Required');
    if (tagList?.find(tag => tag === inputTag))
      return setError('Tag already exists on list');
    setInputTag('');
    setTagList(prev => [...prev, inputTag]);
    return () => {};
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      addInputTagOnList();
    }
    return () => {};
  };

  const handleDeleteTag = (tag: string) => {
    setTagList(prev => {
      const newList = prev?.filter(prevTag => prevTag !== tag);
      return newList;
    });
  };

  const { mutate } = useMutation({
    mutationFn: uploadToOAM,
    onSuccess: data => {
      dispatch(toggleModal());
      queryClient.invalidateQueries({
        queryKey: ['project-detail', projectId],
      });
      if (data?.data?.detail) {
        toast.success(data?.data?.detail);
      } else {
        toast.success('Started Uploading to OAM');
      }
    },
  });

  const handleUpload = () => {
    if (!tagList?.length) return setError('Required');
    return mutate({ projectId, tags: tagList });
  };

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-4">
      <FormControl className="naxatw-relative">
        <Input
          placeholder="Enter tag and press enter or click  '+'  icon to add"
          onChange={e => {
            setInputTag(e.currentTarget.value?.trim());
            setError('');
          }}
          value={inputTag}
          onKeyDown={handleKeyDown}
        />

        <i
          className="material-icons naxatw-absolute naxatw-right-2 naxatw-top-[6px] naxatw-z-30 naxatw-cursor-pointer naxatw-rounded-full naxatw-text-red hover:naxatw-bg-redlight"
          onClick={() => addInputTagOnList()}
          role="button"
          tabIndex={0}
          onKeyDown={() => {}}
        >
          add
        </i>
        <ErrorMessage message={error} />

        <FlexRow gap={2} className="naxatw-flex-wrap naxatw-py-2">
          {tagList?.map((tag: string) => (
            <div
              key={tag}
              className="naxatw-flex naxatw-w-fit naxatw-items-center naxatw-gap-1 naxatw-rounded-xl naxatw-border naxatw-border-black naxatw-bg-gray-50 naxatw-px-2 naxatw-py-0.5"
            >
              <div className="naxatw-flex naxatw-items-center naxatw-text-sm naxatw-leading-4">
                {tag}
              </div>
              <i
                className="material-icons naxatw-cursor-pointer naxatw-rounded-full naxatw-text-center naxatw-text-base hover:naxatw-bg-redlight"
                tabIndex={0}
                role="button"
                onKeyDown={() => {}}
                onClick={() => handleDeleteTag(tag)}
              >
                close
              </i>
            </div>
          ))}
        </FlexRow>
      </FormControl>

      <div className="naxatw-flex naxatw-flex-col naxatw-justify-center naxatw-gap-1">
        <div className="naxatw-flex naxatw-justify-center">
          <Button
            className="naxatw-bg-red"
            withLoader
            leftIcon="upload"
            onClick={() => handleUpload()}
            disabled={!userProfile?.has_oam_token}
          >
            Upload
          </Button>
        </div>
        {!userProfile?.has_oam_token && (
          <p className="naxatw-text-yellow-600">
            Note: You need to have an OAM token to upload, please update it on
            your
            <Link
              to="/user-profile"
              className="naxatw-px-1 naxatw-text-lg naxatw-text-blue-700 hover:naxatw-underline"
              onClick={() => dispatch(toggleModal())}
              title="Go to edit profile"
            >
              profile.
            </Link>
          </p>
        )}
      </div>
    </div>
  );
};

export default UploadToOAM;
