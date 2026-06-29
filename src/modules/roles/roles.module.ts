import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CountersModule } from '../../common/counters/counters.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { Role, RoleSchema } from './schemas/role.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Role.name, schema: RoleSchema }]),
    CountersModule,
  ],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [MongooseModule, RolesService],
})
export class RolesModule {}
