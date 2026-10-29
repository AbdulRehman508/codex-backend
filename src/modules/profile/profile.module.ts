import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StorageModule } from '../../common/storage/storage.module';
import {
  RoleAccess,
  RoleAccessSchema,
} from '../access/schemas/role-access.schema';
import { Office, OfficeSchema } from '../office/schemas/office.schema';
import { Role, RoleSchema } from '../roles/schemas/role.schema';
import { Staff, StaffSchema } from '../staff/schemas/staff.schema';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Staff.name, schema: StaffSchema },
      // Office + Role registered to resolve display names
      { name: Office.name, schema: OfficeSchema },
      { name: Role.name, schema: RoleSchema },
      // the caller's own matrix, resolved for the branch they are in
      { name: RoleAccess.name, schema: RoleAccessSchema },
    ]),
    StorageModule,
  ],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
