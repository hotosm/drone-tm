// Development-only logger (logs disabled in production builds)
const devLog = (...args: any[]) => {
  if (import.meta.env.DEV) {
    console.log(...args);
  }
};

export default function useAuth() {
  const isAuthenticated = () => {
    devLog('[useAuth] isAuthenticated() called');

    // Check for legacy OAuth token
    const token = localStorage.getItem('token');
    devLog('[useAuth] token:', token ? 'EXISTS' : 'NOT FOUND');
    if (token) {
      devLog('[useAuth] Authenticated via legacy token');
      return true;
    }

    // Check for Hanko cookie (SSO authentication)
    const allCookies = document.cookie;
    devLog('[useAuth] All cookies:', allCookies);
    const hankoCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('hanko='));
    devLog('[useAuth] hanko cookie:', hankoCookie ? 'EXISTS' : 'NOT FOUND');

    if (hankoCookie) {
      devLog('[useAuth] Authenticated via Hanko cookie');
      return true;
    }

    // Check for Hanko SSO userprofile in localStorage
    const userprofile = localStorage.getItem('userprofile');
    devLog('[useAuth] userprofile:', userprofile ? 'EXISTS' : 'NOT FOUND');
    if (userprofile) {
      try {
        const profile = JSON.parse(userprofile);
        devLog('[useAuth] userprofile.id:', profile?.id);
        if (profile?.id) {
          devLog('[useAuth] Authenticated via userprofile in localStorage');
          return true;
        }
      } catch (err) {
        devLog('[useAuth] Error parsing userprofile:', err);
        return false;
      }
    }

    devLog('[useAuth] Not authenticated');
    return false;
  };
  return { isAuthenticated };
}
