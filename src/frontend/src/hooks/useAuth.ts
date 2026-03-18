import { useAuth as useAuthContext } from '@Providers/AuthProvider';

const AUTH_PROVIDER = import.meta.env.VITE_AUTH_PROVIDER;

export function useAuth() {
  const context = useAuthContext();

  if (AUTH_PROVIDER !== 'hanko') {
    return {
      ...context,
      isAuthenticated: !!localStorage.getItem('token'),
    };
  }

  return context;
}
