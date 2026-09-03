import { BankFoldersResponse } from "@exams-generator/shared";
import { Injectable } from "@nestjs/common";
import { AuthTokenPayload } from "../../auth/token.service";
import { BankFoldersRepository } from "./bank-folders.repository";
import { bankFolderError } from "./bank-folders.errors";
import { assembleFolderTree } from "./domain/assemble-folder-tree";
import { buildSeedFolderPlan } from "./domain/build-seed-folder-plan";

@Injectable()
export class BankFoldersService {
  constructor(private readonly repository: BankFoldersRepository) {}

  /**
   * Every folder route needs a tenant: folders ARE the tenant's own structure,
   * so platform staff (`tenantId: null`) has nothing to read here. 403 with a
   * stable code rather than an empty tree, so the web can say why instead of
   * rendering a blank cabinet.
   */
  protected requireTenantId(user: AuthTokenPayload): string {
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
   */
  async getTree(user: AuthTokenPayload): Promise<BankFoldersResponse> {
    const tenantId = this.requireTenantId(user);

    const source = await this.repository.loadSeedSource();
    await this.repository.seedIfNeeded(tenantId, buildSeedFolderPlan(source.courses, source.topics));

    const rows = await this.repository.listFolders(tenantId);
    const topicIds = rows.map((row) => row.topicId).filter((id): id is string => id !== null);

    const [ownCounts, centralCounts, unfiledCount] = await Promise.all([
      this.repository.countOwnByFolder(tenantId),
      this.repository.countCentralByTopic(topicIds),
      this.repository.countUnfiled(tenantId),
    ]);

    return { folders: assembleFolderTree(rows, ownCounts, centralCounts), unfiledCount };
  }
}
