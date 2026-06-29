import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CounterDocument = HydratedDocument<Counter>;

// Atomic sequence generator — one doc per named sequence (e.g. 'role_id').
@Schema({ _id: false, versionKey: false })
export class Counter {
  @Prop({ type: String })
  _id!: string; // sequence name

  @Prop({ type: Number, default: 0 })
  seq!: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
