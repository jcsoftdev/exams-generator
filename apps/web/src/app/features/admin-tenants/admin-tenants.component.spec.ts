import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminTenantsComponent } from './admin-tenants.component';
import { AdminTenantsService } from './admin-tenants.service';
import { AdminTenant } from './admin-tenants.models';

function tenant(o: Partial<AdminTenant> & { id: string }): AdminTenant {
  return {
    id: o.id,
    name: o.name ?? 'Colegio X',
    slug: o.slug ?? 'colegio-x',
    city: o.city ?? null,
    logoAssetId: o.logoAssetId ?? null,
    active: o.active ?? true,
  };
}

function setup(overrides: {
  listImpl?: () => unknown;
  createImpl?: () => unknown;
  updateImpl?: () => unknown;
  removeImpl?: () => unknown;
} = {}) {
  const list = vi.fn(overrides.listImpl ?? (() => of({ items: [tenant({ id: 't1' }), tenant({ id: 't2', active: false })], total: 2 })));
  const create = vi.fn(overrides.createImpl ?? (() => of(tenant({ id: 't3', name: 'Nuevo Colegio', slug: 'nuevo-colegio' }))));
  const update = vi.fn(overrides.updateImpl ?? ((id: string, patch: Partial<AdminTenant>) => of(tenant({ id, ...patch }))));
  const remove = vi.fn(overrides.removeImpl ?? (() => of({ deleted: true as const })));

  TestBed.configureTestingModule({
    imports: [AdminTenantsComponent],
    providers: [{ provide: AdminTenantsService, useValue: { list, create, update, remove } }],
  });
  const fixture = TestBed.createComponent(AdminTenantsComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, list, create, update, remove };
}

describe('AdminTenantsComponent', () => {
  it('loads and renders tenants with their active status', () => {
    const { compiled, list } = setup();

    expect(list).toHaveBeenCalledWith(1, 20);
    const rows = compiled.querySelectorAll('[data-testid="tenant-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Colegio X');
    expect(rows[0].textContent).toContain('Activo');
    expect(rows[1].textContent).toContain('Inactivo');
  });

  it('shows a retry button on load failure', () => {
    const { compiled, list } = setup({ listImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })) });

    expect(compiled.querySelector('[data-testid="error-state"]')).toBeTruthy();
    list.mockClear();
    (compiled.querySelector('[data-testid="retry-button"] button') as HTMLButtonElement).click();
    expect(list).toHaveBeenCalled();
  });

  it('shows an empty state when there are no tenants', () => {
    const { compiled } = setup({ listImpl: () => of({ items: [], total: 0 }) });

    expect(compiled.querySelector('[data-testid="empty-tenants"]')).toBeTruthy();
  });

  it('disables Crear until name and a valid slug are filled', () => {
    const { fixture, compiled, create } = setup();
    (compiled.querySelector('[data-testid="create-tenant"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const submit = compiled.querySelector('[data-testid="create-submit"] button') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    submit.click();
    expect(create).not.toHaveBeenCalled();

    (fixture.componentInstance as unknown as { createName: { set(v: string): void } }).createName.set('Colegio Nuevo');
    (fixture.componentInstance as unknown as { createSlug: { set(v: string): void } }).createSlug.set('colegio-nuevo');
    fixture.detectChanges();

    expect(submit.disabled).toBe(false);
    submit.click();
    expect(create).toHaveBeenCalledWith({ name: 'Colegio Nuevo', slug: 'colegio-nuevo' });
  });

  it('edits a tenant name/city', () => {
    const { fixture, compiled, update } = setup();
    (compiled.querySelector('[data-testid="tenant-edit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.componentInstance as unknown as { editName: { set(v: string): void } }).editName.set('Colegio Renombrado');
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="edit-submit"] button') as HTMLButtonElement).click();

    expect(update).toHaveBeenCalledWith('t1', { name: 'Colegio Renombrado', city: '' });
  });

  it('deactivating asks for confirmation before calling update', () => {
    const { fixture, compiled, update } = setup();
    (compiled.querySelectorAll('[data-testid="tenant-toggle-active"] button')[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(update).not.toHaveBeenCalled();
    (compiled.querySelector('[data-testid="deactivate-confirm-yes"] button') as HTMLButtonElement).click();
    expect(update).toHaveBeenCalledWith('t1', { active: false });
  });

  it('reactivating does NOT ask for confirmation (non-destructive)', () => {
    const { compiled, update } = setup();
    (compiled.querySelectorAll('[data-testid="tenant-toggle-active"] button')[1] as HTMLButtonElement).click();

    expect(update).toHaveBeenCalledWith('t2', { active: true });
  });

  it('deleting asks for confirmation before calling remove', () => {
    const { fixture, compiled, remove } = setup();
    (compiled.querySelectorAll('[data-testid="tenant-delete"] button')[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(remove).not.toHaveBeenCalled();
    (compiled.querySelector('[data-testid="delete-confirm-yes"] button') as HTMLButtonElement).click();
    expect(remove).toHaveBeenCalledWith('t1');
  });
});
