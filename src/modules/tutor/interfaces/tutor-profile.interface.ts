export interface WorkExperienceItem {
  companyName?: string;
  role?: string;
  yearsWorked?: number;
}

export interface UpdateTutorProfileData {
  about?: string;
  bio?: string;
  costPer30Min?: number;
  profileImage?: string;
  certificate?: string;
  workExperiences?: WorkExperienceItem[];
}
