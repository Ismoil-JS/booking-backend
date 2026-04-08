import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { TutorModule } from '../tutor/tutor.module';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, UserModule, TutorModule],
  controllers: [AdminController],
  providers: [AdminService, PrismaService, RolesGuard],
  exports: [AdminService],
})
export class AdminModule {}
