import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CourseListItem, TopicListItem } from "./taxonomy.repository";
import { TaxonomyService } from "./taxonomy.service";

/**
 * `GET /courses` and `GET /topics` — read-only global taxonomy catalog
 * (design doc: courses/topics are shared across every tenant, never
 * tenant-scoped). Behind `JwtAuthGuard` only: any authenticated role can
 * read the catalog (no `RolesGuard`/`TenantGuard`, same convention as the
 * `ai` module's `POST /ai/questions/generate`), since there is no
 * tenant-scoping concern for a global read-only list.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class TaxonomyController {
  constructor(private readonly service: TaxonomyService) {}

  @Get("courses")
  async listCourses(): Promise<CourseListItem[]> {
    return this.service.listCourses();
  }

  @Get("topics")
  async listTopics(@Query("courseId") courseId?: string): Promise<TopicListItem[]> {
    return this.service.listTopics(courseId);
  }
}
