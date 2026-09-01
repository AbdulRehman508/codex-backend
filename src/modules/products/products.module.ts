import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  RackLocation,
  RackLocationSchema,
} from '../locations/schemas/rack-location.schema';
import { Office, OfficeSchema } from '../office/schemas/office.schema';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { Product, ProductSchema } from './schemas/product.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      // RackLocation + Office registered for FK existence checks
      { name: RackLocation.name, schema: RackLocationSchema },
      { name: Office.name, schema: OfficeSchema },
    ]),
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
