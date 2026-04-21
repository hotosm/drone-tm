import { ReactElement, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getRuntimeConfig } from "@/runtimeConfig";

const API_URL = getRuntimeConfig("VITE_API_URL", "/api");
const AUTH_PROVIDER = getRuntimeConfig("VITE_AUTH_PROVIDER", "legacy");

interface IProtectedRoute {
  isAuthenticated: boolean;
  redirectPath?: string;
  children?: ReactElement;
}

/**
 * For Hanko SSO, the localStorage `userprofile` can outlive the actual
 * session cookie.  We ping `/users/my-info/` once per mount to confirm
 * the session is still valid.  If not, we clear stale state and redirect.
 */
function useValidateSession(isAuthenticated: boolean) {
  const [status, setStatus] = useState<"checking" | "valid" | "invalid">(
    isAuthenticated && AUTH_PROVIDER === "hanko"
      ? "checking"
      : isAuthenticated
        ? "valid"
        : "invalid",
  );

  useEffect(() => {
    if (!isAuthenticated || AUTH_PROVIDER !== "hanko") return;

    let cancelled = false;

    fetch(`${API_URL}/users/my-info/`, { credentials: "include" })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setStatus("valid");
        } else {
          // Session expired – clean up stale localStorage
          localStorage.removeItem("userprofile");
          localStorage.removeItem("signedInAs");
          setStatus("invalid");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("invalid");
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  return status;
}

export default function ProtectedRoute({
  isAuthenticated,
  redirectPath = "/",
  children,
}: IProtectedRoute): ReactElement {
  const location = useLocation();
  const sessionStatus = useValidateSession(isAuthenticated);

  if (sessionStatus === "checking") {
    // Show nothing while validating – avoids the empty-page flash
    return <></>;
  }

  if (sessionStatus === "invalid") {
    return <Navigate to={redirectPath} state={{ from: location }} replace />;
  }

  return children || <Outlet />;
}
