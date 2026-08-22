import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Role } from '@exams-generator/shared';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [UsersService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UsersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('list GETs /users with page/pageSize', () => {
    service.list(2, 20).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/users');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('20');
    req.flush({ items: [], total: 0 });
  });

  it('create POSTs /users with email, name and role', () => {
    service.create({ email: 'a@b.pe', name: 'Ana Beltrán', role: Role.Teacher }).subscribe();
    const req = httpMock.expectOne('/api/users');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.pe', name: 'Ana Beltrán', role: 'teacher' });
    req.flush({
      id: 'u1',
      email: 'a@b.pe',
      name: 'Ana Beltrán',
      role: 'teacher',
      temporaryPassword: 'abc123def456',
    });
  });

  it('setActive PATCHes /users/:id', () => {
    service.setActive('u1', false).subscribe();
    const req = httpMock.expectOne('/api/users/u1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ active: false });
    req.flush({ id: 'u1', active: false });
  });

  it('resetPassword POSTs /users/:id/reset-password', () => {
    service.resetPassword('u1').subscribe();
    const req = httpMock.expectOne('/api/users/u1/reset-password');
    expect(req.request.method).toBe('POST');
    req.flush({ id: 'u1', temporaryPassword: 'zzz999yyy888' });
  });
});
