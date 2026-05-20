import BreadCrumb from "@Components/common/Breadcrumb";
import { m } from "@/paraglide/messages";

const Header = () => {
  return (
    <div className="naxatw-py-1">
      <BreadCrumb
        data={[
          { name: m.profile_breadcrumb_dashboard(), navLink: "/" },
          { name: m.profile_breadcrumb_edit_profile(), navLink: "" },
        ]}
      />
    </div>
  );
};

export default Header;
