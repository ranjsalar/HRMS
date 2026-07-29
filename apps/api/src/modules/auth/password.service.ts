import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

// OWASP Password Storage Cheat Sheet's current minimum-recommended
// argon2id profile — deliberately the *minimum*, not a heavier profile,
// because this runs on a single small VPS shared with Postgres/Redis/
// Next.js (see the project plan's hosting section). See DECISIONS.md.
const ARGON2_OPTIONS: argon2.Options & { type: 0 | 1 | 2 } = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, ARGON2_OPTIONS);
  }

  verify(hash: string, plaintext: string): Promise<boolean> {
    return argon2.verify(hash, plaintext);
  }
}
