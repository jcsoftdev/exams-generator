import { Injectable } from "@nestjs/common";
import { CourseListItem, TaxonomyRepository, TopicListItem } from "./taxonomy.repository";

/**
 * Thin pass-through service over `TaxonomyRepository` (courses/topics are
 * read-only global catalogs — no tenant scoping, no business rules to
 * enforce here, only the standard Nest controller -> service -> repository
 * layering this codebase already follows for `TenantsService`/`BankService`).
 */
@Injectable()
export class TaxonomyService {
  constructor(private readonly repository: TaxonomyRepository) {}

  async listCourses(): Promise<CourseListItem[]> {
    return this.repository.findAllCourses();
  }

  async listTopics(courseId?: string): Promise<TopicListItem[]> {
    return this.repository.findTopics(courseId);
  }
}
