import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Office, OfficeSchema } from '../office/schemas/office.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import {
  StockAdjustment,
  StockAdjustmentSchema,
} from './schemas/stock-adjustment.schema';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StockAdjustment.name, schema: StockAdjustmentSchema },
      // the product is what actually moves; office is the FK existence check
      { name: Product.name, schema: ProductSchema },
      { name: Office.name, schema: OfficeSchema },
    ]),
  ],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
