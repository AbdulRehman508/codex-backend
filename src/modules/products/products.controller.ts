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
  Put,
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
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({
    summary: 'List products (slim: name, price, quantity, status)',
  })
  @ApiResponse({ status: 200, description: 'Paginated list' })
  async findAll(@Query() query: QueryProductDto) {
    const result = await this.productsService.findAll(query);
    return { message: 'Products fetched', data: result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one product with its location' })
  @ApiQuery({ name: 'office_id', required: false })
  async findOne(
    @Param('id') id: string,
    @Query('office_id') officeId?: string,
  ) {
    const data = await this.productsService.findOne(id, officeId);
    return { message: 'Product fetched', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create product' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 409, description: 'Duplicate sku / barcode' })
  async create(
    @Body() dto: CreateProductDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const data = await this.productsService.create(dto, userId);
    return { message: 'Product created', data };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Full update' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const data = await this.productsService.update(id, dto, userId);
    return { message: 'Product updated', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partial update (toggle status, move location)' })
  async patch(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const data = await this.productsService.patch(id, dto, userId);
    return { message: 'Product updated', data };
  }

  @Delete()
  @ApiOperation({ summary: 'Bulk soft-delete by ids' })
  async bulkRemove(@Body() dto: BulkDeleteDto) {
    const result = await this.productsService.bulkRemove(dto);
    return { message: 'Products deleted', data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete one product' })
  async remove(@Param('id') id: string) {
    const result = await this.productsService.remove(id);
    return { message: 'Product deleted', data: result };
  }
}
