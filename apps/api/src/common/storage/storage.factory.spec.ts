import { ConfigService } from "@nestjs/config";
import { createStorageService } from "./storage.factory";
import { LocalDiskStorageService } from "./local-disk-storage.service";
import { S3StorageService } from "./s3-storage.service";

function fakeConfig(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Missing required environment variable: ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

describe("createStorageService", () => {
  it("returns LocalDiskStorageService when STORAGE_DRIVER is unset (the default everywhere right now)", () => {
    const service = createStorageService(
      fakeConfig({}),
      "DOCUMENT_STORAGE_PATH",
      "./storage/documents",
      "documents",
    );
    expect(service).toBeInstanceOf(LocalDiskStorageService);
  });

  it("returns LocalDiskStorageService when STORAGE_DRIVER=local explicitly", () => {
    const service = createStorageService(
      fakeConfig({ STORAGE_DRIVER: "local" }),
      "DOCUMENT_STORAGE_PATH",
      "./storage/documents",
      "documents",
    );
    expect(service).toBeInstanceOf(LocalDiskStorageService);
  });

  it("returns S3StorageService when STORAGE_DRIVER=s3, with all required S3 config present", () => {
    const service = createStorageService(
      fakeConfig({
        STORAGE_DRIVER: "s3",
        S3_BUCKET: "test-bucket",
        S3_REGION: "us-east-1",
        S3_ACCESS_KEY_ID: "key",
        S3_SECRET_ACCESS_KEY: "secret",
      }),
      "DOCUMENT_STORAGE_PATH",
      "./storage/documents",
      "documents",
    );
    expect(service).toBeInstanceOf(S3StorageService);
  });

  it("throws immediately, not lazily, when STORAGE_DRIVER=s3 but required S3 config is missing", () => {
    expect(() =>
      createStorageService(
        fakeConfig({ STORAGE_DRIVER: "s3" }),
        "DOCUMENT_STORAGE_PATH",
        "./storage/documents",
        "documents",
      ),
    ).toThrow("Missing required environment variable: S3_BUCKET");
  });
});
