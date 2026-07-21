import { Injectable } from "@nestjs/common";
import type { Stage } from "../exams/domain/value-objects/grade-level";
import {
  CourseListItem,
  ExamTypeListItem,
  TaxonomyRepository,
  TopicListItem,
  TrackListItem,
  UniversityListItem,
} from "./taxonomy.repository";

/**
 * Thin pass-through service over `TaxonomyRepository` (courses/topics are
 * read-only global catalogs — no tenant scoping, no business rules to
 * enforce here, only the standard Nest controller -> service -> repository
 * layering this codebase already follows for `TenantsService`/`BankService`).
 */
@Injectable()
export class TaxonomyService {
  constructor(private readonly repository: TaxonomyRepository) {}

  async listCourses(stage?: Stage): Promise<CourseListItem[]> {
    return this.repository.findAllCourses(stage);
  }

  async listTopics(courseId?: string, gradeLevel?: string): Promise<TopicListItem[]> {
    return this.repository.findTopics(courseId, gradeLevel);
  }

  async listUniversities(): Promise<UniversityListItem[]> {
    return this.repository.findAllUniversities();
  }

  async listTracksForUniversity(universityId: string): Promise<TrackListItem[]> {
    return this.repository.findTracksByUniversity(universityId);
  }

  async listExamTypes(): Promise<ExamTypeListItem[]> {
    return this.repository.findAllExamTypes();
  }
}
