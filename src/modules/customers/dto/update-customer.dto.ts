import { PartialType } from '@nestjs/swagger';
import { CreateCustomerDto } from './create-customer.dto';

// PUT (full) and PATCH (partial) both use this — PUT semantics are enforced by
// the client sending the whole object.
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}
