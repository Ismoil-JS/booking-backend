import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthTokenResponse } from './interfaces/auth-token.interface';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthService {
  private readonly googleClient: OAuth2Client;
  private readonly googleClientId: string;

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.googleClientId = this.configService.get<string>('GOOGLE_CLIENT_ID') ?? '';
    this.googleClient = new OAuth2Client(this.googleClientId);
  }

  async register(dto: RegisterDto): Promise<AuthTokenResponse> {
    const existing = await this.userService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.userService.create({
      fullName: dto.fullName,
      email: dto.email,
      passwordHash,
      phone: dto.phone,
      userType: dto.userType ?? 'LEARNER',
    });
    if (user.userType === 'LEARNER') {
      await this.userService.createLearner(user.id);
    }
    const payload: JwtPayload = { sub: user.id, email: user.email, userType: user.userType };
    const access_token = this.jwtService.sign(payload);
    return { access_token };
  }

  async login(dto: LoginDto): Promise<AuthTokenResponse> {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException('This account uses Google sign-in. Please use "Sign in with Google" instead.');
    }
    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const payload: JwtPayload = { sub: user.id, email: user.email, userType: user.userType };
    const access_token = this.jwtService.sign(payload);
    return { access_token };
  }

  async googleLogin(dto: GoogleLoginDto): Promise<AuthTokenResponse> {
    if (!this.googleClientId) {
      throw new BadRequestException('Google OAuth is not configured. Set GOOGLE_CLIENT_ID in .env');
    }

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.idToken,
        audience: this.googleClientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google ID token');
    }

    if (!payload?.email) {
      throw new UnauthorizedException('Google account has no email');
    }

    const googleId = payload.sub;
    const email = payload.email;
    const fullName = payload.name || email.split('@')[0];

    let user = await this.userService.findByGoogleId(googleId);

    if (!user) {
      user = await this.userService.findByEmail(email);
      if (user) {
        await this.userService.linkGoogleId(user.id, googleId);
      } else {
        const userType = dto.userType ?? 'LEARNER';
        user = await this.userService.create({ fullName, email, googleId, userType });
        if (userType === 'LEARNER') {
          await this.userService.createLearner(user.id);
        }
      }
    }

    const jwtPayload: JwtPayload = { sub: user.id, email: user.email, userType: user.userType };
    const access_token = this.jwtService.sign(jwtPayload);
    return { access_token };
  }

  async validateUserById(userId: number) {
    return this.userService.findById(userId);
  }

  async getMeProfile(userId: number) {
    return this.userService.findByIdWithTutor(userId);
  }
}
