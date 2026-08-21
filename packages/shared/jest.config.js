/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  transform: { "^.+\\.ts$": ["ts-jest", { isolatedModules: true }] },
  testEnvironment: "node",
  rootDir: "src",
  testRegex: "\\.spec\\.ts$",
  moduleFileExtensions: ["js", "json", "ts"],
};
