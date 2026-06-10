import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MongooseModuleOptions,
  MongooseOptionsFactory,
} from '@nestjs/mongoose';

@Injectable()
export class databaseConfiguration implements MongooseOptionsFactory {
  constructor(private readonly _configService: ConfigService) {}

  createMongooseOptions():
    | Promise<MongooseModuleOptions>
    | MongooseModuleOptions {
    const host = this._configService.get<string>('DATABASE_HOST');
    const port = this._configService.get<string>('DATABASE_PORT');
    const db_name = this._configService.get<string>('DATABASE_NAME');

    const uri = `mongodb://${host}:${port}/${db_name}`;

    console.log('DB_connected:', uri);

    return {
      uri,
    };
  }
}
