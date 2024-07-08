export interface UserProfileDetailsType {
  id: string;
  email: string;
  img_url: string;
  has_user_profile: boolean;
}

export type IUserProfileDetailsType = UserProfileDetailsType | null;
