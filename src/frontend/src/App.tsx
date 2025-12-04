import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { initDomToCode } from 'dom-to-code';
import { ToastContainer } from 'react-toastify';

import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import generateRoutes from '@Routes/generateRoutes';
import appRoutes from '@Routes/appRoutes';
import testRoutes from '@Routes/testRoutes';
import {
  setModalContent,
  setPromptDialogContent,
  toggleModal,
  togglePromptDialog,
} from '@Store/actions/common';
import 'react-toastify/dist/ReactToastify.css';
import Modal from '@Components/common/Modal';
import Navbar from '@Components/common/Navbar';
import PromptDialog from '@Components/common/PromptDialog';
import {
  getModalContent,
  getPromptDialogContent,
} from '@Constants/modalContents';
import ScrollToTop from '@Components/common/ScrollToTop';

export default function App() {
  const dispatch = useTypedDispatch();
  const { pathname } = useLocation();

  // Listen for Hanko login event and fetch user profile
  useEffect(() => {
    const handleHankoLogin = async () => {
      console.log('🔐 Hanko login detected, fetching user profile...');

      // Check if we already have userprofile to avoid duplicate calls
      const existingProfile = localStorage.getItem('userprofile');
      if (existingProfile) {
        console.log('✅ User profile already exists in localStorage');
        return;
      }

      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/users/my-info/`, {
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to fetch user profile');
        }

        const userDetails = await response.json();
        localStorage.setItem('userprofile', JSON.stringify(userDetails));
        console.log('✅ User profile saved to localStorage');
      } catch (error) {
        console.error('❌ Failed to fetch user profile:', error);
      }
    };

    const authComponent = document.querySelector('hotosm-auth');
    if (authComponent) {
      authComponent.addEventListener('hanko-login', handleHankoLogin as EventListener);

      return () => {
        authComponent.removeEventListener('hanko-login', handleHankoLogin as EventListener);
      };
    }
    return undefined;
  }, [pathname]);

  // Listen for Hanko logout event and clean localStorage
  useEffect(() => {
    const handleHankoLogout = () => {
      // Clean authentication-related localStorage items
      localStorage.removeItem('token');
      localStorage.removeItem('userprofile');
      localStorage.removeItem('signedInAs');
      console.log('🧹 localStorage cleaned after Hanko logout');
    };

    // Find the hotosm-auth component and listen to its logout event
    const authComponent = document.querySelector('hotosm-auth');
    if (authComponent) {
      authComponent.addEventListener('logout', handleHankoLogout as EventListener);

      // Cleanup on unmount
      return () => {
        authComponent.removeEventListener('logout', handleHankoLogout as EventListener);
      };
    }
    return undefined;
  }, [pathname]); // Re-run when pathname changes to re-attach listener if component remounts
  const showModal = useTypedSelector(state => state.common.showModal);
  const modalContent = useTypedSelector(state => state.common.modalContent);
  const showPromptDialog = useTypedSelector(
    state => state.common.showPromptDialog,
  );
  const promptDialogContent = useTypedSelector(
    state => state.common.promptDialogContent,
  );

  const handleModalClose = () => {
    dispatch(toggleModal());
    setTimeout(() => {
      dispatch(setModalContent(null));
    }, 150);
  };

  const handlePromptDialogClose = () => {
    dispatch(togglePromptDialog());
    setTimeout(() => {
      dispatch(setPromptDialogContent(null));
    }, 150);
  };

  // add routes where you dont want navigation bar
  const routesWithoutNavbar = [
    '/',
    '/tutorials',
    '/login',
    '/forgot-password',
    '/complete-profile',
    '/hanko-auth',
  ];

  return (
    <>
      {process.env.NODE_ENV !== 'production' &&
        !process.env.DISABLE_DOM_TO_CODE &&
        initDomToCode()}
      <div>
        <ToastContainer />

        {!routesWithoutNavbar.includes(pathname) && <Navbar />}

        <Modal
          show={showModal}
          className={getModalContent(modalContent)?.className || ''}
          title={getModalContent(modalContent)?.title}
          onClose={handleModalClose}
          hideCloseButton={!!getModalContent(modalContent)?.hideCloseButton}
        >
          {getModalContent(modalContent)?.content}
        </Modal>

        <PromptDialog
          show={showPromptDialog}
          title={getPromptDialogContent(promptDialogContent)?.title}
          onClose={handlePromptDialogClose}
        >
          {getPromptDialogContent(promptDialogContent)?.content}
        </PromptDialog>
        <div
          id="app_playground"
          className="app_playground scrollbar naxatw-overflow-y-auto"
          style={{
            height: 'calc(100vh-3.5rem)',
          }}
        >
          {generateRoutes({
            routes:
              process.env.NODE_ENV !== 'production'
                ? [...testRoutes, ...appRoutes]
                : appRoutes,
          })}
        </div>
        <ScrollToTop />
      </div>
    </>
  );
}
