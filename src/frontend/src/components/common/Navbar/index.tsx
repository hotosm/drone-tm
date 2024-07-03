import Image from '@Components/RadixComponents/Image';
import { NavLink } from 'react-router-dom';
import dtmLogo from '@Assets/images/dtm-logo.svg';
import { navLinks } from '@Constants/index';
import UserProfile from '../UserProfile';
import { FlexRow } from '../Layouts';
import Icon from '../Icon';

export default function Navbar() {
  return (
    <nav className="naxatw-border-b naxatw-border-grey-300 naxatw-pb-2 naxatw-pt-4">
      <FlexRow className="naxatw-items-center naxatw-justify-between naxatw-px-16">
        <Image src={dtmLogo} alt="DTM-logo" />
        <FlexRow className="naxatw-gap-4">
          {navLinks.map(({ id, link, linkName }) => (
            <NavLink
              key={id}
              to={link}
              className={({ isActive }) =>
                `${
                  isActive
                    ? 'naxatw-border-b-2 naxatw-border-red'
                    : 'hover:naxatw-border-b-2 hover:naxatw-border-grey-900'
                } -naxatw-mb-[1.2rem] naxatw-px-3 naxatw-pb-2 naxatw-text-body-btn`
              }
            >
              {linkName}
            </NavLink>
          ))}
        </FlexRow>
        <FlexRow className="naxatw-items-center" gap={2}>
          <Icon name="notifications" />
          <UserProfile />
        </FlexRow>
      </FlexRow>
    </nav>
  );
}
