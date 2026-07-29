import { randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Document, DocumentType, PermissionScope } from "@prisma/client";
import { fromBuffer } from "file-type";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import { TenantScopedRunner } from "../../database/prisma/tenant-scoped-runner.service";
import { STORAGE_SERVICE, type StorageService } from "../../common/storage/storage.interface";
import { validateDocumentFile } from "../../common/files/file-validation";
import { AuditService } from "../audit/audit.service";
import { EmployeesService } from "../employees/employees.service";
import { DocumentTokenService } from "./document-token.service";

export interface RequestActor {
  userId: string;
  ipAddress?: string;
}

export interface SignedUrlResult {
  url: string;
  expiresAt: Date;
}

export interface DownloadResult {
  buffer: Buffer;
  mime: string;
  filename: string;
}

/**
 * Every access path — upload, signed-URL generation, and the eventual
 * download — is gated the same way the rest of the app is: RBAC via
 * @RequirePermission on the controller, then department-scope via
 * EmployeesService.isVisible (the SAME scope-resolution Employee CRUD
 * uses — a manager can only generate a link for a document belonging to
 * an employee in their managed department, because that's exactly what
 * "is this employee visible to this caller" already means).
 *
 * fileUrl on the Document row is NOT a working URL — it's the internal
 * storage key (`{companyId}/{documentId}`). The only place an actual,
 * fetchable URL is produced is createSignedUrl(), fresh, every time it's
 * called, per the "regenerate on each authorized request, never cache a
 * long-lived link" instruction. There's deliberately no `mimeType` column
 * on Document either — the file's real type is re-detected from its
 * bytes at download time (single source of truth: what's actually on
 * disk), not trusted from a value that could drift from the stored file.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly tenantContext: TenantContextStorage,
    private readonly scoped: TenantScopedRunner,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly documentTokens: DocumentTokenService,
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
  ) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("DocumentsService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  async upload(
    companyId: string,
    employeeId: string,
    type: DocumentType,
    buffer: Buffer,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<Document> {
    // Was missing entirely before step 9.4: the only thing that made this
    // safe until now was that documents:create had no self/own_department
    // grant at all (admin-only, scope "all"). Adding employee self-service
    // upload (see default-role-permissions.ts) means this check is now
    // load-bearing — without it, a self-scoped employee could upload a
    // document under ANY employeeId in the company, not just their own.
    // Same isVisible() reuse as createSignedUrl() below.
    const visible = await this.employees.isVisible(employeeId, requestingUserId, scope);
    if (!visible) {
      throw new NotFoundException("Employee not found");
    }

    const validated = await validateDocumentFile(buffer);

    const documentId = randomUUID();
    const storageKey = `${companyId}/${documentId}`;
    await this.storage.save(storageKey, buffer);

    try {
      const document = await this.tx().document.create({
        data: { id: documentId, companyId, employeeId, type, fileUrl: storageKey },
      });

      await this.audit.record({
        userId: actor.userId,
        action: "upload",
        entity: "Document",
        entityId: documentId,
        ipAddress: actor.ipAddress,
        metadata: { documentType: type, detectedMime: validated.mime },
      });

      return document;
    } catch (error) {
      // Don't leave an orphaned file on disk if the DB write failed.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  /** `/documents/me` — the employee's own documents, resolved the same "no client-supplied employeeId" way as Attendance/Leave self-reads. */
  async myDocuments(requestingUserId: string): Promise<Document[]> {
    const employee = await this.tx().employee.findUnique({
      where: { userId: requestingUserId },
      select: { id: true },
    });
    if (!employee) return [];
    return this.tx().document.findMany({
      where: { employeeId: employee.id },
      orderBy: { uploadedAt: "desc" },
    });
  }

  async createSignedUrl(
    documentId: string,
    requestingUserId: string,
    scope: PermissionScope,
    actor: RequestActor,
  ): Promise<SignedUrlResult | null> {
    const document = await this.tx().document.findUnique({ where: { id: documentId } });
    if (!document) return null;

    const visible = await this.employees.isVisible(document.employeeId, requestingUserId, scope);
    if (!visible) return null;

    const { token, expiresAt } = this.documentTokens.issue({
      documentId: document.id,
      companyId: document.companyId,
    });

    await this.audit.record({
      userId: actor.userId,
      action: "generate_signed_url",
      entity: "Document",
      entityId: documentId,
      ipAddress: actor.ipAddress,
    });

    return { url: `/documents/download?token=${token}`, expiresAt };
  }

  /**
   * Public/token-gated endpoint — no request.user, so no
   * TenantScopeInterceptor transaction exists for this call. Opens its
   * own scoped transaction (TenantScopedRunner, same pattern AuthService
   * and RbacGuard use) using the companyId embedded in the token itself,
   * and explicitly populates TenantContextStorage within it so
   * AuditService (which reads that same storage) still works here.
   *
   * The download audit entry has userId: null — deliberate, not an
   * oversight. Whoever generated the signed URL is attributed (a real
   * userId, in createSignedUrl's audit entry above); whoever actually
   * fetches the URL within its short TTL is only provable as "someone
   * holding this token," identical to how S3 presigned URLs work. Both
   * events are logged, which is what gives this a real paper trail.
   */
  async downloadByToken(token: string): Promise<DownloadResult | null> {
    const payload = this.documentTokens.verify(token);

    return this.scoped.run(payload.companyId, (tx) =>
      this.tenantContext.run({ tx, companyId: payload.companyId }, async () => {
        const document = await tx.document.findUnique({ where: { id: payload.documentId } });
        if (!document) return null;

        const buffer = await this.storage.read(document.fileUrl);
        const detected = await fromBuffer(buffer);

        await this.audit.record({
          userId: null,
          action: "download",
          entity: "Document",
          entityId: document.id,
        });

        return {
          buffer,
          mime: detected?.mime ?? "application/octet-stream",
          filename: `${document.type}-${document.id}.${detected?.ext ?? "bin"}`,
        };
      }),
    );
  }
}
