import { compare, hash } from "bcryptjs";

const SALT_ROUNDS = 10;

/** Hashes a plaintext password for storage in `users.password_hash`. */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain, SALT_ROUNDS);
}

/** Compares a plaintext password against a previously hashed value. */
export function comparePassword(plain: string, hashed: string): Promise<boolean> {
  return compare(plain, hashed);
}
