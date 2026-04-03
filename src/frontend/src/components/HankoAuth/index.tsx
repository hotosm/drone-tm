/* eslint-disable no-unused-vars */
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Flex } from '@Components/common/Layouts';
import { toast } from 'react-toastify';
import { getRuntimeConfig } from '@/runtimeConfig';

const BASE_URL = getRuntimeConfig('VITE_API_URL', '/api');

/**
 * HankoAuth - Callback component after Portal SSO login
 *
 * Flow:
 * 1. User selects role in SignInOverlay (PROJECT_CREATOR or DRONE_PILOT)
 * 2. Redirects to Portal (https://login.hotosm.org) with role in return URL
 * 3. Portal handles Hanko authentication and sets JWT cookie
 * 4. Portal redirects back to this component (/hanko-auth?role=PROJECT_CREATOR)
 * 5. This component calls /my-info/ which:
 *    - Validates Hanko JWT (via login_required dependency)
 *    - Maps Hanko user to Drone-TM user (auto-creates if needed)
 *    - Returns complete user profile
 * 6. Navigates to /projects or /complete-profile based on user status
 */
function HankoAuth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // Get role from URL query params or localStorage
  const roleFromUrl = searchParams.get('role');
  const signedInAs = roleFromUrl || localStorage.getItem('signedInAs') || 'PROJECT_CREATOR';

  // Update localStorage if role came from URL
  if (roleFromUrl && roleFromUrl !== localStorage.getItem('signedInAs')) {
    localStorage.setItem('signedInAs', roleFromUrl);
  }

  useEffect(() => {
    const loginRedirect = async () => {
      // Check if user was already logged in (to avoid showing toast on return from Portal)
      const wasAlreadyLoggedIn = !!localStorage.getItem('userprofile');

      // Clear any existing user data to prevent stale data from previous session
      localStorage.removeItem('userprofile');
      localStorage.removeItem('token'); // Legacy OAuth token

      // Clear TanStack Query cache to prevent showing previous user's data
      queryClient.clear();

      try {
        // JWT is already in cookie (set by Portal after successful auth)
        // Call /my-info/ which uses login_required (overridden for Hanko)
        // This validates JWT, creates/maps user, and returns complete profile
        const userDetailsUrl = `${BASE_URL}/users/my-info/`;

        const userDetailsResponse = await fetch(userDetailsUrl, {
          credentials: 'include', // Include Hanko JWT cookie
        });

        if (!userDetailsResponse.ok) {
          throw new Error('Failed to authenticate. Please try logging in again.');
        }

        const userDetails = await userDetailsResponse.json();

        // Store user profile in localStorage (matching GoogleAuth flow)
        localStorage.setItem('userprofile', JSON.stringify(userDetails));

        // Navigate based on user profile completion
        // If user has completed profile with ANY role, allow access
        if (
          userDetails?.has_user_profile &&
          userDetails?.role &&
          Array.isArray(userDetails.role) &&
          userDetails.role.length > 0
        ) {
          navigate('/projects');
        } else {
          navigate('/complete-profile');
        }

        // Only show toast on fresh login, not when returning from Portal profile
        if (!wasAlreadyLoggedIn) {
          toast.success('Logged In Successfully');
        }
      } catch (error) {
        console.error('[HankoAuth] Authentication error:', error);
        toast.error(error instanceof Error ? error.message : 'Authentication failed. Please try again.');
        navigate('/login');
      }
    };

    loginRedirect();
  }, [navigate, signedInAs]);

  return (
    <Flex className="naxatw-h-screen-nav naxatw-w-full naxatw-animate-pulse naxatw-items-center naxatw-justify-center">
      <h3>Completing authentication...</h3>
    </Flex>
  );
}

export default HankoAuth;
