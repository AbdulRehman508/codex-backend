import { PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

// PUT (full) and PATCH (partial) share this DTO.
export class UpdateProductDto extends PartialType(CreateProductDto) {}
