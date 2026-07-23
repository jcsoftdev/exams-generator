import { parseComposeApiEnvironmentKeys } from "./parse-compose-api-environment";

const SAMPLE = `services:
  postgres:
    environment:
      POSTGRES_USER: \${DB_USER:-exams}

  api:
    environment:
      DATABASE_URL: postgres://...
      JWT_SECRET: \${JWT_SECRET:?JWT_SECRET must be set}
      PORT: 3000
    ports:
      - "3012:3000"

  web:
    environment:
      SOMETHING_ELSE: foo
`;

describe("parseComposeApiEnvironmentKeys", () => {
  it("extracts only the api service's environment keys, not other services'", () => {
    expect(parseComposeApiEnvironmentKeys(SAMPLE)).toEqual(["DATABASE_URL", "JWT_SECRET", "PORT"]);
  });

  it("stops at the first key that de-indents past the environment block", () => {
    expect(parseComposeApiEnvironmentKeys(SAMPLE)).not.toContain("SOMETHING_ELSE");
  });
});
