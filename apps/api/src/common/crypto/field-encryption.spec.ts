import { randomBytes } from "node:crypto";
import { decryptField, encryptField } from "./field-encryption";

describe("field-encryption", () => {
  const originalKey = process.env.FIELD_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  afterAll(() => {
    process.env.FIELD_ENCRYPTION_KEY = originalKey;
  });

  it("round-trips a plaintext value", () => {
    const plaintext = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptField(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptField(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const plaintext = "same-input";
    expect(encryptField(plaintext)).not.toBe(encryptField(plaintext));
  });

  it("throws when the ciphertext has been tampered with", () => {
    const encrypted = encryptField("sensitive-value");
    const [iv, authTag, ciphertext] = encrypted.split(":");
    const tampered = [iv, authTag, ciphertext.slice(0, -4) + "AAAA"].join(":");
    expect(() => decryptField(tampered)).toThrow();
  });

  it("throws on a malformed stored value", () => {
    expect(() => decryptField("not-a-valid-format")).toThrow();
  });
});
