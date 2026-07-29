import { promises as fs } from "node:fs";
import * as path from "node:path";
import { NotFoundException } from "@nestjs/common";
import type { StorageService } from "./storage.interface";

/**
 * Stores files on local disk, outside the web root. Takes its root
 * directory as a plain constructor argument rather than reading a
 * hardcoded env var name itself — each module supplying the
 * STORAGE_SERVICE binding decides which config key applies (Documents:
 * `DOCUMENT_STORAGE_PATH`, Payroll: `PAYSLIP_STORAGE_PATH`), so this
 * class stays reusable across both without knowing either name. Both
 * default to a sibling of `apps/` under `<repo>/storage/`, never inside
 * `apps/api/dist` or anywhere Express/Next could ever be configured to
 * serve statically — nothing in this app serves static files from there;
 * the only way out is a signed-URL download endpoint that reads through
 * this service, not a direct file path.
 *
 * Keys are always server-generated (UUIDs from our own database) — never
 * derived from user input like an original filename — but resolvePath
 * still defends against path traversal, since "never derived from user
 * input today" is not the same guarantee as "structurally cannot be."
 */
export class LocalDiskStorageService implements StorageService {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  async save(key: string, buffer: Buffer): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer, { mode: 0o600 });
  }

  async read(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolvePath(key));
    } catch {
      throw new NotFoundException("Stored file not found");
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolvePath(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  private resolvePath(key: string): string {
    const full = path.resolve(this.rootDir, key);
    if (full !== this.rootDir && !full.startsWith(this.rootDir + path.sep)) {
      throw new Error(`Invalid storage key: "${key}" resolves outside the storage root`);
    }
    return full;
  }
}
