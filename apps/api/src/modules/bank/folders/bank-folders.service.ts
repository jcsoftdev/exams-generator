import { BankFolderNode, BankFoldersResponse, CreateBankFolderDto } from "@exams-generator/shared";
import { Injectable } from "@nestjs/common";
import { AuthTokenPayload } from "../../auth/token.service";
import { BankFoldersRepository, isUniqueViolation } from "./bank-folders.repository";
import { bankFolderError } from "./bank-folders.errors";
import { FlatFolderRow, assembleFolderTree } from "./domain/assemble-folder-tree";
import { buildSeedFolderPlan } from "./domain/build-seed-folder-plan";
import { checkFolderMove } from "./domain/check-folder-move";
import { validateFolderName } from "./domain/folder-name";

@Injectable()
export class BankFoldersService {
  constructor(private readonly repository: BankFoldersRepository) {}

  /**
   * Every folder route needs a tenant: folders ARE the tenant's own structure,
   * so platform staff (`tenantId: null`) has nothing to read here. 403 with a
   * stable code rather than an empty tree, so the web can say why instead of
   * rendering a blank cabinet.
   */
  private requireTenantId(user: AuthTokenPayload): string {
    if (!user.tenantId) {
      throw bankFolderError("tenant_required");
    }
    return user.tenantId;
  }

  /**
   * The tree, seeding on the way in when this tenant has never been seeded.
   * On-the-fly rather than at tenant creation: no job, no migration backfill,
   * and a tenant created before this feature existed gets its cabinet the
   * first time a teacher opens the bank.
   *
   * The seeding check itself is two-tier: an unlocked read of
   * `folders_seeded_at` first, and only when THAT says "never seeded" does it
   * fall through to `loadSeedSource` + `seedIfNeeded` — which re-checks the
   * same marker under `FOR UPDATE` inside its own transaction. Every request
   * after a tenant's first one (the overwhelming majority, forever) takes
   * only the cheap read: no whole-taxonomy load, no row lock. The race the
   * lock exists for (two tabs' FIRST call landing at the same instant) is
   * unaffected — both still reach `seedIfNeeded`, and its internal recheck is
   * what actually serializes them.
   */
  async getTree(user: AuthTokenPayload): Promise<BankFoldersResponse> {
    const tenantId = this.requireTenantId(user);

    const seededAt = await this.repository.getFoldersSeededAt(tenantId);
    if (seededAt === null) {
      const source = await this.repository.loadSeedSource();
      await this.repository.seedIfNeeded(tenantId, buildSeedFolderPlan(source.courses, source.topics));
    }

    const rows = await this.repository.listFolders(tenantId);
    const topicIds = rows.map((row) => row.topicId).filter((id): id is string => id !== null);

    const [ownCounts, centralCounts, unfiledCount] = await Promise.all([
      this.repository.countOwnByFolder(tenantId),
      this.repository.countCentralByTopic(topicIds),
      this.repository.countUnfiled(tenantId),
    ]);

    return { folders: assembleFolderTree(rows, ownCounts, centralCounts), unfiledCount };
  }

  /**
   * A freshly created/renamed folder as the wire shape. Counts are always zero
   * for a NEW folder and the children array empty; a rename returns the node
   * with its stored counts refreshed by the caller's next `GET /bank/folders`,
   * which the web issues anyway after an optimistic update settles.
   */
  private toNode(row: FlatFolderRow, ownCount = 0, centralCount = 0): BankFolderNode {
    return {
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      topicId: row.topicId,
      position: row.position,
      ownCount,
      centralCount,
      children: [],
    };
  }

  async create(user: AuthTokenPayload, dto: CreateBankFolderDto): Promise<BankFolderNode> {
    const tenantId = this.requireTenantId(user);

    const validated = validateFolderName(dto.name);
    if (!validated.ok) {
      throw bankFolderError(validated.code);
    }

    const parentId = dto.parentId ?? null;
    if (parentId !== null) {
      const parent = await this.repository.findFolder(tenantId, parentId);
      if (!parent) {
        // Another tenant's folder is indistinguishable from a missing one.
        throw bankFolderError("folder_not_found");
      }
      const parentDepth = await this.repository.folderDepth(tenantId, parentId);
      // A brand-new folder is a leaf, so its subtree is exactly 1 level tall.
      const move = checkFolderMove({
        folderId: "new",
        targetParentId: parentId,
        descendantIds: [],
        targetParentDepth: parentDepth,
        subtreeHeight: 1,
      });
      if (!move.ok) {
        throw bankFolderError(move.code);
      }
    }

    const position = await this.repository.nextPosition(tenantId, parentId);

    try {
      const row = await this.repository.insertFolder({
        tenantId,
        parentId,
        name: validated.name,
        position,
      });
      return this.toNode(row);
    } catch (error) {
      // The unique indexes are the sibling-name rule; a SELECT-then-INSERT would
      // just be a slower way to lose the same race.
      if (isUniqueViolation(error)) {
        throw bankFolderError("folder_name_taken");
      }
      throw error;
    }
  }
}
