import {
  CourseListItem,
  ExamTypeListItem,
  TaxonomyRepository,
  TopicListItem,
  TrackListItem,
  UniversityListItem,
} from "./taxonomy.repository";
import { TaxonomyService } from "./taxonomy.service";

function buildDeps() {
  const repository = {
    findAllCourses: jest.fn().mockResolvedValue([] as CourseListItem[]),
    findTopics: jest.fn().mockResolvedValue([] as TopicListItem[]),
    findTopicsByCourseIds: jest.fn().mockResolvedValue([] as TopicListItem[]),
    findAllUniversities: jest.fn().mockResolvedValue([] as UniversityListItem[]),
    findTracksByUniversity: jest.fn().mockResolvedValue([] as TrackListItem[]),
    findAllExamTypes: jest.fn().mockResolvedValue([] as ExamTypeListItem[]),
  } as unknown as jest.Mocked<TaxonomyRepository>;

  const service = new TaxonomyService(repository);
  return { service, repository };
}

describe("TaxonomyService", () => {
  describe("listCourses", () => {
    it("delegates to TaxonomyRepository.findAllCourses with no stage when omitted", async () => {
      const { service, repository } = buildDeps();
      const courses: CourseListItem[] = [{ id: "course-1", name: "Aritmética" }];
      repository.findAllCourses.mockResolvedValue(courses);

      const result = await service.listCourses();

      expect(repository.findAllCourses).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(courses);
    });

    it("forwards the stage to TaxonomyRepository.findAllCourses when provided", async () => {
      const { service, repository } = buildDeps();

      await service.listCourses("colegio");

      expect(repository.findAllCourses).toHaveBeenCalledWith("colegio");
    });
  });

  describe("listTopics", () => {
    it("delegates to TaxonomyRepository.findTopics with no filter when both args are omitted", async () => {
      const { service, repository } = buildDeps();
      const topics: TopicListItem[] = [{ id: "topic-1", name: "Fracciones", courseId: "course-1" }];
      repository.findTopics.mockResolvedValue(topics);

      const result = await service.listTopics();

      expect(repository.findTopics).toHaveBeenCalledWith(undefined, undefined);
      expect(result).toEqual(topics);
    });

    it("forwards courseId and gradeLevel to TaxonomyRepository.findTopics when provided", async () => {
      const { service, repository } = buildDeps();

      await service.listTopics("course-1", "secundaria_2");

      expect(repository.findTopics).toHaveBeenCalledWith("course-1", "secundaria_2");
    });
  });

  describe("listTopicsByCourseIds", () => {
    it("delegates to TaxonomyRepository.findTopicsByCourseIds with no gradeLevel when omitted", async () => {
      const { service, repository } = buildDeps();
      const topics: TopicListItem[] = [{ id: "topic-1", name: "Fracciones", courseId: "course-1" }];
      repository.findTopicsByCourseIds.mockResolvedValue(topics);

      const result = await service.listTopicsByCourseIds(["course-1", "course-2"]);

      expect(repository.findTopicsByCourseIds).toHaveBeenCalledWith(["course-1", "course-2"], undefined);
      expect(result).toEqual(topics);
    });

    it("forwards gradeLevel to TaxonomyRepository.findTopicsByCourseIds when provided", async () => {
      const { service, repository } = buildDeps();

      await service.listTopicsByCourseIds(["course-1", "course-2"], "secundaria_2");

      expect(repository.findTopicsByCourseIds).toHaveBeenCalledWith(["course-1", "course-2"], "secundaria_2");
    });
  });

  describe("listUniversities", () => {
    it("delegates to TaxonomyRepository.findAllUniversities", async () => {
      const { service, repository } = buildDeps();
      const universities: UniversityListItem[] = [{ id: "uni-1", code: "uni", name: "Universidad Nacional de Ingeniería" }];
      repository.findAllUniversities.mockResolvedValue(universities);

      const result = await service.listUniversities();

      expect(repository.findAllUniversities).toHaveBeenCalledWith();
      expect(result).toEqual(universities);
    });
  });

  describe("listTracksForUniversity", () => {
    it("delegates to TaxonomyRepository.findTracksByUniversity with the given universityId", async () => {
      const { service, repository } = buildDeps();
      const tracks: TrackListItem[] = [{ id: "track-1", code: "basico", name: "Ciclo Básico", kind: "cycle_track" }];
      repository.findTracksByUniversity.mockResolvedValue(tracks);

      const result = await service.listTracksForUniversity("uni-1");

      expect(repository.findTracksByUniversity).toHaveBeenCalledWith("uni-1");
      expect(result).toEqual(tracks);
    });
  });

  describe("listExamTypes", () => {
    it("delegates to TaxonomyRepository.findAllExamTypes", async () => {
      const { service, repository } = buildDeps();
      const examTypes: ExamTypeListItem[] = [
        { code: "manual", label: "Manual", courseScope: "none", weekScope: "none" },
      ];
      repository.findAllExamTypes.mockResolvedValue(examTypes);

      const result = await service.listExamTypes();

      expect(repository.findAllExamTypes).toHaveBeenCalledWith();
      expect(result).toEqual(examTypes);
    });
  });
});
