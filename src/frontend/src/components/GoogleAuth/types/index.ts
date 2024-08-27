export interface UserProfileDetailsType {
  id: string;
  email_address: string;
  profile_img: string;
  has_user_profile: boolean;
}

export type IUserProfileDetailsType = UserProfileDetailsType | null;
