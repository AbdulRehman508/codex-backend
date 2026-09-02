import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CountersModule } from '../../common/counters/counters.module';
import { Office, OfficeSchema } from '../office/schemas/office.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { Sale, SaleSchema } from './schemas/sale.schema';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Sale.name, schema: SaleSchema },
      // Product for the stock ledger, Office for the FK check
      { name: Product.name, schema: ProductSchema },
      { name: Office.name, schema: OfficeSchema },
    ]),
    // invoice numbers come from the shared counter collection
    CountersModule,
  ],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
