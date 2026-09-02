import { PartialType } from '@nestjs/swagger';
import { CreateSaleDto } from './create-sale.dto';

// PUT (full) and PATCH (partial, mainly status) share this DTO.
export class UpdateSaleDto extends PartialType(CreateSaleDto) {}
