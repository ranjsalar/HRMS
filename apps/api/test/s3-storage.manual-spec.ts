import { S3StorageService } from "../src/common/storage/s3-storage.service";

/**
 * Real verification of S3StorageService against a real S3-compatible
 * API — MinIO, run locally in Docker, chosen the same way MailDev was
 * chosen for email (see DECISIONS.md): a real, self-hostable, zero-
 * external-account way to prove the actual S3 API calls work, without
 * needing DigitalOcean Spaces credentials the founder has deliberately
 * deferred paying for yet.
 *
 * Deliberately named "*.manual-spec.ts", NOT "*.e2e-spec.ts" — this is
 * NOT part of the standard `pnpm test:e2e` run or CI (neither the dev
 * docker-compose.yml nor .github/workflows/ci.yml run a MinIO service;
 * adding one as a permanent dependency of the routine test suite isn't
 * justified for a backend that's deliberately not the active storage
 * driver anywhere yet).
 *
 * To run: start a local MinIO container and create a bucket, then
 * `pnpm --filter @hrms/api test:s3-storage`:
 *
 *   docker run -d --name hrms-minio-test -p 19000:9000 -p 19001:9001 \
 *     -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin123 \
 *     minio/minio server /data --console-address ":9001"
 *   docker run --rm --network container:hrms-minio-test --entrypoint sh \
 *     minio/mc -c "mc alias set local http://localhost:9000 minioadmin \
 *     minioadmin123 && mc mb local/hrms-test-bucket"
 */
describe("S3StorageService — real MinIO verification (manual, not part of standard CI)", () => {
  const bucket = process.env.S3_TEST_BUCKET ?? "hrms-test-bucket";
  const storage = new S3StorageService({
    bucket,
    region: "us-east-1", // MinIO ignores region but the SDK requires one
    endpoint: process.env.S3_TEST_ENDPOINT ?? "http://localhost:19000",
    accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "minioadmin123",
    forcePathStyle: true, // required for MinIO
    keyPrefix: "manual-verify",
  });

  const testKey = `test-file-${Date.now()}.txt`;
  const testContent = Buffer.from("real content, round-tripped through a real S3-compatible API");

  afterAll(async () => {
    await storage.delete(testKey).catch(() => undefined);
  });

  it("exists() is false before anything is saved", async () => {
    expect(await storage.exists(testKey)).toBe(false);
  });

  it("save() then read() round-trips the exact real bytes through real MinIO", async () => {
    await storage.save(testKey, testContent);
    const readBack = await storage.read(testKey);
    expect(readBack.equals(testContent)).toBe(true);
  });

  it("exists() is true after saving", async () => {
    expect(await storage.exists(testKey)).toBe(true);
  });

  it("delete() actually removes the real object", async () => {
    await storage.delete(testKey);
    expect(await storage.exists(testKey)).toBe(false);
  });

  it("read() on a genuinely missing key throws NotFoundException, not a raw SDK error", async () => {
    await expect(storage.read(`never-existed-${Date.now()}`)).rejects.toThrow(
      "Stored file not found",
    );
  });
});
