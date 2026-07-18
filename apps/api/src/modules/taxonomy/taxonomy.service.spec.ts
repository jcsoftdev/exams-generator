import { CourseListItem, TaxonomyRepository, TopicListItem } from "./taxonomy.repository";
import { TaxonomyService } from "./taxonomy.service";

function buildDeps() {
  const repository = {
    findAllCourses: jest.fn().mockResolvedValue([] as CourseListItem[]),
    findTopics: jest.fn().mockResolvedValue([] as TopicListItem[]),
  } as unknown as jest.Mocked<TaxonomyRepository>;

  const service = new TaxonomyService(repository);
  return { service, repository };
}

describe("TaxonomyService", () => {
  describe("listCourses", () => {
    it("delegates to TaxonomyRepository.findAllCourses", async () => {
      const { service, repository } = buildDeps();
      const courses: CourseListItem[] = [{ id: "course-1", name: "Aritmética" }];
      repository.findAllCourses.mockResolvedValue(courses);

      const result = await service.listCourses();

      expect(repository.findAllCourses).toHaveBeenCalledTimes(1);
      expect(result).toEqual(courses);
    });
  });

  describe("listTopics", () => {
    it("delegates to TaxonomyRepository.findTopics with no filter when courseId is omitted", async () => {
      const { service, repository } = buildDeps();
      const topics: TopicListItem[] = [{ id: "topic-1", name: "Fracciones", courseId: "course-1" }];
      repository.findTopics.mockResolvedValue(topics);

      const result = await service.listTopics();

      expect(repository.findTopics).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(topics);
    });

    it("forwards courseId to TaxonomyRepository.findTopics when provided", async () => {
      const { service, repository } = buildDeps();

      await service.listTopics("course-1");

      expect(repository.findTopics).toHaveBeenCalledWith("course-1");
    });
  });
});
