import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

const AUTH_PROVIDER = import.meta.env.VITE_AUTH_PROVIDER;
const API_URL = import.meta.env.VITE_API_URL;

type UserProfile = Record<string, any>;

type AuthContextType = {
  user: UserProfile | null;
  isAuthenticated: boolean;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  logout: () => {},
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

const fetchUserProfile = async (): Promise<UserProfile | null> => {
  try {
    const response = await fetch(`${API_URL}/users/my-info/`, {
      credentials: 'include',
    });
    if (!response.ok) return null;

    const userData = await response.json();

    if (!userData.profile_img) {
      const hankoUser = JSON.parse(
        localStorage.getItem('hotosm-auth-user') || '{}',
      );
      if (hankoUser.avatarUrl) {
        userData.profile_img = hankoUser.avatarUrl;
      }
    }

    return userData;
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();

  const [user, setUser] = useState<UserProfile | null>(() => {
    const stored = localStorage.getItem('userprofile');
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  });

  const isAuthenticated = (() => {
    if (AUTH_PROVIDER === 'hanko') return user !== null;
    const token = localStorage.getItem('token');
    return !!token || user !== null;
  })();

  const persistUser = (profile: UserProfile) => {
    localStorage.setItem('userprofile', JSON.stringify(profile));
    setUser(profile);
  };

  const clearUser = () => {
    localStorage.removeItem('userprofile');
    localStorage.removeItem('hotosm-auth-user');
    localStorage.removeItem('token');
    localStorage.removeItem('signedInAs');
    setUser(null);
  };

  const logout = () => {
    clearUser();
  };

  // On mount: if using Hanko and cookie exists but no user in state, rehydrate
  useEffect(() => {
    if (AUTH_PROVIDER !== 'hanko') return;
    if (user !== null) return;

    const hankoCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('hanko='));

    if (hankoCookie) {
      fetchUserProfile().then(profile => {
        if (profile) persistUser(profile);
      });
    }
  }, []);

  // Hanko event listeners
  useEffect(() => {
    if (AUTH_PROVIDER !== 'hanko') return;

    const handleLogin = async (e: Event) => {
      const hankoUser = (e as CustomEvent).detail?.user;
      if (hankoUser) {
        localStorage.setItem('hotosm-auth-user', JSON.stringify(hankoUser));
      }

      const profile = await fetchUserProfile();
      if (!profile) {
        toast.error('Authentication failed. Please try logging in again.');
        navigate('/login');
        return;
      }

      persistUser(profile);
      toast.success('Logged in successfully');

      if (profile.has_user_profile && Array.isArray(profile.role) && profile.role.length > 0) {
        navigate('/projects');
      } else {
        navigate('/complete-profile');
      }
    };

    const handleLogout = () => {
      clearUser();
    };

    document.addEventListener('hanko-login', handleLogin);
    document.addEventListener('logout', handleLogout);
    return () => {
      document.removeEventListener('hanko-login', handleLogin);
      document.removeEventListener('logout', handleLogout);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
