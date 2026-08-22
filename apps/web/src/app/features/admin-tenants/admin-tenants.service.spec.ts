import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminTenantsService } from './admin-tenants.service';

describe('AdminTenantsService', () => {
  let service: AdminTenantsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AdminTenantsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AdminTenantsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('list GETs /tenants with page/pageSize', () => {
    service.list(2, 20).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/tenants');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('20');
    req.flush({ items: [], total: 0 });
  });

  it('create POSTs /tenants with name and slug', () => {
    service.create({ name: 'Colegio Nuevo', slug: 'colegio-nuevo' }).subscribe();
    const req = httpMock.expectOne('/api/tenants');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Colegio Nuevo', slug: 'colegio-nuevo' });
    req.flush({
      id: 't1',
      name: 'Colegio Nuevo',
      slug: 'colegio-nuevo',
      city: null,
      logoAssetId: null,
      active: true,
    });
  });

  it('update PATCHes /tenants/:id', () => {
    service.update('t1', { active: false }).subscribe();
    const req = httpMock.expectOne('/api/tenants/t1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ active: false });
    req.flush({
      id: 't1',
      name: 'Colegio',
      slug: 'colegio',
      city: null,
      logoAssetId: null,
      active: false,
    });
  });

  it('remove DELETEs /tenants/:id', () => {
    service.remove('t1').subscribe();
    const req = httpMock.expectOne('/api/tenants/t1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ deleted: true });
  });
});
