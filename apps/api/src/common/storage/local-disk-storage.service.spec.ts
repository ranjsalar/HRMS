import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NotFoundException } from "@nestjs/common";
import { LocalDiskStorageService } from "./local-disk-storage.service";

describe("LocalDiskStorageService", () => {
  let rootDir: string;
  let service: LocalDiskStorageService;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "hrms-storage-test-"));
    service = new LocalDiskStorageService(rootDir);
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("round-trips a saved file", async () => {
    const buffer = Buffer.from("hello world");
    await service.save("company-1/doc-1", buffer);

    expect(await service.exists("company-1/doc-1")).toBe(true);
    const read = await service.read("company-1/doc-1");
    expect(read.equals(buffer)).toBe(true);
  });

  it("creates nested directories as needed", async () => {
    await service.save("a/b/c/doc.bin", Buffer.from("x"));
    expect(await service.exists("a/b/c/doc.bin")).toBe(true);
  });

  it("delete removes the file", async () => {
    await service.save("doc-2", Buffer.from("x"));
    await service.delete("doc-2");
    expect(await service.exists("doc-2")).toBe(false);
  });

  it("reading a missing key throws NotFoundException, not a raw fs error", async () => {
    await expect(service.read("does-not-exist")).rejects.toThrow(NotFoundException);
  });

  it("rejects a key that attempts to escape the storage root via path traversal", async () => {
    await expect(service.save("../../etc/passwd", Buffer.from("x"))).rejects.toThrow(
      /outside the storage root/,
    );
  });
});
