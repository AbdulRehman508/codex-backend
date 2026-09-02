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
import { AccessModule } from './modules/access/access.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { LocationsModule } from './modules/locations/locations.module';
import { OfficeModule } from './modules/office/office.module';
import { ProductsModule } from './modules/products/products.module';
import { ProfileModule } from './modules/profile/profile.module';
import { RolesModule } from './modules/roles/roles.module';
import { SalesModule } from './modules/sales/sales.module';
import { StaffModule } from './modules/staff/staff.module';

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
    AccessModule,
    LocationsModule,
    OfficeModule,
    ProductsModule,
    ProfileModule,
    RolesModule,
    SalesModule,
    StaffModule,
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
