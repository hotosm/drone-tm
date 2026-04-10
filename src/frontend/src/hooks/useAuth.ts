export default function useAuth() {
  const isAuthenticated = () => {
    // Check for legacy OAuth token
    const token = localStorage.getItem("token");
    if (token) {
      return true;
    }

    // Check for Hanko cookie (SSO authentication)
    const hankoCookie = document.cookie.split("; ").find((row) => row.startsWith("hanko="));
    if (hankoCookie) {
      return true;
    }

    // Check for Hanko SSO userprofile in localStorage
    const userprofile = localStorage.getItem("userprofile");
    if (userprofile) {
      try {
        const profile = JSON.parse(userprofile);
        if (profile?.id) {
          return true;
        }
      } catch {
        return false;
      }
    }

    return false;
  };
  return { isAuthenticated };
}
