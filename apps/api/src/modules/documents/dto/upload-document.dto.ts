import { IsIn, IsUUID } from "class-validator";

const DOCUMENT_TYPES = ["contract", "id", "passport", "certificate"] as const;

export class UploadDocumentDto {
  @IsUUID()
  employeeId!: string;

  @IsIn(DOCUMENT_TYPES)
  type!: (typeof DOCUMENT_TYPES)[number];
}
