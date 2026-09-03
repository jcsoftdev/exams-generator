import {
  BankFolderNode,
  BankFoldersResponse,
  CreateBankFolderDto,
  DeleteBankFolderResponse,
  UNFILED_FOLDER_ID,
  UpdateBankFolderDto,
} from "@exams-generator/shared";
import { Injectable } from "@nestjs/common";
import { isUUID } from "class-validator";
import { AuthTokenPayload } from "../../auth/token.service";
import { BankFoldersRepository, isUniqueViolation } from "./bank-folders.repository";
import { bankFolderError } from "./bank-folders.errors";
import { FlatFolderRow, assembleFolderTree } from "./domain/assemble-folder-tree";
import { buildSeedFolderPlan } from "./domain/build-seed-folder-plan";
import { checkFolderMove } from "./domain/check-folder-move";
import { validateFolderName } from "./domain/folder-name";

/**
 * A malformed `parentId` (not a UUID at all) can never be a real folder, in
 * this tenant or any other — so it is a 404 `folder_not_found`, same as a
 * well-formed id that doesn't resolve. Checked before the id ever reaches a
 * query: Postgres would otherwise reject it as an invalid `uuid` literal and
 * that 500 would leak a database error to the caller instead of the stable
 * error code the web already handles.
 */
function isUuid(value: string): boolean {
  return isUUID(value);
}

export type FolderScope =
  | { readonly unfiled: true }
  | { readonly unfiled: false; readonly folderId: string; readonly folderTopicId: string | null };

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

  /**
   * Validates and loads a candidate parent — shared by `create` and `update`
   * so the uuid-shape check and the tenant-scoped existence check live in one
   * place. A malformed `parentId` and a well-formed one that doesn't resolve
   * both end in the same `folder_not_found`: another tenant's folder is
   * indistinguishable from a missing one, and neither can ever be a real
   * folder of THIS tenant.
   */
  private async resolveParent(tenantId: string, parentId: string): Promise<FlatFolderRow> {
    if (!isUuid(parentId)) {
      throw bankFolderError("folder_not_found");
    }
    const parent = await this.repository.findFolder(tenantId, parentId);
    if (!parent) {
      throw bankFolderError("folder_not_found");
    }
    return parent;
  }

  async create(user: AuthTokenPayload, dto: CreateBankFolderDto): Promise<BankFolderNode> {
    const tenantId = this.requireTenantId(user);

    const validated = validateFolderName(dto.name);
    if (!validated.ok) {
      throw bankFolderError(validated.code);
    }

    const parentId = dto.parentId ?? null;
    if (parentId !== null) {
      await this.resolveParent(tenantId, parentId);
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

  /**
   * Rename, move, or both. `parentId` is only touched when the key is PRESENT in
   * the body — `undefined` means "leave it where it is", `null` means "make it a
   * root". That distinction is the whole reason the DTO's field is
   * `parentId?: string | null` and not just `string | null`.
   */
  async update(user: AuthTokenPayload, id: string, dto: UpdateBankFolderDto): Promise<BankFolderNode> {
    const tenantId = this.requireTenantId(user);

    const folder = await this.repository.findFolder(tenantId, id);
    if (!folder) {
      throw bankFolderError("folder_not_found");
    }

    const patch: { name?: string; parentId?: string | null; position?: number } = {};

    if (dto.name !== undefined) {
      const validated = validateFolderName(dto.name);
      if (!validated.ok) {
        throw bankFolderError(validated.code);
      }
      patch.name = validated.name;
    }

    const movingParent = Object.prototype.hasOwnProperty.call(dto, "parentId");
    if (movingParent) {
      const targetParentId = dto.parentId ?? null;

      if (targetParentId !== null) {
        await this.resolveParent(tenantId, targetParentId);
      }

      const subtree = await this.repository.loadSubtree(tenantId, id);
      const targetParentDepth =
        targetParentId === null ? 0 : await this.repository.folderDepth(tenantId, targetParentId);

      const move = checkFolderMove({
        folderId: id,
        targetParentId,
        descendantIds: subtree.ids,
        targetParentDepth,
        subtreeHeight: subtree.height,
      });
      if (!move.ok) {
        throw bankFolderError(move.code);
      }

      patch.parentId = targetParentId;
      // Landing among new siblings: go last, same rule `create` applies.
      patch.position = await this.repository.nextPosition(tenantId, targetParentId);
    }

    if (patch.name === undefined && !movingParent) {
      // Nothing asked for — hand the folder back unchanged rather than issue an
      // UPDATE with an empty SET (which Drizzle rejects at runtime).
      return this.toNode(folder);
    }

    try {
      const updated = await this.repository.updateFolder(tenantId, id, patch);
      if (!updated) {
        throw bankFolderError("folder_not_found");
      }
      return this.toNode(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw bankFolderError("folder_name_taken");
      }
      throw error;
    }
  }

  /**
   * Removes the folder and its whole subtree FROM THE TENANT'S TREE. It never
   * deletes a question: the tenant's own ones come back unfiled, and the central
   * ones were never filed here to begin with — they simply stop being reachable
   * through this branch. The returned counts are what the UI shows afterwards.
   */
  async remove(user: AuthTokenPayload, id: string): Promise<DeleteBankFolderResponse> {
    const tenantId = this.requireTenantId(user);

    const folder = await this.repository.findFolder(tenantId, id);
    if (!folder) {
      throw bankFolderError("folder_not_found");
    }

    const subtree = await this.repository.loadSubtree(tenantId, id);
    const unfiledQuestions = await this.repository.deleteSubtree(tenantId, id, subtree.ids);

    return { deletedFolders: subtree.ids.length, unfiledQuestions };
  }

  /**
   * Turns the raw `?folderId=` value into the scope the questions repository
   * understands. `unfiled` is a sentinel, not an id; anything else must be a
   * folder of THIS tenant or the caller gets a 404 — the same
   * id-enumeration guard `BankService.getQuestionById` applies to questions.
   */
  async resolveFolderScope(user: AuthTokenPayload, raw: string): Promise<FolderScope> {
    const tenantId = this.requireTenantId(user);

    if (raw === UNFILED_FOLDER_ID) {
      return { unfiled: true };
    }

    // Same guard `resolveParent` applies: a malformed id can never be a real
    // folder, in this tenant or any other, and letting it through would hit
    // Postgres as an invalid `uuid` literal (500) instead of the stable code.
    if (!isUuid(raw)) {
      throw bankFolderError("folder_not_found");
    }

    const folder = await this.repository.findFolder(tenantId, raw);
    if (!folder) {
      throw bankFolderError("folder_not_found");
    }
    return { unfiled: false, folderId: folder.id, folderTopicId: folder.topicId };
  }

  /**
   * The two rules that gate putting a question INTO a folder.
   *
   * 1. A central-bank question (`tenantId === null`) can never carry one:
   *    folders are per-tenant, the central bank is shared, and a shared row
   *    pointing at one school's cabinet is meaningless. 422, because the
   *    request is well-formed and the caller may well be allowed to edit the
   *    question — it is the COMBINATION that is impossible.
   * 2. The folder must belong to the caller's tenant. 404, not 403: a folder id
   *    must not be usable to probe another school's structure.
   */
  async assertAssignableFolder(
    user: AuthTokenPayload,
    questionTenantId: string | null,
    folderId: string | null,
  ): Promise<void> {
    if (folderId === null) {
      return;
    }
    if (questionTenantId === null) {
      throw bankFolderError("central_question_has_no_folder");
    }
    const tenantId = this.requireTenantId(user);
    const folder = await this.repository.findFolder(tenantId, folderId);
    if (!folder) {
      throw bankFolderError("folder_not_found");
    }
  }
}
