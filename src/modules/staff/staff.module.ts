import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StorageModule } from '../../common/storage/storage.module';
import { Office, OfficeSchema } from '../office/schemas/office.schema';
import { Role, RoleSchema } from '../roles/schemas/role.schema';
import { Staff, StaffSchema } from './schemas/staff.schema';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Staff.name, schema: StaffSchema },
      // Office + Role registered for FK existence checks
      { name: Office.name, schema: OfficeSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
    StorageModule,
  ],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
