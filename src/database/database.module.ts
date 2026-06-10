import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { databaseConfiguration } from './database-config.service';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useClass: databaseConfiguration,
    }),
  ],
  controllers: [],
  providers: [],
})
export class DataBaseModule {}
