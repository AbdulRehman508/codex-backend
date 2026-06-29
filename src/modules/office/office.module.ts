import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StorageModule } from '../../common/storage/storage.module';
import { RolesModule } from '../roles/roles.module';
import { OfficeController } from './office.controller';
import { OfficeService } from './office.service';
import { Office, OfficeSchema } from './schemas/office.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Office.name, schema: OfficeSchema }]),
    StorageModule,
    RolesModule,
  ],
  controllers: [OfficeController],
  providers: [OfficeService],
})
export class OfficeModule {}
