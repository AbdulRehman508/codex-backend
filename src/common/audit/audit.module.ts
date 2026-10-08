import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Staff, StaffSchema } from '../../modules/staff/schemas/staff.schema';
import { AuditLog, AuditLogSchema } from './audit-log.schema';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Global: the audit interceptor is built in the AppModule injector, so the
 * models have to resolve there too — the same reason PermissionsModule
 * re-exports MongooseModule.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      // staff names are snapshotted onto each entry
      { name: Staff.name, schema: StaffSchema },
    ]),
  ],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService, MongooseModule],
})
export class AuditModule {}
