import { UserType } from '@prisma/client';

export interface JwtPayload {
  sub: number;
  email: string;
  userType?: UserType;
}
