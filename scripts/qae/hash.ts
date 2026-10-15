/** scrypt password hash matching src/lib/auth.ts hashPassword (without server-only import). */
import { randomBytes, scryptSync } from "crypto";

export function hashPasswordSync(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}
