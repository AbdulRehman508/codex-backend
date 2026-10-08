import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CustomerPayment,
  CustomerPaymentSchema,
} from '../customers/schemas/customer-payment.schema';
import { Customer, CustomerSchema } from '../customers/schemas/customer.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { Sale, SaleSchema } from '../sales/schemas/sale.schema';
import {
  ProductLot,
  ProductLotSchema,
} from '../purchases/schemas/product-lot.schema';
import { Purchase, PurchaseSchema } from '../purchases/schemas/purchase.schema';
import {
  StockAdjustment,
  StockAdjustmentSchema,
} from '../stock/schemas/stock-adjustment.schema';
import {
  StockTransfer,
  StockTransferSchema,
} from '../stock/schemas/stock-transfer.schema';
import {
  SupplierPayment,
  SupplierPaymentSchema,
} from '../suppliers/schemas/supplier-payment.schema';
import { Supplier, SupplierSchema } from '../suppliers/schemas/supplier.schema';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    // read-only aggregation across the other modules' collections
    MongooseModule.forFeature([
      { name: Sale.name, schema: SaleSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: CustomerPayment.name, schema: CustomerPaymentSchema },
      { name: Supplier.name, schema: SupplierSchema },
      { name: SupplierPayment.name, schema: SupplierPaymentSchema },
      { name: Purchase.name, schema: PurchaseSchema },
      { name: ProductLot.name, schema: ProductLotSchema },
      { name: StockAdjustment.name, schema: StockAdjustmentSchema },
      { name: StockTransfer.name, schema: StockTransferSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
