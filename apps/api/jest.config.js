/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  moduleFileExtensions: ["js", "json", "ts"],
  moduleNameMapper: {
    "^@exams-generator/shared$": "<rootDir>/../../../packages/shared/src/index.ts",
    "^@exams-generator/shared/(.*)$": "<rootDir>/../../../packages/shared/src/$1",
  },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
};
