import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { MailModule } from '../../common/mail/mail.module';
import { Role, RoleSchema } from '../roles/schemas/role.schema';
import { Staff, StaffSchema } from '../staff/schemas/staff.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret') ?? 'dev-secret',
        signOptions: {
          expiresIn: (config.get<string>('jwt.expires') ??
            '1d') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
    MongooseModule.forFeature([
      { name: Staff.name, schema: StaffSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
    MailModule,
  ],
  controllers: [AuthController],
  providers: [JwtAuthGuard, AuthService],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
