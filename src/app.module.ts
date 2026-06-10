import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { buildValidationPipe } from './common/pipes/validation.pipe';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DataBaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { OfficeModule } from './modules/office/office.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    DataBaseModule,
    AuthModule,
    OfficeModule,
  ],
  providers: [
    // JWT guard runs on every route; opt out with @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // wrap success responses into { success, message, data }
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // consistent error envelope + validation field errors
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // DTO validation -> 400 { message, errors }
    { provide: APP_PIPE, useFactory: buildValidationPipe },
  ],
})
export class AppModule {}
