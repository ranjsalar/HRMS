import { PasswordService } from "./password.service";

describe("PasswordService", () => {
  const service = new PasswordService();

  it("hashes a password and verifies the correct password against it", async () => {
    const hash = await service.hash("correct horse battery staple");
    expect(hash).not.toContain("correct horse battery staple");
    expect(await service.verify(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await service.hash("correct horse battery staple");
    expect(await service.verify(hash, "wrong password")).toBe(false);
  });

  it("produces argon2id hashes", async () => {
    const hash = await service.hash("some-password");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("produces a different hash each time (random salt)", async () => {
    const [a, b] = await Promise.all([
      service.hash("same-password"),
      service.hash("same-password"),
    ]);
    expect(a).not.toBe(b);
  });
});
