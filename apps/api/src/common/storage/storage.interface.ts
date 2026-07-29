/**
 * Storage abstraction so DocumentsService never talks to the filesystem
 * (or, later, S3) directly. Matches the project plan's stated path:
 * "start with local disk in dev, S3/DigitalOcean Spaces in prod" — the
 * local implementation is what step 5 needs; swapping in an S3-backed
 * implementation later means writing one new class against this same
 * interface and changing the DI binding, not touching any calling code.
 */
export interface StorageService {
  save(key: string, buffer: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export const STORAGE_SERVICE = Symbol("STORAGE_SERVICE");
