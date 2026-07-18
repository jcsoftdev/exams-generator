import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [UsersService, provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(UsersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('list GETs /users', () => {
    service.list().subscribe();
    const req = httpMock.expectOne('/api/users');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('create POSTs /users with email and role', () => {
    service.create({ email: 'a@b.pe', role: 'teacher' }).subscribe();
    const req = httpMock.expectOne('/api/users');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.pe', role: 'teacher' });
    req.flush({ id: 'u1', email: 'a@b.pe', role: 'teacher', temporaryPassword: 'abc123def456' });
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
