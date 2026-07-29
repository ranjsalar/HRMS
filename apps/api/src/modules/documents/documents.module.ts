import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AuditModule } from "../audit/audit.module";
import { EmployeesModule } from "../employees/employees.module";
import { STORAGE_SERVICE } from "../../common/storage/storage.interface";
import { LocalDiskStorageService } from "../../common/storage/local-disk-storage.service";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { DocumentTokenService } from "./document-token.service";

@Module({
  // Same reasoning as AuthModule's JwtModule.register({}): DocumentTokenService
  // supplies its own secret (DOCUMENT_URL_SECRET) per call, not a module-wide default.
  imports: [JwtModule.register({}), AuditModule, EmployeesModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentTokenService,
    {
      provide: STORAGE_SERVICE,
      useFactory: (config: ConfigService) =>
        new LocalDiskStorageService(
          config.get<string>("DOCUMENT_STORAGE_PATH") ?? "./storage/documents",
        ),
      inject: [ConfigService],
    },
  ],
})
export class DocumentsModule {}
