import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser } from '../auth/strategies/jwt.strategy';
import { BookingService } from '../booking/booking.service';
import { CreateSlotDto } from './dto/create-slot.dto';
import { UpdateSlotDto } from './dto/update-slot.dto';
import { UpdateTutorProfileDto } from './dto/update-tutor-profile.dto';
import { getTutorUploadOptions } from './tutor-upload.config';
import { TutorService } from './tutor.service';

type TutorUploadFiles = { profileImage?: Express.Multer.File[]; certificate?: Express.Multer.File[] };

@ApiTags('Tutor')
@ApiBearerAuth()
@Controller('tutor')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TUTOR')
export class TutorController {
  constructor(
    private readonly tutorService: TutorService,
    private readonly bookingService: BookingService,
  ) {}

  @Post('upload')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'profileImage', maxCount: 1 },
    { name: 'certificate', maxCount: 1 },
  ], getTutorUploadOptions()))
  @ApiOperation({ summary: 'Upload profile image and/or certificate' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        profileImage: { type: 'string', format: 'binary', description: 'Profile image (JPEG, PNG, GIF, WebP, max 5MB)' },
        certificate: { type: 'string', format: 'binary', description: 'Certificate or document (any file type, max 10MB)' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Uploaded; URLs are saved to tutor profile and returned with updated profile' })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  async upload(
    @CurrentUser() user: RequestUser | undefined,
    @Req() req: Request & { files?: TutorUploadFiles },
  ) {
    if (!user?.userId) throw new BadRequestException('Not authenticated');
    const files = req.files;
    const profileImage = files?.profileImage?.[0];
    const certificate = files?.certificate?.[0];
    const profileImageUrl = profileImage?.filename ? `/uploads/tutor/${user.userId}/${profileImage.filename}` : undefined;
    const certificateUrl = certificate?.filename ? `/uploads/tutor/${user.userId}/${certificate.filename}` : undefined;
    if (!profileImageUrl && !certificateUrl) {
      throw new BadRequestException('Send at least one file: profileImage or certificate');
    }
    const dto: UpdateTutorProfileDto = {};
    if (profileImageUrl) dto.profileImage = profileImageUrl;
    if (certificateUrl) dto.certificate = certificateUrl;
    const updated = await this.tutorService.getOrUpdateProfile(user.userId, user.userType as 'TUTOR', dto);
    return {
      profileImage: profileImageUrl ?? updated.profileImage ?? undefined,
      certificate: certificateUrl ?? updated.certificate ?? undefined,
      profile: updated,
    };
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update tutor profile' })
  @ApiBody({ type: UpdateTutorProfileDto })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async updateProfile(@CurrentUser() user: RequestUser | undefined, @Body() dto: UpdateTutorProfileDto) {
    if (!user?.userId) throw new Error('Not authenticated');
    return this.tutorService.getOrUpdateProfile(user.userId, user.userType as 'TUTOR', dto);
  }

  @Get('slots')
  @ApiOperation({ summary: 'List my slots (booked boolean + status "booked" or "-")' })
  @ApiResponse({ status: 200, description: 'List of slots with booked and status' })
  async getSlots(@CurrentUser() user: RequestUser | undefined) {
    if (!user?.userId) throw new BadRequestException('Not authenticated');
    return this.tutorService.getSlotsByUserId(user.userId);
  }

  @Post('slots')
  @ApiOperation({ summary: 'Create an available slot' })
  @ApiBody({ type: CreateSlotDto })
  @ApiResponse({ status: 201, description: 'Slot created' })
  async createSlot(@CurrentUser() user: RequestUser | undefined, @Body() dto: CreateSlotDto) {
    if (!user?.userId) throw new BadRequestException('Not authenticated');
    return this.tutorService.createSlot(user.userId, dto);
  }

  @Patch('slots/:id')
  @ApiOperation({ summary: 'Update a slot' })
  @ApiBody({ type: UpdateSlotDto })
  @ApiResponse({ status: 200, description: 'Slot updated' })
  async updateSlot(
    @CurrentUser() user: RequestUser | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSlotDto,
  ) {
    if (!user?.userId) throw new BadRequestException('Not authenticated');
    return this.tutorService.updateSlot(user.userId, id, dto);
  }

  @Delete('slots/:id')
  @ApiOperation({ summary: 'Delete a slot' })
  @ApiResponse({ status: 200, description: 'Slot deleted' })
  async deleteSlot(@CurrentUser() user: RequestUser | undefined, @Param('id', ParseIntPipe) id: number) {
    if (!user?.userId) throw new BadRequestException('Not authenticated');
    return this.tutorService.deleteSlot(user.userId, id);
  }

  @Get('earnings')
  @ApiOperation({ summary: 'Get tutor earnings summary (total earnings, platform fees, per-booking breakdown)' })
  @ApiResponse({
    status: 200,
    description: 'Earnings summary',
    schema: {
      type: 'object',
      properties: {
        totalEarnings: { type: 'number', example: 450.0 },
        totalPlatformFees: { type: 'number', example: 50.0 },
        totalAmountPaid: { type: 'number', example: 500.0 },
        platformFeePercent: { type: 'number', example: 10 },
        totalBookings: { type: 'number', example: 10 },
        bookings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              date: { type: 'string', format: 'date' },
              startTime: { type: 'string', example: '09:00' },
              endTime: { type: 'string', example: '09:30' },
              amountPaid: { type: 'number', example: 50.0 },
              platformFee: { type: 'number', example: 5.0 },
              tutorEarning: { type: 'number', example: 45.0 },
              learnerName: { type: 'string', example: 'John Doe' },
              paidAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  async getEarnings(@CurrentUser() user: RequestUser | undefined) {
    if (!user?.userId) throw new BadRequestException('Not authenticated');
    return this.bookingService.getEarnings(user.userId);
  }
}
