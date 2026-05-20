import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useTypedDispatch, useTypedSelector } from "@Store/hooks";
import { setCommonState } from "@Store/actions/common";
import {
  Navbar,
  Home,
  AboutTM,
  OurRationale,
  OpenSource,
  Features,
  MajorImpacts,
  CaseStudies,
  ClientAndPartners,
  Footer,
  SignInOverlay,
  TalkToUs,
} from "@Components/LandingPage";
import { AnimatePresence } from "framer-motion";
import MobileAppDownload from "@Components/LandingPage/MobileAppDownload";
import { toast } from "react-toastify";
import { m } from "@/paraglide/messages";

export default function LandingPage() {
  const openSignInMenu = useTypedSelector((state) => state.common.openSignInMenu);
  const dispatch = useTypedDispatch();
  const location = useLocation();

  useEffect(() => {
    if (location.state?.from) {
      dispatch(setCommonState({ openSignInMenu: true }));
      toast.error(m.landing_signin_required_toast());
    }
  }, [location, dispatch]);

  return (
    <main className="landing-page naxatw-font-secondary">
      <Navbar />
      {/* @ts-ignore */}
      <AnimatePresence>{openSignInMenu && <SignInOverlay />}</AnimatePresence>
      <Home />
      <AboutTM />
      <CaseStudies />
      <OurRationale />
      <OpenSource />
      <Features />
      <MobileAppDownload />
      <MajorImpacts />
      <ClientAndPartners />
      <TalkToUs />
      <Footer />
    </main>
  );
}
