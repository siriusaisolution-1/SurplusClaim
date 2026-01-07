import path from 'node:path';

import { BadRequestException } from '@nestjs/common';
import type { FileFilterCallback, Options as MulterOptions } from 'multer';

export const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES ?? '5242880', 10); // 5 MiB default
export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'];

export function validateFileInput(file: Express.Multer.File | undefined) {
  if (!file) {
    throw new BadRequestException('No file provided');
  }

  const extension = path.extname(file.originalname).toLowerCase();
  const size = file.size ?? file.buffer?.length ?? 0;

  if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || !ALLOWED_EXTENSIONS.includes(extension)) {
    throw new BadRequestException('Invalid file type. Only PDF and image files are allowed');
  }

  if (size === 0 || size > MAX_UPLOAD_BYTES) {
    throw new BadRequestException('File is empty or exceeds the maximum allowed size');
  }
}

export type MulterFileFilter = NonNullable<MulterOptions['fileFilter']>;

export const uploadFileFilter: MulterFileFilter = (_req, file, cb: FileFilterCallback) => {
  try {
    validateFileInput(file);
    cb(null, true);
  } catch (error) {
    cb(error as Error);
  }
};
