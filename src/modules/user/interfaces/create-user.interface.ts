import { UserType } from '@prisma/client';

export interface CreateUserPayload {
  fullName: string;
  email: string;
  passwordHash?: string;
  googleId?: string;
  phone?: string;
  userType?: UserType;
}
