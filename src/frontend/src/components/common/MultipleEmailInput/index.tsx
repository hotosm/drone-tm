import { FormEvent, KeyboardEvent, useState } from 'react';
import { FormControl, Input } from '../FormUI';
import ErrorMessage from '../FormUI/ErrorMessage';
import { FlexRow } from '../Layouts';

interface IMultipleEmailInput {
  emails: string[] | [];
  // eslint-disable-next-line no-unused-vars
  onEmailAdd: (emails: string[]) => void;
}

const MultipleEmailInput = ({ emails, onEmailAdd }: IMultipleEmailInput) => {
  const [inputEmail, setInputEmail] = useState('');
  const [emailList, setEmailList] = useState(emails || []);
  const [error, setError] = useState('');

  const handleChange = (e: FormEvent<HTMLInputElement>) => {
    setInputEmail(e.currentTarget.value?.trim());
    setError('');
  };

  const addInputEmailOnList = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/?.test(inputEmail))
      return setError('Email is invalid');
    if (emailList?.find(email => email === inputEmail))
      return setError('Email already exists on list');
    setInputEmail('');
    const newEmailList = [...emailList, inputEmail];

    setEmailList(prev => {
      const newList = [...prev, inputEmail];
      onEmailAdd(newList);
      return newList;
    });
    onEmailAdd(newEmailList);
    return () => {};
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      addInputEmailOnList();
    }
    return () => {};
  };

  const handleDeleteEmail = (email: string) => {
    setEmailList(prev => {
      const newList = prev?.filter(prevEmail => prevEmail !== email);
      onEmailAdd(newList);
      return newList;
    });
  };

  return (
    <FormControl className="naxatw-relative">
      <Input
        placeholder="Enter email and press enter or click  '+'  icon to add"
        onChange={handleChange}
        value={inputEmail}
        onKeyDown={handleKeyDown}
      />

      <i
        className="material-icons naxatw-absolute naxatw-right-2 naxatw-top-[6px] naxatw-z-30 naxatw-cursor-pointer naxatw-rounded-full naxatw-text-red hover:naxatw-bg-redlight"
        onClick={() => addInputEmailOnList()}
        role="button"
        tabIndex={0}
        onKeyDown={() => {}}
      >
        add
      </i>

      <ErrorMessage message={error} />
      <FlexRow gap={2} className="naxatw-flex-wrap">
        {emailList?.map((email: string) => (
          <div
            key={email}
            className="naxatw-flex naxatw-w-fit naxatw-items-center naxatw-gap-1 naxatw-rounded-xl naxatw-border naxatw-border-black naxatw-bg-gray-50 naxatw-px-2 naxatw-py-0.5"
          >
            <div className="naxatw-flex naxatw-items-center naxatw-text-sm naxatw-leading-4">
              {email}
            </div>
            <i
              className="material-icons naxatw-cursor-pointer naxatw-rounded-full naxatw-text-center naxatw-text-base hover:naxatw-bg-redlight"
              tabIndex={0}
              role="button"
              onKeyDown={() => {}}
              onClick={() => handleDeleteEmail(email)}
            >
              close
            </i>
          </div>
        ))}
      </FlexRow>
    </FormControl>
  );
};

export default MultipleEmailInput;
