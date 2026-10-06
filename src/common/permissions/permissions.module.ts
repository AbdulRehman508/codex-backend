import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  RoleAccess,
  RoleAccessSchema,
} from '../../modules/access/schemas/role-access.schema';
import { Role, RoleSchema } from '../../modules/roles/schemas/role.schema';
import { Staff, StaffSchema } from '../../modules/staff/schemas/staff.schema';
import { OfficeScopeGuard } from './office-scope.guard';
import { PermissionsGuard } from './permissions.guard';

/**
 * Server-side access control. Global so the guards can be registered app-wide
 * in AppModule without every feature module re-importing the models.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Role.name, schema: RoleSchema },
      { name: RoleAccess.name, schema: RoleAccessSchema },
      { name: Staff.name, schema: StaffSchema },
    ]),
  ],
  providers: [PermissionsGuard, OfficeScopeGuard],
  // MongooseModule is re-exported so the models resolve where the guards are
  // instantiated: APP_GUARD builds them in the AppModule injector, not here.
  exports: [PermissionsGuard, OfficeScopeGuard, MongooseModule],
})
export class PermissionsModule {}
