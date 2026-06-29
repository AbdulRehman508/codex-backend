import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB decoded
const UPLOAD_ROOT = join(process.cwd(), 'uploads');
const DATA_URL_RE = /^data:(?<mime>[a-z]+\/[a-z0-9.+-]+);base64,(?<data>.+)$/i;

export interface SaveImageOptions {
  // sub-folder under /uploads (and the public URL path segment)
  folder?: string;
  // field name used in the validation error map
  field?: string;
}

@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService) {
    if (!existsSync(UPLOAD_ROOT)) {
      mkdirSync(UPLOAD_ROOT, { recursive: true });
    }
  }

  /**
   * Validate a base64 image data URL and persist it to disk.
   * @returns public URL of the stored file
   * @throws BadRequestException on bad mime / oversize / malformed input
   */
  saveBase64Image(dataUrl: string, opts: SaveImageOptions = {}): string {
    const folder = opts.folder ?? 'offices';
    const field = opts.field ?? 'office_logo';

    const match = DATA_URL_RE.exec(dataUrl.trim());
    if (!match?.groups) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: {
          [field]: ['must be a valid base64 image data URL'],
        },
      });
    }

    const mime = match.groups.mime.toLowerCase();
    const ext = ALLOWED_MIME[mime];
    if (!ext) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: {
          [field]: [
            `unsupported image type "${mime}" (allowed: ${Object.keys(ALLOWED_MIME).join(', ')})`,
          ],
        },
      });
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(match.groups.data, 'base64');
    } catch {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { [field]: ['invalid base64 payload'] },
      });
    }

    if (buffer.length === 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { [field]: ['empty image payload'] },
      });
    }

    if (buffer.length > MAX_BYTES) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: {
          [field]: [
            `image exceeds max size of ${MAX_BYTES / (1024 * 1024)} MB`,
          ],
        },
      });
    }

    const dir = join(UPLOAD_ROOT, folder);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const fileName = `${randomUUID()}.${ext}`;
    writeFileSync(join(dir, fileName), buffer);

    return this.publicUrl(folder, fileName);
  }

  private publicUrl(folder: string, fileName: string): string {
    const base = (
      this.config.get<string>('appUrl') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    return `${base}/uploads/${folder}/${fileName}`;
  }
}
