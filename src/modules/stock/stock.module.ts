import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CountersModule } from '../../common/counters/counters.module';
import { Office, OfficeSchema } from '../office/schemas/office.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import {
  StockAdjustment,
  StockAdjustmentSchema,
} from './schemas/stock-adjustment.schema';
import {
  StockTransfer,
  StockTransferSchema,
} from './schemas/stock-transfer.schema';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StockAdjustment.name, schema: StockAdjustmentSchema },
      { name: StockTransfer.name, schema: StockTransferSchema },
      // the product is what actually moves; office is the FK existence check
      { name: Product.name, schema: ProductSchema },
      { name: Office.name, schema: OfficeSchema },
    ]),
    // TRF-0001 numbering, per sending office
    CountersModule,
  ],
  // the transfer routes are registered first: /stock/transfers must not be
  // swallowed by the adjustments' /stock/adjustments/:id style matching
  controllers: [TransfersController, StockController],
  providers: [StockService, TransfersService],
  exports: [StockService, TransfersService],
})
export class StockModule {}
