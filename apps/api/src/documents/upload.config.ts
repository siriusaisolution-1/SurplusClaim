import path from 'node:path';

import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const parsedMaxUploadBytes = Number.parseInt(process.env.MAX_UPLOAD_BYTES ?? '', 10);
export const MAX_UPLOAD_BYTES =
  Number.isNaN(parsedMaxUploadBytes) || parsedMaxUploadBytes <= 0
    ? DEFAULT_MAX_UPLOAD_BYTES
    : parsedMaxUploadBytes;
export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'];

type UploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
};

export function validateFileInput(file: UploadFile | undefined) {
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

export const uploadFileFilter: MulterFileFilter = (_req: Request, file, cb) => {
  try {
    validateFileInput(file);
    cb(null, true);
  } catch (error) {
    cb(error as Error, false);
  }
};
