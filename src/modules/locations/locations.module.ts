import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Office, OfficeSchema } from '../office/schemas/office.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import {
  RackLocation,
  RackLocationSchema,
} from './schemas/rack-location.schema';
import { Rack, RackSchema } from './schemas/rack.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Rack.name, schema: RackSchema },
      { name: RackLocation.name, schema: RackLocationSchema },
      // Office registered for the FK check, Product for the "bin in use" guard
      { name: Office.name, schema: OfficeSchema },
      { name: Product.name, schema: ProductSchema },
    ]),
  ],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
