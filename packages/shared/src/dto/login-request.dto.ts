/**
 * POST /auth/login request body. Framework-agnostic (no class-validator
 * decorators) so it can be shared verbatim with the Angular frontend —
 * validation is the API's concern, not this package's.
 */
export interface LoginRequestDto {
  email: string;
  password: string;
}
