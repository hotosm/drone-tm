// Development-only logger (logs disabled in production builds)
const devLog = (...args: any[]) => {
  if (import.meta.env.DEV) {
    console.log(...args);
  }
};

export default function useAuth() {
  const isAuthenticated = () => {
    devLog('🔍 useAuth.isAuthenticated() called');

    // Check for legacy OAuth token
    const token = localStorage.getItem('token');
    devLog('  token:', token ? 'EXISTS' : 'NOT FOUND');
    if (token) {
      devLog('  ✅ Authenticated via legacy token');
      return true;
    }

    // Check for Hanko cookie (SSO authentication)
    const allCookies = document.cookie;
    devLog('  All cookies:', allCookies);
    const hankoCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('hanko='));
    devLog('  hanko cookie:', hankoCookie ? 'EXISTS' : 'NOT FOUND');

    if (hankoCookie) {
      // Valid Hanko session exists
      devLog('  ✅ Authenticated via Hanko cookie');
      return true;
    }

    // Check for Hanko SSO userprofile in localStorage
    const userprofile = localStorage.getItem('userprofile');
    devLog('  userprofile:', userprofile ? 'EXISTS' : 'NOT FOUND');
    if (userprofile) {
      try {
        const profile = JSON.parse(userprofile);
        devLog('  userprofile.id:', profile?.id);
        // Verify it has user ID (basic validation)
        if (profile?.id) {
          // Trust localStorage if it exists and has valid user ID
          // The backend validated the JWT when creating this profile
          devLog('  ✅ Authenticated via userprofile in localStorage');
          return true;
        }
      } catch (err) {
        devLog('  ❌ Error parsing userprofile:', err);
        return false;
      }
    }

    devLog('  ❌ Not authenticated');
    return false;
  };
  return { isAuthenticated };
}
