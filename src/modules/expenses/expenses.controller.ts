import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/permissions/permissions.decorator';
import {
  CreateExpenseDto,
  QueryExpenseDto,
  UpdateExpenseDto,
} from './dto/expense.dto';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
} from './dto/recurring-expense.dto';
import { ExpensesService } from './expenses.service';
import { RecurringExpensesService } from './recurring.service';

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly recurring: RecurringExpensesService,
  ) {}

  @RequirePermission('expenses', 'view')
  @Get()
  @ApiOperation({
    summary: 'What the shop spent, with totals split by cash and by category',
  })
  async findAll(@Query() query: QueryExpenseDto) {
    // a standing bill that fell due is written the first time anyone looks,
    // so the list is never missing a rent nobody typed in
    await this.recurring.materialiseDue(query.office_id);
    const data = await this.expenses.findAll(query);
    return { message: 'Expenses fetched', data };
  }

  // ---------- bills that come round again ----------

  @RequirePermission('expenses', 'view')
  @Get('recurring')
  @ApiOperation({ summary: 'Standing instructions: rent, wages, anything monthly' })
  @ApiQuery({ name: 'office_id', required: false })
  async listRecurring(@Query('office_id') officeId?: string) {
    await this.recurring.materialiseDue(officeId);
    const data = await this.recurring.findAll(officeId);
    return { message: 'Recurring expenses fetched', data };
  }

  @RequirePermission('expenses', 'create')
  @Post('recurring')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Set a bill to repeat — it writes itself each time it falls due',
  })
  async createRecurring(
    @Body() dto: CreateRecurringExpenseDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const doc = await this.recurring.create(dto, userId);
    return { message: 'Recurring expense saved', data: doc.toJSON() };
  }

  @RequirePermission('expenses', 'edit')
  @Patch('recurring/:id')
  @ApiOperation({ summary: 'Change or pause a standing instruction' })
  async updateRecurring(
    @Param('id') id: string,
    @Body() dto: UpdateRecurringExpenseDto,
  ) {
    const doc = await this.recurring.update(id, dto);
    return { message: 'Recurring expense updated', data: doc.toJSON() };
  }

  @RequirePermission('expenses', 'delete')
  @Delete('recurring/:id')
  @ApiOperation({ summary: 'Stop a bill repeating. Entries already written stay.' })
  async removeRecurring(@Param('id') id: string) {
    const data = await this.recurring.remove(id);
    return { message: 'Recurring expense removed', data };
  }

  // before :id, or "categories" is read as an id
  @RequirePermission('expenses', 'view')
  @Get('categories')
  @ApiOperation({ summary: 'The starter categories plus the ones in use here' })
  @ApiQuery({ name: 'office_id', required: false })
  async categories(@Query('office_id') officeId?: string) {
    const data = await this.expenses.categories(officeId);
    return { message: 'Expense categories fetched', data };
  }

  @RequirePermission('expenses', 'view')
  @Get(':id')
  @ApiOperation({ summary: 'One expense' })
  @ApiQuery({ name: 'office_id', required: false })
  async findOne(
    @Param('id') id: string,
    @Query('office_id') officeId?: string,
  ) {
    const doc = await this.expenses.findOne(id, officeId);
    return { message: 'Expense fetched', data: doc.toJSON() };
  }

  @RequirePermission('expenses', 'create')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record money the shop spent' })
  async create(
    @Body() dto: CreateExpenseDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const doc = await this.expenses.create(dto, userId);
    return { message: 'Expense recorded', data: doc.toJSON() };
  }

  @RequirePermission('expenses', 'edit')
  @Patch(':id')
  @ApiOperation({ summary: 'Fix an expense — amount, date, category, note' })
  async update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    const doc = await this.expenses.update(id, dto);
    return { message: 'Expense updated', data: doc.toJSON() };
  }

  @RequirePermission('expenses', 'delete')
  @Delete(':id')
  @ApiOperation({ summary: 'Remove an expense — it goes to the trash' })
  @ApiResponse({ status: 404, description: 'No such expense' })
  async remove(@Param('id') id: string) {
    const data = await this.expenses.remove(id);
    return { message: 'Expense deleted', data };
  }
}
