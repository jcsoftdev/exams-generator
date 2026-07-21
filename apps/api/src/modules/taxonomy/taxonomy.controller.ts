import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { isGradeLevel, stageForGrade } from "../exams/domain/value-objects/grade-level";
import {
  CourseListItem,
  ExamTypeListItem,
  TopicListItem,
  TrackListItem,
  UniversityListItem,
} from "./taxonomy.repository";
import { TaxonomyService } from "./taxonomy.service";

/**
 * `GET /courses`, `GET /topics`, `GET /universities`,
 * `GET /universities/:universityId/tracks`, and
 * `GET /exam-types` — read-only global taxonomy catalogs (design
 * doc: courses/topics/universities/tracks/exam types are shared across
 * every tenant, never tenant-scoped). Behind `JwtAuthGuard` only: any
 * authenticated role can read the catalog (no `RolesGuard`/`TenantGuard`,
 * same convention as the `ai` module's `POST /ai/questions/generate`), since
 * there is no tenant-scoping concern for a global read-only list.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class TaxonomyController {
  constructor(private readonly service: TaxonomyService) {}

  /**
   * `?gradeLevel=` scopes the catalog to that grade's educational stage
   * (escuela | colegio | preuniversitario). Omitted or unrecognized → the full
   * catalog, so callers that don't yet pass a grade keep working.
   */
  @Get("courses")
  async listCourses(@Query("gradeLevel") gradeLevel?: string): Promise<CourseListItem[]> {
    const stage = gradeLevel && isGradeLevel(gradeLevel) ? stageForGrade(gradeLevel) : undefined;
    return this.service.listCourses(stage);
  }

  /** `?gradeLevel=` returns only the topics assessed at that grade; omitted → every topic of the course. */
  @Get("topics")
  async listTopics(
    @Query("courseId") courseId?: string,
    @Query("gradeLevel") gradeLevel?: string,
  ): Promise<TopicListItem[]> {
    const grade = gradeLevel && isGradeLevel(gradeLevel) ? gradeLevel : undefined;
    return this.service.listTopics(courseId, grade);
  }

  /** Every university in the global catalog, ordered by name. */
  @Get("universities")
  async listUniversities(): Promise<UniversityListItem[]> {
    return this.service.listUniversities();
  }

  /**
   * A university's tracks, ordered by code. Empty array is a normal,
   * expected response for a university with no track concept — not an error.
   */
  @Get("universities/:universityId/tracks")
  async listTracksForUniversity(
    @Param("universityId") universityId: string,
  ): Promise<TrackListItem[]> {
    return this.service.listTracksForUniversity(universityId);
  }

  /** Every exam type in the global catalog, ordered by its curated sortOrder. */
  @Get("exam-types")
  async listExamTypes(): Promise<ExamTypeListItem[]> {
    return this.service.listExamTypes();
  }
}
