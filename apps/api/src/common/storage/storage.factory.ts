import { ConfigService } from "@nestjs/config";
import { LocalDiskStorageService } from "./local-disk-storage.service";
import { S3StorageService } from "./s3-storage.service";
import type { StorageService } from "./storage.interface";

/**
 * Shared by DocumentsModule and PayrollModule's STORAGE_SERVICE
 * bindings — one place deciding local-disk vs S3-compatible, instead of
 * duplicating the branch in both modules. STORAGE_DRIVER defaults to
 * "local" everywhere (dev, test, AND this project's current production
 * compose stack — see DECISIONS.md, "Infrastructure pass, item 7" for
 * why S3/DigitalOcean Spaces is code-ready but deliberately not the
 * active backend yet). Switching a real deployment to S3 later is
 * exactly one env var, not a code change.
 */
export function createStorageService(
  config: ConfigService,
  localPathEnvKey: string,
  localPathDefault: string,
  s3KeyPrefix: string,
): StorageService {
  const driver = config.get<string>("STORAGE_DRIVER", "local");

  if (driver === "s3") {
    return new S3StorageService({
      bucket: config.getOrThrow<string>("S3_BUCKET"),
      region: config.getOrThrow<string>("S3_REGION"),
      endpoint: config.get<string>("S3_ENDPOINT") || undefined,
      accessKeyId: config.getOrThrow<string>("S3_ACCESS_KEY_ID"),
      secretAccessKey: config.getOrThrow<string>("S3_SECRET_ACCESS_KEY"),
      forcePathStyle: config.get<boolean>("S3_FORCE_PATH_STYLE", false),
      keyPrefix: s3KeyPrefix,
    });
  }

  return new LocalDiskStorageService(config.get<string>(localPathEnvKey) ?? localPathDefault);
}
