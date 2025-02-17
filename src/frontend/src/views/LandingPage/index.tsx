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
  // CaseStudies,
  ClientAndPartners,
  Footer,
  SignInOverlay,
  TalkToUs,
} from '@Components/LandingPage';
import { AnimatePresence } from 'framer-motion';
import MobileAppDownload from '@Components/LandingPage/MobileAppDownload';

export default function LandingPage() {
  const openSignInMenu = useTypedSelector(state => state.common.openSignInMenu);
  return (
    <main className="landing-page naxatw-font-secondary">
      <Navbar />
      {/* @ts-ignore */}
      <AnimatePresence>{openSignInMenu && <SignInOverlay />}</AnimatePresence>
      <Home />
      <AboutTM />
      <OurRationale />
      <OpenSource />
      <Features />
      <MobileAppDownload />
      <UserAndRoles />
      <MajorImpacts />
      {/* <CaseStudies /> */}
      <ClientAndPartners />
      <TalkToUs />
      <Footer />
    </main>
  );
}
