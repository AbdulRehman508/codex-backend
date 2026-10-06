import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CountersModule } from '../../common/counters/counters.module';
import { Office, OfficeSchema } from '../office/schemas/office.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { Purchase, PurchaseSchema } from './schemas/purchase.schema';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Purchase.name, schema: PurchaseSchema },
      // Product for the stock ledger, Office for the FK check
      { name: Product.name, schema: ProductSchema },
      { name: Office.name, schema: OfficeSchema },
    ]),
    // purchase numbers come from the shared counter collection
    CountersModule,
    // a purchase bills a supplier and moves their payable
    SuppliersModule,
  ],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
