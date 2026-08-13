import ErrorMessage from "@Components/common/ErrorMessage";
import { FormControl, Input } from "@Components/common/FormUI";
import { FlexRow } from "@Components/common/Layouts";
import { Button } from "@Components/RadixComponents/Button";
import { uploadToOAM } from "@Services/project";
import { toggleModal } from "@Store/actions/common";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getLocalStorageValue } from "@Utils/getLocalStorageValue";
import { useState, KeyboardEvent } from "react";
import { useDispatch } from "react-redux";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { m } from "@/paraglide/messages";

const UploadToOAM = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const pathname = window.location.pathname?.split("/");
  const projectId = pathname?.[2];
  const userProfile = getLocalStorageValue("userprofile");
  const [inputTag, setInputTag] = useState("");
  const [error, setError] = useState("");
  const [tagList, setTagList] = useState<string[]>(["dronetm", "hotosm", "naxa"]);

  const addInputTagOnList = () => {
    if (!inputTag) return setError(m.common_required());
    if (tagList?.find((tag) => tag === inputTag))
      return setError(m.individual_project_oam_tag_exists());
    setInputTag("");
    setTagList((prev) => [...prev, inputTag]);
    return () => {};
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      addInputTagOnList();
    }
    return () => {};
  };

  const handleDeleteTag = (tag: string) => {
    setTagList((prev) => {
      const newList = prev?.filter((prevTag) => prevTag !== tag);
      return newList;
    });
  };

  const { mutate } = useMutation({
    mutationFn: uploadToOAM,
    onSuccess: (data) => {
      dispatch(toggleModal());
      queryClient.invalidateQueries({
        queryKey: ["project-detail", projectId],
      });
      if (data?.data?.detail) {
        toast.success(data?.data?.detail);
      } else {
        toast.success(m.individual_project_oam_upload_started());
      }
    },
  });

  const handleUpload = () => {
    if (!tagList?.length) return setError(m.common_required());
    return mutate({ projectId, tags: tagList });
  };

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-4">
      <div>
        <h3 className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-800">
          {m.individual_project_oam_tags_title()}
        </h3>
        <p className="naxatw-mt-1 naxatw-text-xs naxatw-text-gray-500">
          {m.individual_project_oam_tags_desc()}
        </p>
      </div>

      <FormControl className="naxatw-relative">
        <Input
          placeholder={m.individual_project_oam_tag_placeholder()}
          onChange={(e) => {
            setInputTag(e.currentTarget.value?.trim());
            setError("");
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
              className="naxatw-flex naxatw-w-fit naxatw-items-center naxatw-gap-1 naxatw-rounded-full naxatw-border naxatw-border-gray-200 naxatw-bg-gray-100 naxatw-px-2 naxatw-py-0.5"
            >
              <div className="naxatw-flex naxatw-items-center naxatw-text-xs naxatw-font-medium naxatw-leading-4 naxatw-text-gray-700">
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

      <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-2">
        {!userProfile?.has_oam_token && (
          <p className="naxatw-text-center naxatw-text-xs naxatw-text-amber-700">
            {m.individual_project_oam_token_required_prefix()}
            <Link
              to="/user-profile"
              className="naxatw-px-1 naxatw-text-blue-700 naxatw-underline-offset-2 hover:naxatw-underline"
              onClick={() => dispatch(toggleModal())}
              title={m.individual_project_oam_token_link_title()}
            >
              {m.individual_project_oam_token_required_link()}
            </Link>
          </p>
        )}
        <Button
          variant="ghost"
          className="naxatw-bg-red naxatw-px-8 naxatw-py-2 naxatw-text-white disabled:naxatw-bg-gray-400"
          withLoader
          leftIcon="upload"
          onClick={() => handleUpload()}
          disabled={!userProfile?.has_oam_token}
        >
          {m.individual_project_oam_upload_button()}
        </Button>
      </div>
    </div>
  );
};

export default UploadToOAM;
