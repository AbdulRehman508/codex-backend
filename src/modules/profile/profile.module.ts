import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StorageModule } from '../../common/storage/storage.module';
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
    ]),
    StorageModule,
  ],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
