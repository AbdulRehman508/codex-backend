import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StorageModule } from '../../common/storage/storage.module';
import { Office, OfficeSchema } from '../office/schemas/office.schema';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import {
  CustomerPayment,
  CustomerPaymentSchema,
} from './schemas/customer-payment.schema';
import { Customer, CustomerSchema } from './schemas/customer.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Customer.name, schema: CustomerSchema },
      // trail of payments made against a customer's borrow balance
      { name: CustomerPayment.name, schema: CustomerPaymentSchema },
      // Office registered for the FK existence check
      { name: Office.name, schema: OfficeSchema },
    ]),
    StorageModule,
  ],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
