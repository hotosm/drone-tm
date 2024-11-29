import { ChangeEvent, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import useCustomUpload from '@Hooks/useCustomUpload';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import Icon from '@Components/common/Icon';
import Image from '@Components/RadixComponents/Image';
import { UseFormPropsType } from '../FormUI/types';
import { Input } from '../FormUI';

type FileType = File & {
  lastModifiedDate: Date;
};

type UploadedFilesType = {
  id: string;
  previewUrl: string;
  file: FileType;
}[];

type FileEvent = ChangeEvent<HTMLInputElement> & {
  target: EventTarget & { files: FileList };
};

interface IFileUploadProps extends UseFormPropsType {
  name: string;
  multiple?: boolean;
  fileAccept?: string;
  data?: [];
  placeholder?: string;
  onChange?: any;
  isValid?: // eslint-disable-next-line no-unused-vars
  | ((value: any) => boolean | undefined)
    // eslint-disable-next-line no-unused-vars
    | ((value: any) => Promise<boolean | undefined>);
}

export default function FileUpload({
  name,
  register,
  setValue,
  multiple,
  fileAccept = 'image/*',
  data,
  placeholder,
  onChange,
  isValid = () => true,
}: IFileUploadProps) {
  const [inputRef, onFileUpload] = useCustomUpload();
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFilesType>([]);

  // for edit
  useEffect(() => {
    // @ts-ignore
    if (!data || !multiple || (data && typeof data?.[0] !== 'string')) return;
    const uploaded = data.map((url: string) => {
      const urlArray = url?.split('/');
      return {
        id: uuidv4(),
        previewURL: url,
        file: { name: urlArray?.[urlArray.length - 1] || null },
      };
    });
    //   @ts-ignore
    setUploadedFiles(uploaded);
  }, [data, multiple]);

  // register form element to useForm
  useEffect(() => {
    register(name);
    if (!data) {
      setValue(name, []);
    } else if (typeof data === 'string' && !multiple) {
      // @ts-ignore
      const urlArray = data.split('/');
      setUploadedFiles([
        {
          // @ts-ignore
          id: uuidv4(),
          previewURL: data,
          // @ts-ignore
          file: { name: urlArray?.[urlArray.length - 1] || null },
        },
      ]);
    }
  }, [register, name, setValue, data, multiple]);

  const handleFileUpload = async (event: FileEvent) => {
    const { files } = event.target;
    const uploaded = Array.from(files).map(file => ({
      id: uuidv4(),
      previewURL: URL.createObjectURL(file),
      file,
    }));
    const uploadedFilesState = multiple
      ? [...uploadedFiles, ...uploaded]
      : uploaded;

    const valid = await isValid?.(uploadedFilesState);
    if (!valid) return;
    //   @ts-ignore
    setUploadedFiles(uploadedFilesState);
    setValue(name, uploadedFilesState, { shouldDirty: true });
    onChange?.(uploadedFilesState);
  };

  function downloadBlob(blobURL: string, fileName: string) {
    const link = document.createElement('a');
    link.href = blobURL;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const handleDeleteFile = (id: string) => {
    const updatedData = uploadedFiles.filter(file => file.id !== id);
    setUploadedFiles(updatedData);
    setValue(name, updatedData, { shouldDirty: true });
  };

  return (
    <FlexColumn gap={2}>
      <FlexColumn
        className="naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-lg naxatw-border-2 naxatw-border-dashed naxatw-bg-white naxatw-px-1.5 naxatw-py-2.5"
        //   @ts-ignore
        onClick={onFileUpload}
      >
        <Icon name="backup" className="naxatw-text-3xl naxatw-text-red" />
        <p className="naxatw-mt-1 naxatw-text-center naxatw-text-xs naxatw-leading-4 naxatw-text-grey-600">
          {placeholder || 'Please upload picture (jpeg, png file format)'}
        </p>
        <Input
          ref={inputRef}
          type="file"
          className="naxatw-hidden"
          multiple={multiple}
          onChange={handleFileUpload}
          accept={fileAccept}
        />
      </FlexColumn>
      <FlexColumn
        gap={2}
        className="scrollbar naxatw-max-h-52 naxatw-overflow-auto"
      >
        {uploadedFiles &&
          Array.isArray(uploadedFiles) &&
          // @ts-ignore
          uploadedFiles?.map(({ file, id, previewURL }) => (
            <FlexRow
              key={id}
              className="naxatw-items-center naxatw-justify-between naxatw-rounded-lg naxatw-border naxatw-px-4 naxatw-py-2"
            >
              <FlexRow gap={4} className="naxatw-min-h-10 naxatw-items-center">
                <Image src={previewURL} width={40} alt="" />
                <FlexColumn>
                  <h5 className="naxatw-text-sm">{file?.name}</h5>
                  {file && file?.lastModified && (
                    <p className="naxatw-text-xs naxatw-text-grey-600">
                      Uploaded on{' '}
                      {format(new Date(file.lastModified), 'MMM dd yyyy')}
                    </p>
                  )}
                </FlexColumn>
              </FlexRow>
              <FlexRow gap={2}>
                <Icon
                  name="download"
                  className="naxatw-text-grey-400"
                  onClick={() => downloadBlob(previewURL, file?.name)}
                />
                <Icon
                  name="delete"
                  className="naxatw-text-red-500"
                  onClick={() => handleDeleteFile(id)}
                />
              </FlexRow>
            </FlexRow>
          ))}
      </FlexColumn>
    </FlexColumn>
  );
}
