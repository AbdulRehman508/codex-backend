import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { CreateTransferDto } from './dto/create-transfer.dto';
import { QueryTransferDto } from './dto/query-transfer.dto';
import { TransfersService } from './transfers.service';

@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock/transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @RequirePermission('stock', 'view')
  @Get()
  @ApiOperation({ summary: 'Branch-to-branch stock movements, sent and received' })
  async findAll(@Query() query: QueryTransferDto) {
    const result = await this.transfersService.findAll(query);
    return { message: 'Stock transfers fetched', data: result };
  }

  @RequirePermission('stock', 'view')
  @Get(':id')
  @ApiOperation({ summary: 'Get one transfer with its lines' })
  @ApiQuery({ name: 'office_id', required: false })
  async findOne(
    @Param('id') id: string,
    @Query('office_id') officeId?: string,
  ) {
    const doc = await this.transfersService.findOne(id, officeId);
    return { message: 'Stock transfer fetched', data: doc.toJSON() };
  }

  @RequirePermission('stock', 'create')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send stock to another branch (the receiver gets the product too)',
  })
  @ApiResponse({ status: 400, description: 'Not enough stock at the sending branch' })
  async create(
    @Body() dto: CreateTransferDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const doc = await this.transfersService.create(dto, userId);
    return { message: 'Stock transferred', data: doc.toJSON() };
  }

  @RequirePermission('stock', 'delete')
  @Delete(':id')
  @ApiOperation({ summary: 'Reverse a transfer — the units go back' })
  @ApiResponse({ status: 400, description: 'Already sold on at the receiving branch' })
  async remove(@Param('id') id: string) {
    const result = await this.transfersService.remove(id);
    return { message: 'Stock transfer reversed', data: result };
  }
}
