import flightPlanLoadOnRc from "@Assets/images/tutorials/flight_plan_load_on_Rc.png";
import flightPlanReplacementOnRcByLaptop from "@Assets/images/tutorials/flight_plan_replacement_on_rc_by_laptop.png";
import flightPlanReplacementOnRcByApp from "@Assets/images/tutorials/flight_plan_replacement_on_rc_by_app.png";
import imageProcessing from "@Assets/images/tutorials/image_processing.png";
import projectCreation from "@Assets/images/tutorials/project_creation.png";
import signUpAndLogin from "@Assets/images/tutorials/sign_up_and_login.png";
import viewingFinalOutput from "@Assets/images/tutorials/viewing_final_output.png";
import workflowForDroneOperator from "@Assets/images/tutorials/work_flow_for_drone_operator.png";
import { m } from "@/paraglide/messages";

export interface IVideoTutorialItems {
  id: string;
  videoUrl: string;
  title: string;
  description: string;
  thumbnail: string;
}

export const getVideoTutorialData = (): IVideoTutorialItems[] => [
  {
    id: "Sign+Up+and+Log+In",
    videoUrl: "https://d2ymfcf63vwwpt.cloudfront.net/tutorials/Sign+Up+and+Log+In.mp4",
    title: m.tutorial_title_sign_up_and_login(),
    description: "",
    thumbnail: signUpAndLogin,
  },
  {
    id: "Project+Creation",
    videoUrl: "https://d2ymfcf63vwwpt.cloudfront.net/tutorials/Project+Creation.mp4",
    title: m.tutorial_title_project_creation(),
    description: "",
    thumbnail: projectCreation,
  },
  {
    id: "Workflow+for+Drone+Operators",
    videoUrl: "https://d2ymfcf63vwwpt.cloudfront.net/tutorials/Workflow+for+Drone+Operators.mp4",
    title: m.tutorial_title_workflow_for_drone_operators(),
    description: "",
    thumbnail: workflowForDroneOperator,
  },
  {
    id: "Flight+Plan+Loading+on+RC",
    videoUrl: "https://d2ymfcf63vwwpt.cloudfront.net/tutorials/Flight+Plan+Loading+on+RC.mp4",
    title: m.tutorial_title_flight_plan_loading_on_rc(),
    description: "",
    thumbnail: flightPlanLoadOnRc,
  },
  {
    id: "Flight+Plan+Replacement+on+RC+By+App",
    videoUrl:
      "https://d2ymfcf63vwwpt.cloudfront.net/tutorials/Flight+Plan+Replacement+on+RC+By+App.mp4",
    title: m.tutorial_title_flight_plan_replacement_on_rc_by_app(),
    description: "",
    thumbnail: flightPlanReplacementOnRcByApp,
  },
  {
    id: "Flight+Plan+Replacement+on+RC+By+Laptop",
    videoUrl:
      "https://d2ymfcf63vwwpt.cloudfront.net/tutorials/Flight+Plan+Replacement+on+RC+By+Laptop.mp4",
    title: m.tutorial_title_flight_plan_replacement_on_rc_by_laptop(),
    description: "",
    thumbnail: flightPlanReplacementOnRcByLaptop,
  },
  {
    id: "Image+Processing",
    videoUrl: "https://d2ymfcf63vwwpt.cloudfront.net/tutorials/Image+Processing.mp4",
    title: m.tutorial_title_image_processing(),
    description: "",
    thumbnail: imageProcessing,
  },

  {
    id: "Viewing+Final+Output",
    videoUrl: "https://d2ymfcf63vwwpt.cloudfront.net/tutorials/Viewing+Final+Output.mp4",
    title: m.tutorial_title_viewing_final_output(),
    description: "",
    thumbnail: viewingFinalOutput,
  },
];
