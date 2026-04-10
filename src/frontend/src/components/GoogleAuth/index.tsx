/* eslint-disable no-unused-vars */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Flex } from "@Components/common/Layouts";
import { toast } from "react-toastify";
import { UserProfileDetailsType } from "./types";
import { getRuntimeConfig } from "@/runtimeConfig";

const API_URL = getRuntimeConfig("VITE_API_URL", "/api");

function GoogleAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isReadyToRedirect, setIsReadyToRedirect] = useState(false);
  const [userProfileDetails, setUserProfileDetails] = useState<UserProfileDetailsType>();
  const signedInAs = localStorage.getItem("signedInAs") || "PROJECT_CREATOR";

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const authcode = params.get("code");
    const state = params.get("state");

    const loginRedirect = async () => {
      if (authcode) {
        const callbackUrl = `${API_URL}/users/callback/?code=${authcode}&state=${state}&role=${signedInAs}`;
        const userDetailsUrl = `${API_URL}/users/my-info/`;

        const completeLogin = async () => {
          // fetch callback api
          const response = await fetch(callbackUrl, { credentials: "include" });
          if (!response.ok) {
            const msg = await response.text();
            throw new Error(`Google callback failed (${response.status}): ${msg}`);
          }
          const token = await response.json();
          localStorage.setItem("token", token.access_token);
          localStorage.setItem("refresh", token.refresh_token);

          // fetch user details
          const response2 = await fetch(userDetailsUrl, {
            credentials: "include",
            headers: { "access-token": token.access_token },
          });
          if (!response2.ok) {
            const msg2 = await response2.text();
            throw new Error(`Fetching my-info failed (${response2.status}): ${msg2}`);
          }

          const userDetails = await response2.json();
          // stringify the response and set it to local storage
          const userDetailsString = JSON.stringify(userDetails);
          localStorage.setItem("userprofile", userDetailsString);
          setUserProfileDetails(userDetails);

          const savedPath = sessionStorage.getItem("postLoginRedirect");
          if (savedPath) {
            sessionStorage.removeItem("postLoginRedirect");
          }

          // navigate according the user profile completion
          if (savedPath && savedPath.startsWith("/") && !savedPath.startsWith("//")) {
            navigate(savedPath, { replace: true });
          } else if (userDetails?.has_user_profile && userDetails?.role?.includes(signedInAs)) {
            navigate("/projects");
          } else {
            navigate("/complete-profile");
          }
        };
        try {
          await completeLogin();
          toast.success("Logged In Successfully");
        } catch (e: any) {
          console.error(e);
          toast.error(e?.message || "Login failed. Please try again.");
          navigate("/", { replace: true });
          return;
        }
      }
      setIsReadyToRedirect(true);
    };
    loginRedirect();
  }, [location.search, navigate, signedInAs]);

  return (
    <Flex className="naxatw-h-screen-nav naxatw-w-full naxatw-animate-pulse naxatw-items-center naxatw-justify-center">
      <h3>Redirecting....</h3>
    </Flex>
  );
}

export default GoogleAuth;
