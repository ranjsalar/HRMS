import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Response } from "express";
import { Public } from "../../common/decorators/public.decorator";
import { ClientIp } from "../../common/decorators/client-ip.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CurrentPermissionScope } from "../../common/decorators/current-permission-scope.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { FileValidationError, MAX_DOCUMENT_SIZE_BYTES } from "../../common/files/file-validation";
import type { AccessTokenPayload } from "../auth/token.service";
import type { PermissionScope } from "@prisma/client";
import { DocumentsService } from "./documents.service";
import { UploadDocumentDto } from "./dto/upload-document.dto";

@Controller("documents")
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @RequirePermission("documents", "create")
  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(), // buffer in memory so magic-byte validation runs BEFORE anything touches disk
      limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
    }),
  )
  async upload(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
    @ClientIp() ipAddress: string,
  ) {
    if (!file) {
      throw new BadRequestException("A file is required");
    }
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    try {
      return await this.documentsService.upload(
        user.companyId,
        dto.employeeId,
        dto.type,
        file.buffer,
        user.sub,
        scope,
        { userId: user.sub, ipAddress },
      );
    } catch (error) {
      // FileValidationError's messages are deliberately client-safe (no
      // internal paths/details) — this is the one place a file's bytes are
      // rejected, so it maps to 400, not the GlobalExceptionFilter's
      // generic 500 backstop for unrecognized errors.
      if (error instanceof FileValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  // Registered before ":id"-shaped routes for the same reason as
  // Employees'/Department's "me"/"org-chart" routes.
  @RequirePermission("documents", "view")
  @Get("me")
  myDocuments(@CurrentUser() user: AccessTokenPayload) {
    return this.documentsService.myDocuments(user.sub);
  }

  // Generates a fresh, short-lived signed URL — never a stored/cached one.
  // Department-scoped exactly like Employee reads: the guard resolves
  // {module: "documents", action: "view"} to a scope, and the service
  // checks that scope against the document's OWN employee, not just "is
  // this user authenticated."
  @RequirePermission("documents", "view")
  @Get(":id/signed-url")
  async signedUrl(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @ClientIp() ipAddress: string,
  ) {
    const result = await this.documentsService.createSignedUrl(id, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!result) {
      throw new NotFoundException("Document not found");
    }
    return result;
  }

  // Deliberately @Public(): this is the link itself (what a browser
  // navigates to, or an <img>/<a> points at), so it can't require an
  // Authorization header. Authorization already happened when the signed
  // URL was generated; the token in the query string IS the credential
  // for this short window, same as an S3 presigned URL.
  @Public()
  @Get("download")
  async download(@Query("token") token: string, @Res() res: Response): Promise<void> {
    if (!token) {
      throw new BadRequestException("Missing token");
    }
    const result = await this.documentsService.downloadByToken(token);
    if (!result) {
      throw new NotFoundException("Document not found");
    }
    res.setHeader("Content-Type", result.mime);
    res.setHeader("Content-Disposition", `inline; filename="${result.filename}"`);
    res.send(result.buffer);
  }
}
