import flightPlanLoadOnRc from '@Assets/images/tutorials/flight_plan_load_on_Rc.png';
import flightPlanReplacementOnRcByLaptop from '@Assets/images/tutorials/flight_plan_replacement_on_rc_by_laptop.png';
import flightPlanReplacementOnRcByApp from '@Assets/images/tutorials/flight_plan_replacement_on_rc_by_app.png';
import imageProcessing from '@Assets/images/tutorials/image_processing.png';
import projectCreation from '@Assets/images/tutorials/project_creation.png';
import signUpAndLogin from '@Assets/images/tutorials/sign_up_and_login.png';
import viewingFinalOutput from '@Assets/images/tutorials/viewing_final_output.png';
import workflowForDroneOperator from '@Assets/images/tutorials/work_flow_for_drone_operator.png';

export interface IVideoTutorialItems {
  id: string;
  videoUrl: string;
  title: string;
  description: string;
  thumbnail: string;
}

export const videoTutorialData: IVideoTutorialItems[] = [
  {
    id: 'Sign+Up+and+Log+In',
    videoUrl:
      'https://dronetm.s3.ap-south-1.amazonaws.com/dtm-data/tutorials/Sign+Up+and+Log+In.mp4',
    title: 'How to Sign Up and Log In',
    description: '',
    thumbnail: signUpAndLogin,
  },
  {
    id: 'Project+Creation',
    videoUrl:
      'https://dronetm.s3.ap-south-1.amazonaws.com/dtm-data/tutorials/Project+Creation.mp4',
    title: 'How To Create Projects',
    description: '',
    thumbnail: projectCreation,
  },
  {
    id: 'Workflow+for+Drone+Operators',
    videoUrl:
      'https://dronetm.s3.ap-south-1.amazonaws.com/dtm-data/tutorials/Workflow+for+Drone+Operators.mp4',
    title: 'Workflow for Drone Operators',
    description: '',
    thumbnail: workflowForDroneOperator,
  },
  {
    id: 'Flight+Plan+Loading+on+RC',
    videoUrl:
      'https://dronetm.s3.ap-south-1.amazonaws.com/dtm-data/tutorials/Flight+Plan+Loading+on+RC.mp4',
    title: 'How to Load Flight Plan on RC of Drone and Start the Flight',
    description: '',
    thumbnail: flightPlanLoadOnRc,
  },
  {
    id: 'Flight+Plan+Replacement+on+RC+By+App',
    videoUrl:
      'https://dronetm.s3.ap-south-1.amazonaws.com/dtm-data/tutorials/Flight+Plan+Replacement+on+RC+By+App.mp4',
    title: 'How to Replace the Flight Plan on RC of Drone using Mobile App (Option 2)',
    description: '',
    thumbnail: flightPlanReplacementOnRcByApp,
  },
  {
    id: 'Flight+Plan+Replacement+on+RC+By+Laptop',
    videoUrl:
      'https://dronetm.s3.ap-south-1.amazonaws.com/dtm-data/tutorials/Flight+Plan+Replacement+on+RC+By+Laptop.mp4',
    title: 'How to Replace the Flight Plan on RC of Drone using Laptop (Option 1)',
    description: '',
    thumbnail: flightPlanReplacementOnRcByLaptop,
  },
  {
    id: 'Image+Processing',
    videoUrl:
      'https://dronetm.s3.ap-south-1.amazonaws.com/dtm-data/tutorials/Image+Processing.mp4',
    title: 'How to Upload Raw images and Start Processing',
    description: '',
    thumbnail: imageProcessing,
  },

  {
    id: 'Viewing+Final+Output',
    videoUrl:
      'https://dronetm.s3.ap-south-1.amazonaws.com/dtm-data/tutorials/Viewing+Final+Output.mp4',
    title: 'How to Visualize Final Output',
    description: '',
    thumbnail: viewingFinalOutput,
  },
];
