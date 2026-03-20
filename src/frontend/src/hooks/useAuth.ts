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

    // Check for stale localStorage data (cookie expired but localStorage has old data)
    const userprofile = localStorage.getItem('userprofile');

    if (!hankoCookie && userprofile) {
      // Cookie expired but localStorage has stale data - clean up
      devLog('  ⚠️ Cookie expired, cleaning stale localStorage data');
      localStorage.removeItem('userprofile');
      localStorage.removeItem('signedInAs');
      devLog('  🧹 Cleaned userprofile and signedInAs');
      devLog('  ❌ Not authenticated (cookie expired)');
      return false;
    }

    if (hankoCookie) {
      // Valid Hanko session exists
      devLog('  ✅ Authenticated via Hanko cookie');
      return true;
    }

    devLog('  ❌ Not authenticated');
    return false;
  };
  return { isAuthenticated };
}
