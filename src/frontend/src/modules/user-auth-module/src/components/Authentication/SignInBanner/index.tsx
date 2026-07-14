import { Flex } from "@Components/common/Layouts";
import BannerImage from "@Assets/images/login-banner.png";
import { m } from "@/paraglide/messages";

export default function SignInBanner() {
  return (
    <Flex className="naxatw-hidden naxatw-h-screen naxatw-w-full naxatw-overflow-hidden md:naxatw-block">
      <img
        src={BannerImage}
        className="naxatw-h-full naxatw-w-full naxatw-object-cover"
        alt={m.auth_signin_banner_alt()}
      />
    </Flex>
  );
}
