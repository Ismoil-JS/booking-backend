import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { BookingModule } from '../booking/booking.module';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { TutorController } from './tutor.controller';
import { TutorsController } from './tutors.controller';
import { TutorService } from './tutor.service';

@Module({
  imports: [AuthModule, UserModule, forwardRef(() => BookingModule)],
  controllers: [TutorController, TutorsController],
  providers: [TutorService, PrismaService, RolesGuard, OptionalJwtAuthGuard],
  exports: [TutorService],
})
export class TutorModule {}
