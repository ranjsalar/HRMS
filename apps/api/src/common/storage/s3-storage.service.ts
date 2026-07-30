import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { NotFoundException } from "@nestjs/common";
import type { StorageService } from "./storage.interface";

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Mirrors LocalDiskStorageService's rootDir — logical separation
   * (documents vs payslips) within ONE shared bucket, via a key
   * prefix, rather than requiring a separate bucket per use. */
  keyPrefix: string;
}

/**
 * S3-compatible implementation of StorageService — works against real
 * AWS S3, DigitalOcean Spaces, or any other S3-API-compatible service
 * (MinIO, used to verify this class actually works — see DECISIONS.md,
 * "Infrastructure pass, item 7"), differing only by which endpoint/
 * credentials are configured. Built to the SAME interface
 * LocalDiskStorageService implements, so switching DocumentsModule/
 * PayrollModule's binding is a config change (STORAGE_DRIVER=s3), not a
 * code change — matching the project plan's stated path ("start with
 * local disk in dev, S3/DigitalOcean Spaces in prod").
 *
 * NOT the active backend yet — local disk remains active in every
 * environment (including this Dockerized production compose stack)
 * until a real bucket exists. See DECISIONS.md for the founder's
 * explicit, cost-driven deferral of DigitalOcean Spaces specifically.
 */
export class S3StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.keyPrefix = config.keyPrefix;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async save(key: string, buffer: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.prefixedKey(key),
        Body: buffer,
        // Documents/payslips are only ever reached through this app's
        // own signed-URL download endpoints (see DocumentsService/
        // PayslipsService), never a public bucket URL — no ACL needed,
        // and deliberately not set, so a real Spaces/S3 bucket's own
        // default (private) is what actually governs access.
      }),
    );
  }

  async read(key: string): Promise<Buffer> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.prefixedKey(key) }),
      );
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) throw new NotFoundException("Stored file not found");
      return Buffer.from(bytes);
    } catch (error) {
      // NOT `instanceof NotFound` — that typed class is specific to
      // HeadObjectCommand's 404 shape (which is why exists()'s bare
      // catch worked fine). GetObjectCommand's real "missing key"
      // response is a differently-shaped error ("NoSuchKey", not
      // "NotFound") — found by actually running this against real
      // MinIO, where this exact mismatch made the "genuinely missing
      // key" test fail with the SDK's raw message instead of this
      // service's own NotFoundException. Checking the HTTP status code
      // instead of a specific named error class is robust across
      // GetObject vs HeadObject AND across providers (AWS S3/MinIO/
      // DigitalOcean Spaces), none of which are guaranteed to shape
      // their "not found" XML identically.
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
        throw new NotFoundException("Stored file not found");
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.prefixedKey(key) }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.prefixedKey(key) }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private prefixedKey(key: string): string {
    return `${this.keyPrefix}/${key}`;
  }
}
