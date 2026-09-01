import { PartialType } from '@nestjs/swagger';
import { CreateRackDto } from './create-rack.dto';

// PUT (full) and PATCH (partial) share this DTO; the service only regenerates
// bins for the dimension/code fields actually present in the body.
export class UpdateRackDto extends PartialType(CreateRackDto) {}
