import { mkdirSync } from 'fs';
import { join } from 'path';
import type { Request } from 'express';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const multer = require('multer');

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CERTIFICATE_SIZE = 10 * 1024 * 1024; // 10MB

function isProfileImageAllowed(mimetype: string): boolean {
  return !!mimetype && ALLOWED_IMAGE_MIMES.includes(mimetype);
}

export function getTutorUploadOptions() {
  return {
    storage: multer.diskStorage({
      destination: (req: Request & { user?: { userId: number } }, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) => {
        const userId = req.user?.userId;
        if (!userId) {
          cb(new Error('Unauthorized'), '');
          return;
        }
        const path = join(process.cwd(), 'uploads', 'tutor', String(userId));
        mkdirSync(path, { recursive: true });
        cb(null, path);
      },
      filename: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
        const ext = file.originalname?.match(/\.[^.]+$/)?.[0] ?? '';
        cb(null, `${file.fieldname}-${Date.now()}${ext}`);
      },
    }),
    limits: { fileSize: MAX_CERTIFICATE_SIZE },
    fileFilter: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
      const maxSize = file.fieldname === 'profileImage' ? MAX_IMAGE_SIZE : MAX_CERTIFICATE_SIZE;
      if (file.fieldname === 'profileImage' && !isProfileImageAllowed(file.mimetype ?? '')) {
        cb(new Error(`profileImage: allowed types ${ALLOWED_IMAGE_MIMES.join(', ')}`), false);
        return;
      }
      if (file.fieldname === 'certificate') {
        // Allow any file type (PDF, DOCX, images, etc.)
      }
      if (file.size > maxSize) {
        cb(new Error(`${file.fieldname}: max size ${file.fieldname === 'profileImage' ? '5MB' : '10MB'}`), false);
        return;
      }
      cb(null, true);
    },
  };
}
