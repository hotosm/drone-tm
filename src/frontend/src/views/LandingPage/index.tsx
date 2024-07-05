import { useTypedSelector } from '@Store/hooks';
import {
  Navbar,
  Home,
  AboutTM,
  OurRationale,
  OpenSource,
  Features,
  UserAndRoles,
  MajorImpacts,
  CaseStudies,
  ClientAndPartners,
  Footer,
  SignInOverlay,
} from '@Components/LandingPage';
import { AnimatePresence } from 'framer-motion';

export default function LandingPage() {
  const openSignInMenu = useTypedSelector(state => state.common.openSignInMenu);
  return (
    <main className="landing-page naxatw-font-secondary">
      <Navbar />
      <AnimatePresence>{openSignInMenu && <SignInOverlay />}</AnimatePresence>
      <Home />
      <AboutTM />
      <OurRationale />
      <OpenSource />
      <Features />
      <UserAndRoles />
      <MajorImpacts />
      <CaseStudies />
      <ClientAndPartners />
      <Footer />
    </main>
  );
}
