import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended nonce size for GCM
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const base64Key = process.env.FIELD_ENCRYPTION_KEY;
  if (!base64Key) {
    throw new Error("FIELD_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256-GCM");
  }
  return key;
}

/**
 * Encrypts a plaintext string for storage in a sensitive Prisma field
 * (Employee.nationalId, Employee.bankAccount, User.twoFaSecret). Output
 * format is `iv:authTag:ciphertext`, each base64, so it's a single opaque
 * string safe to store in a Prisma `String` column.
 */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ":",
  );
}

/**
 * Reverses encryptField. Throws if the ciphertext was tampered with (GCM
 * auth tag mismatch) or the stored value isn't in the expected format.
 */
export function decryptField(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted field format");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted field format");
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
