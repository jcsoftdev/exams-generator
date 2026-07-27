import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaxonomyService } from './taxonomy.service';
import { environment } from '../../../environments/environment';
import { Course, Topic } from './taxonomy.models';

describe('TaxonomyService', () => {
  let service: TaxonomyService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TaxonomyService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('getCourses', () => {
    it('GETs /courses', () => {
      service.getCourses().subscribe();

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/courses`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('resolves with the list of courses returned by the API', () => {
      const courses: Course[] = [{ id: 'course-1', name: 'Aritmética' }];
      let result: Course[] | undefined;

      service.getCourses().subscribe((response) => (result = response));

      const req = httpMock.expectOne(`${environment.apiBaseUrl}/courses`);
      req.flush(courses);

      expect(result).toEqual(courses);
    });
  });

  describe('getTopics', () => {
    it('GETs /topics with courseId as a query param', () => {
      service.getTopics('course-1').subscribe();

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/topics`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('courseId')).toBe('course-1');
      req.flush([]);
    });

    it('resolves with the list of topics returned by the API', () => {
      const topics: Topic[] = [{ id: 'topic-1', name: 'Fracciones', courseId: 'course-1' }];
      let result: Topic[] | undefined;

      service.getTopics('course-1').subscribe((response) => (result = response));

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/topics`,
      );
      req.flush(topics);

      expect(result).toEqual(topics);
    });
  });

  describe('getTopicsForCourses', () => {
    it('resolves with [] and makes no HTTP call when courseIds is empty', () => {
      let result: Topic[] | undefined;

      service.getTopicsForCourses([]).subscribe((response) => (result = response));

      httpMock.expectNone(`${environment.apiBaseUrl}/topics`);
      expect(result).toEqual([]);
    });

    it('GETs /topics with a comma-joined courseId param for multiple ids', () => {
      service.getTopicsForCourses(['course-1', 'course-2']).subscribe();

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/topics`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('courseId')).toBe('course-1,course-2');
      req.flush([]);
    });

    it('forwards gradeLevel as a query param when provided', () => {
      service.getTopicsForCourses(['course-1', 'course-2'], 'secundaria_2').subscribe();

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/topics`,
      );
      expect(req.request.params.get('gradeLevel')).toBe('secundaria_2');
      req.flush([]);
    });

    it('resolves with the combined list of topics returned by the API', () => {
      const topics: Topic[] = [
        { id: 'topic-1', name: 'Fracciones', courseId: 'course-1' },
        { id: 'topic-2', name: 'Álgebra', courseId: 'course-2' },
      ];
      let result: Topic[] | undefined;

      service.getTopicsForCourses(['course-1', 'course-2']).subscribe((response) => (result = response));

      const req = httpMock.expectOne(
        (request) => request.url === `${environment.apiBaseUrl}/topics`,
      );
      req.flush(topics);

      expect(result).toEqual(topics);
    });
  });
});
