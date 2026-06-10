import { PartialType } from '@nestjs/swagger';
import { CreateOfficeDto } from './create-office.dto';

// PUT (full) and PATCH (partial) both use this — every field optional at the
// type level; PUT semantics enforced by sending the whole object from client.
export class UpdateOfficeDto extends PartialType(CreateOfficeDto) {}
