import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CountersModule } from '../../common/counters/counters.module';
import { StorageModule } from '../../common/storage/storage.module';
import { Office, OfficeSchema } from '../office/schemas/office.schema';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { RecurringExpensesService } from './recurring.service';
import { Expense, ExpenseSchema } from './schemas/expense.schema';
import {
  RecurringExpense,
  RecurringExpenseSchema,
} from './schemas/recurring-expense.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Expense.name, schema: ExpenseSchema },
      { name: RecurringExpense.name, schema: RecurringExpenseSchema },
      // the office is the FK existence check
      { name: Office.name, schema: OfficeSchema },
    ]),
    // EXP-0001 numbering, per office
    CountersModule,
    // the photographed bill is stored like any other image
    StorageModule,
  ],
  controllers: [ExpensesController],
  providers: [ExpensesService, RecurringExpensesService],
  exports: [ExpensesService, RecurringExpensesService],
})
export class ExpensesModule {}
