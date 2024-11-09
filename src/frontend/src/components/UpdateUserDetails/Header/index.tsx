import BreadCrumb from '@Components/common/Breadcrumb';

const Header = () => {
  return (
    <div className="naxatw-py-1">
      <BreadCrumb
        data={[
          { name: 'Dashboard', navLink: '/' },
          { name: 'Edit Profile', navLink: '' },
        ]}
      />
    </div>
  );
};

export default Header;
