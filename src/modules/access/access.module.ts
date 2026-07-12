import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CountersModule } from '../../common/counters/counters.module';
import { RolesModule } from '../roles/roles.module';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { RoleAccess, RoleAccessSchema } from './schemas/role-access.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RoleAccess.name, schema: RoleAccessSchema },
    ]),
    CountersModule,
    // gives access to RolesService for role lookup + office scoping
    RolesModule,
  ],
  controllers: [AccessController],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
