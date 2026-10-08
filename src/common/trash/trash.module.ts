import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Customer,
  CustomerSchema,
} from '../../modules/customers/schemas/customer.schema';
import { Rack, RackSchema } from '../../modules/locations/schemas/rack.schema';
import { Office, OfficeSchema } from '../../modules/office/schemas/office.schema';
import {
  Product,
  ProductSchema,
} from '../../modules/products/schemas/product.schema';
import { Staff, StaffSchema } from '../../modules/staff/schemas/staff.schema';
import {
  Supplier,
  SupplierSchema,
} from '../../modules/suppliers/schemas/supplier.schema';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

@Module({
  imports: [
    // every collection the bin can hold; ledger records are not among them
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Supplier.name, schema: SupplierSchema },
      { name: Staff.name, schema: StaffSchema },
      { name: Office.name, schema: OfficeSchema },
      { name: Rack.name, schema: RackSchema },
    ]),
  ],
  controllers: [TrashController],
  providers: [TrashService],
})
export class TrashModule {}
