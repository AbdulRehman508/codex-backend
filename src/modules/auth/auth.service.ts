import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { Model } from 'mongoose';
import { MailService } from '../../common/mail/mail.service';
import { Role, RoleDocument } from '../roles/schemas/role.schema';
import {
  Staff,
  StaffDocument,
  StaffStatus,
} from '../staff/schemas/staff.schema';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const BCRYPT_ROUNDS = 10;
const RESET_TTL_MS = 30 * 60 * 1000; // 30 min

export interface AuthUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role_id: number;
  role: string | null;
  office_ids: string[];
  profile_photo: string | null;
  staff_status: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(Staff.name)
    private readonly staffModel: Model<StaffDocument>,
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async login(dto: LoginDto): Promise<{
    token: string;
    token_type: 'Bearer';
    expires_in: number;
    user: AuthUser;
  }> {
    const staff = await this.staffModel
      .findOne({ email: dto.email.toLowerCase(), deleted_at: null })
      .select('+password')
      .exec();

    // same error for unknown email / wrong password — don't leak which
    if (!staff || !(await bcrypt.compare(dto.password, staff.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (staff.staff_status === StaffStatus.INACTIVE) {
      throw new ForbiddenException('Account is inactive');
    }

    const expires =
      dto.remember_me === true
        ? (this.config.get<string>('jwt.rememberExpires') ?? '30d')
        : (this.config.get<string>('jwt.expires') ?? '1d');

    const token = await this.jwt.signAsync(
      {
        sub: staff._id.toString(),
        email: staff.email,
        role_id: staff.role_id,
      },
      { expiresIn: expires as JwtSignOptions['expiresIn'] },
    );

    return {
      token,
      token_type: 'Bearer',
      expires_in: parseDuration(expires),
      user: await this.buildUser(staff),
    };
  }

  async me(userId: string): Promise<AuthUser> {
    const staff = await this.staffModel
      .findOne({ _id: userId, deleted_at: null })
      .exec();
    if (!staff) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return this.buildUser(staff);
  }

  // stateless JWT — nothing to revoke server-side
  logout(): { success: boolean } {
    return { success: true };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ sent: boolean }> {
    const staff = await this.staffModel
      .findOne({ email: dto.email.toLowerCase(), deleted_at: null })
      .exec();

    // only act if the account exists, but always return the same response
    if (staff) {
      const token = randomBytes(32).toString('hex');
      staff.reset_token_hash = sha256(token);
      staff.reset_token_expires = new Date(Date.now() + RESET_TTL_MS);
      await staff.save();
      await this.mail.sendPasswordReset(staff.email, token);
    }

    return { sent: true };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: boolean }> {
    const staff = await this.staffModel
      .findOne({
        reset_token_hash: sha256(dto.token),
        reset_token_expires: { $gt: new Date() },
        deleted_at: null,
      })
      .select('+reset_token_hash +reset_token_expires')
      .exec();

    if (!staff) {
      throw new BadRequestException('Reset token is invalid or expired');
    }

    staff.password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    staff.reset_token_hash = null;
    staff.reset_token_expires = null;
    await staff.save();

    return { success: true };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ success: boolean }> {
    const staff = await this.staffModel
      .findOne({ _id: userId, deleted_at: null })
      .select('+password')
      .exec();
    if (!staff) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!(await bcrypt.compare(dto.current_password, staff.password))) {
      throw new BadRequestException('Current password is incorrect');
    }

    staff.password = await bcrypt.hash(dto.new_password, BCRYPT_ROUNDS);
    await staff.save();

    return { success: true };
  }

  // --- helpers ---

  private async buildUser(staff: StaffDocument): Promise<AuthUser> {
    const role = await this.roleModel.findById(staff.role_id).exec();
    return {
      id: staff._id.toString(),
      first_name: staff.first_name,
      last_name: staff.last_name,
      email: staff.email,
      role_id: staff.role_id,
      role: role?.role ?? null,
      office_ids: staff.office_ids.map((o) => o.toString()),
      profile_photo: staff.profile_photo ?? null,
      staff_status: staff.staff_status,
    };
  }
}

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

// '1d' | '30d' | '12h' | '3600s' | '3600' -> seconds
function parseDuration(v: string): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(v.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  const unit = (m[2] ?? 's') as 's' | 'm' | 'h' | 'd';
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
}
