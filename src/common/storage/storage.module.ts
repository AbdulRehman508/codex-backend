import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

// Shared file storage (base64 image -> disk URL). Import where needed.
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
