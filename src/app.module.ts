import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { OfficeScopeGuard } from './common/permissions/office-scope.guard';
import { PermissionsGuard } from './common/permissions/permissions.guard';
import { PermissionsModule } from './common/permissions/permissions.module';
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
import { CustomersModule } from './modules/customers/customers.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { LocationsModule } from './modules/locations/locations.module';
import { OfficeModule } from './modules/office/office.module';
import { ProductsModule } from './modules/products/products.module';
import { ProfileModule } from './modules/profile/profile.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RolesModule } from './modules/roles/roles.module';
import { SalesModule } from './modules/sales/sales.module';
import { StaffModule } from './modules/staff/staff.module';
import { StockModule } from './modules/stock/stock.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';

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
    // 300 requests a minute per IP: generous for a POS screen, a wall for a
    // scraper. Login has its own tighter limit.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PermissionsModule,
    DataBaseModule,
    AuthModule,
    AccessModule,
    CustomersModule,
    DashboardModule,
    LocationsModule,
    OfficeModule,
    ProductsModule,
    ProfileModule,
    PurchasesModule,
    ReportsModule,
    RolesModule,
    SalesModule,
    StaffModule,
    StockModule,
    SuppliersModule,
  ],
  providers: [
    // guards run in order: who are you -> how often -> what may you do ->
    // which office may you touch
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: OfficeScopeGuard },
    // wrap success responses into { success, message, data }
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // consistent error envelope + validation field errors
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // DTO validation -> 400 { message, errors }
    { provide: APP_PIPE, useFactory: buildValidationPipe },
  ],
})
export class AppModule {}
