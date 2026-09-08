import { FeatureFlag, Role } from "@exams-generator/shared";
import { BankFoldersService } from "./bank-folders.service";
import { BankFoldersRepository } from "./bank-folders.repository";
import { FeatureFlagsService } from "../../feature-flags/feature-flags.service";
import { AuthTokenPayload } from "../../auth/token.service";

/**
 * `global_bank` reaching the folder tree's central-question badge.
 *
 * This lives here rather than in an e2e suite on purpose. `GET /bank/folders`
 * seeds a tenant's whole tree from the GLOBAL `courses`/`topics` catalog
 * (`loadSeedSource` reads every row of both), and a dozen other e2e suites
 * create and delete rows in that same catalog. Under `--maxWorkers=4` those
 * deletes land inside the seeding transaction and 500 it — a real race, but
 * one about test-fixture lifetimes, not about this flag. The fact worth
 * pinning is narrower and has no race in it: with the flag off, the service
 * must not ask the repository for central counts at all.
 */
describe("BankFoldersService.getTree — global_bank", () => {
  const user: AuthTokenPayload = { sub: "u1", tenantId: "t1", role: Role.Teacher };

  function buildDeps(includeGlobal: boolean) {
    const countCentralByTopic = jest.fn().mockResolvedValue(new Map([["topic-1", 7]]));
    const repository = {
      getFoldersSeededAt: jest.fn().mockResolvedValue(new Date()),
      listFolders: jest.fn().mockResolvedValue([
        {
          id: "f1",
          tenantId: "t1",
          parentId: null,
          name: "Matemática",
          topicId: "topic-1",
          position: 0,
        },
      ]),
      countOwnByFolder: jest.fn().mockResolvedValue(new Map([["f1", 3]])),
      countCentralByTopic,
      countUnfiled: jest.fn().mockResolvedValue(0),
    } as unknown as BankFoldersRepository;

    const features = {
      isEnabled: jest.fn().mockResolvedValue(includeGlobal),
    } as unknown as FeatureFlagsService;

    return { service: new BankFoldersService(repository, features), countCentralByTopic, features };
  }

  it("counts central questions while the school still has the central bank", async () => {
    const { service, countCentralByTopic, features } = buildDeps(true);

    await service.getTree(user);

    expect(features.isEnabled).toHaveBeenCalledWith(FeatureFlag.GlobalBank, "t1");
    expect(countCentralByTopic).toHaveBeenCalledWith(["topic-1"]);
  });

  it("does not even ask for central counts once the flag is off", async () => {
    const { service, countCentralByTopic } = buildDeps(false);

    const tree = await service.getTree(user);

    // Not "asks and ignores the answer": a tree that still advertises a bank
    // the listing refuses to serve is the bug, and skipping the query is
    // also one less round trip on every bank page load.
    expect(countCentralByTopic).not.toHaveBeenCalled();
    expect(JSON.stringify(tree)).not.toMatch(/"centralCount":[1-9]/);
  });

  it("leaves the school's own filed counts alone", async () => {
    const { service } = buildDeps(false);

    const tree = await service.getTree(user);

    // Withdrawing a shared library must not touch what the school filed
    // itself.
    expect(JSON.stringify(tree)).toMatch(/"ownCount":3/);
  });
});
