import { PartialType } from '@nestjs/swagger';
import { CreatePurchaseDto } from './create-purchase.dto';

// PUT (full) and PATCH (status) share this DTO.
export class UpdatePurchaseDto extends PartialType(CreatePurchaseDto) {}
