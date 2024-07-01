/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
/* eslint-disable jsx-a11y/no-noninteractive-tabindex */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UserAvatar from '@Components/common/UserAvatar';
import { toast } from 'react-toastify';

export default function UserProfile() {
  const [toggle, setToggle] = useState(false);
  const navigate = useNavigate();

  const settingOptions = [
    {
      id: 1,
      name: 'Account Settings',
      icon: 'settings',
      onClick: () => {
        setToggle(false);
      },
    },
    {
      id: 2,
      name: 'Sign Out',
      icon: 'logout',
      onClick: () => {
        localStorage.clear();
        navigate('/login');
        toast.success('Logged Out Successfully');
      },
    },
  ];

  return (
    <div
      className="naxatw-relative"
      tabIndex={0}
      onBlur={() => setToggle(false)}
    >
      <div onClick={() => setToggle(!toggle)}>
        <UserAvatar className="naxatw-cursor-pointer" name="Prajwal" />
      </div>
      {toggle && (
        <div className="slide-in-top naxatw-absolute naxatw-right-0 naxatw-top-[3rem] naxatw-z-20">
          <ul className="naxatw-w-[8rem] naxatw-divide-y-2 naxatw-rounded-md naxatw-border naxatw-bg-white naxatw-p-1 naxatw-shadow-lg">
            {settingOptions.map(item => (
              <li
                key={item.id}
                className="naxatw-flex naxatw-cursor-pointer naxatw-items-center naxatw-gap-x-2 naxatw-p-2 naxatw-text-body-md hover:naxatw-bg-[#F5F5F5]"
                onClick={item.onClick}
              >
                <span className="material-icons">{item.icon}</span> {item.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
