import Image from '@Components/RadixComponents/Image';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import dtmLogo from '@Assets/images/DTM-logo-black.svg';
import UserProfile from '../UserProfile';
import { FlexRow } from '../Layouts';
import Icon from '../Icon';

export default function Navbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="naxatw-border-b naxatw-border-grey-300 naxatw-pb-2 naxatw-pt-4">
      <FlexRow className="naxatw-items-center naxatw-justify-between naxatw-px-16">
        <div
          className="naxatw-cursor-pointer"
          role="presentation"
          onClick={() => navigate('/dashboard')}
        >
          <Image
            src={dtmLogo}
            alt="DTM-logo"
            className="naxatw-h-8 naxatw-w-40"
          />
        </div>
        <FlexRow className="naxatw-gap-4">
          <NavLink
            to="/projects"
            className={({ isActive }) =>
              `${
                isActive || pathname.includes('project')
                  ? 'naxatw-border-b-2 naxatw-border-red'
                  : 'hover:naxatw-border-b-2 hover:naxatw-border-grey-900'
              } -naxatw-mb-[1.2rem] naxatw-px-3 naxatw-pb-2 naxatw-text-body-btn`
            }
          >
            Projects
          </NavLink>
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `${
                isActive
                  ? 'naxatw-border-b-2 naxatw-border-red'
                  : 'hover:naxatw-border-b-2 hover:naxatw-border-grey-900'
              } -naxatw-mb-[1.2rem] naxatw-px-3 naxatw-pb-2 naxatw-text-body-btn`
            }
          >
            Dashboard
          </NavLink>
        </FlexRow>
        <FlexRow className="naxatw-items-center" gap={2}>
          <Icon name="notifications" />
          <UserProfile />
        </FlexRow>
      </FlexRow>
    </nav>
  );
}
