# Banco navegable como un Drive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el árbol lateral del banco por un grid de tarjetas navegable, tipo Drive, donde cada tarjeta es una carpeta del colegio y se lee como curso o tema.

**Architecture:** Las tarjetas se alimentan de `BankFoldersStore.tree()`, que ya existe y ya trae `ownCount`, `centralCount` y `totalCount` acumulado. La navegación es una ruta con el id de carpeta, no estado interno, para que el enlace se pueda compartir y el botón atrás funcione. `bank-list` conserva su trabajo actual (preguntas de una carpeta y panel de detalle) y gana un breadcrumb; el grid vive en un componente nuevo para no engordar un template que ya tiene 611 líneas.

**Tech Stack:** Angular 22 standalone con signals, Tailwind v4 con los tokens de `apps/web/src/styles.css`, iconos Lucide vía `LucideAngularModule.pick()`, tests con Vitest sobre TestBed (`ng test`).

**Spec:** el canvas aprobado el 2026-09-04, tres artboards: raíz con cursos, dentro de un curso con temas y breadcrumb, dentro de un tema con preguntas y detalle.

## Global Constraints

- **TDD estricto, y el test rojo es de FEATURE.** En la web eso es un spec de componente que maneja el flujo del usuario por TestBed. Los tests unitarios quedan SOLO para funciones puras.
- **Nunca compilar tras los cambios.** `pnpm --filter @exams-generator/web typecheck` sí; `build` no.
- **Correr solo los tests que el cambio toca**, nunca la suite completa.
- **Sin iconos genéricos de carpeta.** Cada tarjeta lleva un glifo de materia. Los iconos se registran con `LucideAngularModule.pick({ ... })` en el propio componente.
- **Sin colores nuevos.** Todo sale de los tokens ya definidos: `primary-50..900`, `n50..900`, `surface`, `tint-active`, `tint-text`, los pares semánticos y `radius-card` / `radius-field`.
- **Los outputs de Angular no pueden llamarse como un evento nativo del DOM** (`select`, `toggle`). Gotcha ya pagado en `feat/question-folders`.
- **Commits convencionales, sin atribución de IA.**

---

### Task 1: Primitiva `ui-breadcrumb`

No existe ninguna en el repo. La necesitan las tres pantallas.

**Files:**
- Create: `apps/web/src/app/ui/breadcrumb/breadcrumb.component.ts`
- Test: `apps/web/src/app/ui/breadcrumb/breadcrumb.component.spec.ts`

**Interfaces:**
- Produces: `BreadcrumbComponent` con selector `ui-breadcrumb`, `input<readonly BreadcrumbCrumb[]>('items')` y `output<string>('navigate')` que emite el `id` del crumb pulsado. `export interface BreadcrumbCrumb { readonly id: string; readonly label: string; }`. El último crumb se pinta como actual, no es un botón y no emite.

- [ ] **Step 1: Escribir el test rojo**

```ts
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { BreadcrumbComponent } from './breadcrumb.component';

function setup() {
  TestBed.configureTestingModule({ imports: [BreadcrumbComponent] });
  const fixture = TestBed.createComponent(BreadcrumbComponent);
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('BreadcrumbComponent', () => {
  it('renders every crumb and marks the last one as the current page', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('items', [
      { id: 'root', label: 'Mi banco' },
      { id: 'f1', label: 'Matemática' },
    ]);
    fixture.detectChanges();

    const crumbs = compiled.querySelectorAll('[data-testid="breadcrumb-crumb"]');
    expect(crumbs.length).toBe(2);
    expect(crumbs[0].tagName).toBe('BUTTON');
    expect(crumbs[1].tagName).not.toBe('BUTTON');
    expect(crumbs[1].getAttribute('aria-current')).toBe('page');
  });

  it('emits the id of a crumb that is not the last one', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('items', [
      { id: 'root', label: 'Mi banco' },
      { id: 'f1', label: 'Matemática' },
    ]);
    fixture.detectChanges();
    const seen: string[] = [];
    fixture.componentInstance.navigate.subscribe((id) => seen.push(id));

    compiled.querySelector<HTMLButtonElement>('[data-testid="breadcrumb-crumb"]')!.click();

    expect(seen).toEqual(['root']);
  });
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `cd apps/web && NG_CLI_ANALYTICS=false pnpm exec ng test --no-watch --include='**/breadcrumb/breadcrumb.component.spec.ts'`
Expected: FAIL — el módulo `./breadcrumb.component` no existe.

- [ ] **Step 3: Implementar lo mínimo**

```ts
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';

export interface BreadcrumbCrumb {
  readonly id: string;
  readonly label: string;
}

/**
 * Ruta de migas del banco. El último crumb NO es un botón: navegar a la
 * página en la que ya estás es un no-op que igual anuncia un cambio de ruta
 * a un lector de pantalla.
 */
@Component({
  selector: 'ui-breadcrumb',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [LucideAngularModule.pick({ ChevronRight }).providers ?? []],
  template: `
    <nav aria-label="Ruta" class="flex items-center gap-2 text-sm text-n600">
      @for (crumb of items(); track crumb.id; let last = $last) {
        @if (last) {
          <span data-testid="breadcrumb-crumb" aria-current="page" class="font-semibold text-n900">{{
            crumb.label
          }}</span>
        } @else {
          <button
            type="button"
            data-testid="breadcrumb-crumb"
            class="rounded-field font-medium text-tint-text hover:underline"
            (click)="navigate.emit(crumb.id)"
          >
            {{ crumb.label }}
          </button>
          <lucide-angular name="chevron-right" class="h-3.5 w-3.5 text-n300"></lucide-angular>
        }
      }
    </nav>
  `,
})
export class BreadcrumbComponent {
  readonly items = input<readonly BreadcrumbCrumb[]>([]);
  readonly navigate = output<string>();
}
```

- [ ] **Step 4: Correrlo y verlo pasar**

Run: el mismo comando del paso 2.
Expected: PASS, 2 de 2.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/ui/breadcrumb
git commit -m "feat(web): add a breadcrumb primitive for the bank"
```

---

### Task 2: Funciones puras de navegación del árbol

El grid necesita responder tres preguntas sobre `FolderTreeNode[]`: qué hijos muestro, qué ruta pinto en el breadcrumb, y si esta carpeta es hoja. Son funciones puras, así que aquí sí van tests unitarios.

**Files:**
- Create: `apps/web/src/app/features/bank/folders/folder-path.ts`
- Test: `apps/web/src/app/features/bank/folders/folder-path.spec.ts`

**Interfaces:**
- Consumes: `FolderTreeNode` de `apps/web/src/app/ui/folder-tree/folder-tree.types.ts`.
- Produces:
  - `findFolderPath(tree: readonly FolderTreeNode[], folderId: string | null): readonly FolderTreeNode[]` — la cadena desde la raíz hasta `folderId` inclusive; `[]` si es `null` o no existe.
  - `childrenOf(tree: readonly FolderTreeNode[], folderId: string | null): readonly FolderTreeNode[]` — los nodos raíz cuando `folderId` es `null`, los hijos del nodo si existe, `[]` si no existe.
  - `isLeafFolder(tree: readonly FolderTreeNode[], folderId: string | null): boolean` — `true` solo cuando el nodo existe y no tiene hijos.

- [ ] **Step 1: Escribir el test rojo**

```ts
import { describe, it, expect } from 'vitest';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';
import { childrenOf, findFolderPath, isLeafFolder } from './folder-path';

function node(id: string, name: string, children: FolderTreeNode[] = []): FolderTreeNode {
  return {
    id,
    name,
    topicId: null,
    ownCount: 0,
    centralCount: 0,
    totalCount: 0,
    editable: true,
    children,
  };
}

const TREE: FolderTreeNode[] = [
  node('colegio', 'Colegio', [node('mate', 'Matemática', [node('cuad', 'Ecuaciones cuadráticas')])]),
  node('preuni', 'Preuniversitario'),
];

describe('folder-path', () => {
  it('walks the chain from the root down to the asked folder', () => {
    expect(findFolderPath(TREE, 'cuad').map((n) => n.name)).toEqual([
      'Colegio',
      'Matemática',
      'Ecuaciones cuadráticas',
    ]);
  });

  it('returns an empty path at the root and for an unknown id', () => {
    expect(findFolderPath(TREE, null)).toEqual([]);
    expect(findFolderPath(TREE, 'no-existe')).toEqual([]);
  });

  it('lists the root nodes at the root and the children below it', () => {
    expect(childrenOf(TREE, null).map((n) => n.id)).toEqual(['colegio', 'preuni']);
    expect(childrenOf(TREE, 'colegio').map((n) => n.id)).toEqual(['mate']);
    expect(childrenOf(TREE, 'no-existe')).toEqual([]);
  });

  it('calls a folder a leaf only when it exists and has no children', () => {
    expect(isLeafFolder(TREE, 'cuad')).toBe(true);
    expect(isLeafFolder(TREE, 'mate')).toBe(false);
    expect(isLeafFolder(TREE, null)).toBe(false);
    expect(isLeafFolder(TREE, 'no-existe')).toBe(false);
  });
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `cd apps/web && NG_CLI_ANALYTICS=false pnpm exec ng test --no-watch --include='**/folders/folder-path.spec.ts'`
Expected: FAIL — `./folder-path` no existe.

- [ ] **Step 3: Implementar lo mínimo**

```ts
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';

/** La cadena raíz -> `folderId`, inclusive. Vacía en la raíz o si no existe. */
export function findFolderPath(
  tree: readonly FolderTreeNode[],
  folderId: string | null,
): readonly FolderTreeNode[] {
  if (folderId === null) return [];

  const walk = (nodes: readonly FolderTreeNode[]): FolderTreeNode[] | null => {
    for (const node of nodes) {
      if (node.id === folderId) return [node];
      const below = walk(node.children);
      if (below) return [node, ...below];
    }
    return null;
  };

  return walk(tree) ?? [];
}

function findNode(
  tree: readonly FolderTreeNode[],
  folderId: string,
): FolderTreeNode | null {
  const path = findFolderPath(tree, folderId);
  return path.length > 0 ? path[path.length - 1] : null;
}

/** Lo que el grid pinta: los nodos raíz, o los hijos de `folderId`. */
export function childrenOf(
  tree: readonly FolderTreeNode[],
  folderId: string | null,
): readonly FolderTreeNode[] {
  if (folderId === null) return tree;
  return findNode(tree, folderId)?.children ?? [];
}

/** Hoja = existe y no tiene hijos. La raíz nunca es hoja. */
export function isLeafFolder(
  tree: readonly FolderTreeNode[],
  folderId: string | null,
): boolean {
  if (folderId === null) return false;
  const node = findNode(tree, folderId);
  return node !== null && node.children.length === 0;
}
```

- [ ] **Step 4: Correrlo y verlo pasar**

Run: el mismo comando del paso 2.
Expected: PASS, 4 de 4.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/bank/folders/folder-path.ts apps/web/src/app/features/bank/folders/folder-path.spec.ts
git commit -m "feat(web): add pure helpers to walk the bank folder tree"
```

---

### Task 3: Tarjeta de carpeta `bank-folder-card`

La pieza visual del grid. Presentacional pura: recibe un nodo, pinta glifo, nombre, hijos y contadores, y emite al abrirse.

**Files:**
- Create: `apps/web/src/app/features/bank/bank-browser/bank-folder-card.component.ts`
- Test: `apps/web/src/app/features/bank/bank-browser/bank-folder-card.component.spec.ts`

**Interfaces:**
- Consumes: `FolderTreeNode`.
- Produces: `BankFolderCardComponent`, selector `bank-folder-card`, `input.required<FolderTreeNode>('node')` y `output<string>('open')` con el id. El output se llama `open`, no `select`, porque `select` es un evento nativo del DOM.

- [ ] **Step 1: Escribir el test rojo**

```ts
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';
import { BankFolderCardComponent } from './bank-folder-card.component';

const NODE: FolderTreeNode = {
  id: 'mate',
  name: 'Matemática',
  topicId: 't1',
  ownCount: 142,
  centralCount: 1208,
  totalCount: 1350,
  editable: true,
  children: [
    {
      id: 'cuad',
      name: 'Ecuaciones cuadráticas',
      topicId: 't2',
      ownCount: 0,
      centralCount: 0,
      totalCount: 0,
      editable: true,
      children: [],
    },
  ],
};

function setup(node: FolderTreeNode = NODE) {
  TestBed.configureTestingModule({ imports: [BankFolderCardComponent] });
  const fixture = TestBed.createComponent(BankFolderCardComponent);
  fixture.componentRef.setInput('node', node);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('BankFolderCardComponent', () => {
  it('shows the name, how many folders are inside and both counts', () => {
    const { compiled } = setup();

    expect(compiled.textContent).toContain('Matemática');
    expect(compiled.querySelector('[data-testid="card-children"]')!.textContent).toContain('1 tema');
    expect(compiled.querySelector('[data-testid="card-own"]')!.textContent).toContain('142');
    expect(compiled.querySelector('[data-testid="card-central"]')!.textContent).toContain('1208');
  });

  it('hides the central count when the folder has none', () => {
    const { compiled } = setup({ ...NODE, centralCount: 0 });

    expect(compiled.querySelector('[data-testid="card-central"]')).toBeFalsy();
  });

  it('emits open with the folder id when the card is activated', () => {
    const { fixture, compiled } = setup();
    const seen: string[] = [];
    fixture.componentInstance.open.subscribe((id) => seen.push(id));

    compiled.querySelector<HTMLButtonElement>('[data-testid="folder-card"]')!.click();

    expect(seen).toEqual(['mate']);
  });
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `cd apps/web && NG_CLI_ANALYTICS=false pnpm exec ng test --no-watch --include='**/bank-browser/bank-folder-card.component.spec.ts'`
Expected: FAIL — el componente no existe.

- [ ] **Step 3: Implementar lo mínimo**

```ts
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BookOpen, LucideAngularModule } from 'lucide-angular';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';

/**
 * Una carpeta del banco como tarjeta. Presentacional: no lee el store ni
 * navega, solo emite `open`. El output NO se llama `select` — Angular no
 * permite nombrar un output como un evento nativo del DOM.
 */
@Component({
  selector: 'bank-folder-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [LucideAngularModule.pick({ BookOpen }).providers ?? []],
  template: `
    <button
      type="button"
      data-testid="folder-card"
      class="flex w-full flex-col gap-3 rounded-card border border-n200 bg-surface p-4 text-left transition-colors hover:border-primary-300 hover:bg-primary-50"
      (click)="open.emit(node().id)"
    >
      <span
        class="flex h-10 w-10 items-center justify-center rounded-field bg-primary-50 text-tint-text"
      >
        <lucide-angular name="book-open" class="h-5 w-5"></lucide-angular>
      </span>

      <span class="flex flex-col gap-0.5">
        <span class="text-[15px] font-semibold text-n900">{{ node().name }}</span>
        <span data-testid="card-children" class="text-[13px] text-n600">{{ childrenLabel() }}</span>
      </span>

      <span class="flex items-center gap-1.5 border-t border-n100 pt-2.5 text-xs text-n600">
        <span data-testid="card-own"
          ><span class="font-semibold text-n700">{{ node().ownCount }}</span> propias</span
        >
        @if (node().centralCount > 0) {
          <span class="text-n300">·</span>
          <span data-testid="card-central"
            ><span class="font-semibold text-n700">{{ node().centralCount }}</span> del banco</span
          >
        }
      </span>
    </button>
  `,
})
export class BankFolderCardComponent {
  readonly node = input.required<FolderTreeNode>();
  readonly open = output<string>();

  protected readonly childrenLabel = computed(() => {
    const count = this.node().children.length;
    if (count === 0) return 'Sin subcarpetas';
    return count === 1 ? '1 tema' : `${count} temas`;
  });
}
```

- [ ] **Step 4: Correrlo y verlo pasar**

Run: el mismo comando del paso 2.
Expected: PASS, 3 de 3.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/bank/bank-browser
git commit -m "feat(web): add the folder card the bank grid is built from"
```

---

### Task 4: Pantalla `bank-browser` con grid y breadcrumb

El componente de ruta. Lee el árbol del store, la carpeta actual del query param `carpeta`, y pinta grid o redirige a la lista cuando la carpeta es hoja.

**Files:**
- Create: `apps/web/src/app/features/bank/bank-browser/bank-browser.component.ts`
- Test: `apps/web/src/app/features/bank/bank-browser/bank-browser.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts` — la ruta `bank` carga `BankBrowserComponent`; `bank/carpeta/:folderId` carga `BankListComponent`.

**Interfaces:**
- Consumes: `BankFoldersStore` (`tree`, `loading`, `error`, `load()`), `findFolderPath`, `childrenOf`, `isLeafFolder`, `BankFolderCardComponent`, `BreadcrumbComponent`.
- Produces: `BankBrowserComponent`, ruta `/app/bank`, estado en el query param `carpeta`.

- [ ] **Step 1: Escribir el test rojo**

```ts
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { BankBrowserComponent } from './bank-browser.component';

const FOLDERS = [
  {
    id: 'colegio',
    name: 'Colegio',
    parentId: null,
    topicId: null,
    position: 0,
    ownCount: 0,
    centralCount: 0,
    children: [
      {
        id: 'mate',
        name: 'Matemática',
        parentId: 'colegio',
        topicId: 't1',
        position: 0,
        ownCount: 142,
        centralCount: 1208,
        children: [],
      },
    ],
  },
];

async function setup(url = '/bank') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: 'bank', component: BankBrowserComponent }]),
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  const http = TestBed.inject(HttpTestingController);
  http.expectOne((r) => r.url.endsWith('/bank/folders')).flush({
    folders: FOLDERS,
    unfiledCount: 0,
  });
  harness.detectChanges();
  return { harness, compiled: harness.routeNativeElement as HTMLElement };
}

describe('BankBrowserComponent', () => {
  it('shows the root folders as cards', async () => {
    const { compiled } = await setup();

    const cards = compiled.querySelectorAll('[data-testid="folder-card"]');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Colegio');
  });

  it('drills into a folder and shows its children with a breadcrumb', async () => {
    const { harness, compiled } = await setup();

    compiled.querySelector<HTMLButtonElement>('[data-testid="folder-card"]')!.click();
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();

    const el = harness.routeNativeElement as HTMLElement;
    expect(el.textContent).toContain('Matemática');
    const crumbs = el.querySelectorAll('[data-testid="breadcrumb-crumb"]');
    expect(crumbs[crumbs.length - 1].textContent).toContain('Colegio');
  });
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `cd apps/web && NG_CLI_ANALYTICS=false pnpm exec ng test --no-watch --include='**/bank-browser/bank-browser.component.spec.ts'`
Expected: FAIL — el componente no existe.

- [ ] **Step 3: Implementar lo mínimo**

```ts
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { BreadcrumbComponent, BreadcrumbCrumb } from '../../../ui/breadcrumb/breadcrumb.component';
import { BankFoldersStore } from '../folders/bank-folders.store';
import { childrenOf, findFolderPath, isLeafFolder } from '../folders/folder-path';
import { BankFolderCardComponent } from './bank-folder-card.component';

const ROOT_CRUMB_ID = '__root__';

/**
 * El banco navegado como un Drive. La carpeta actual vive en el query param
 * `carpeta` y no en un signal interno: así el enlace se comparte, el botón
 * atrás funciona y un refresco cae donde estabas.
 */
@Component({
  selector: 'app-bank-browser',
  standalone: true,
  imports: [BankFolderCardComponent, BreadcrumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-5 p-6" data-testid="bank-browser">
      <ui-breadcrumb [items]="crumbs()" (navigate)="openCrumb($event)"></ui-breadcrumb>

      <h2 class="text-xl font-bold text-n900">{{ heading() }}</h2>

      @if (store.loading()) {
        <p data-testid="browser-loading" class="text-sm text-n600">Cargando carpetas…</p>
      } @else if (store.error()) {
        <p data-testid="browser-error" role="alert" class="text-sm text-hard-text">
          {{ store.error() }}
        </p>
      } @else if (children().length === 0) {
        <p data-testid="browser-empty" class="text-sm text-n600">
          Esta carpeta todavía no tiene subcarpetas.
        </p>
      } @else {
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          @for (node of children(); track node.id) {
            <bank-folder-card [node]="node" (open)="openFolder($event)"></bank-folder-card>
          }
        </div>
      }
    </div>
  `,
})
export class BankBrowserComponent {
  protected readonly store = inject(BankFoldersStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly folderId = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('carpeta'))),
    { initialValue: null },
  );

  protected readonly children = computed(() => childrenOf(this.store.tree(), this.folderId()));

  private readonly path = computed(() => findFolderPath(this.store.tree(), this.folderId()));

  protected readonly crumbs = computed<readonly BreadcrumbCrumb[]>(() => [
    { id: ROOT_CRUMB_ID, label: 'Mi banco' },
    ...this.path().map((node) => ({ id: node.id, label: node.name })),
  ]);

  protected readonly heading = computed(() => {
    const path = this.path();
    return path.length === 0 ? 'Mi banco' : path[path.length - 1].name;
  });

  constructor() {
    this.store.load();
  }

  protected openFolder(id: string): void {
    if (isLeafFolder(this.store.tree(), id)) {
      void this.router.navigate(['/app/bank/carpeta', id]);
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { carpeta: id },
    });
  }

  protected openCrumb(id: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { carpeta: id === ROOT_CRUMB_ID ? null : id },
    });
  }
}
```

Y en `app.routes.ts`, la ruta `bank` pasa a cargar `BankBrowserComponent` y se añade `bank/carpeta/:folderId` apuntando a `BankListComponent`:

```ts
      {
        path: 'bank',
        loadComponent: () =>
          import('./features/bank/bank-browser/bank-browser.component').then(
            (m) => m.BankBrowserComponent,
          ),
        title: `Banco de preguntas${TITLE_SUFFIX}`,
      },
      {
        path: 'bank/carpeta/:folderId',
        loadComponent: () =>
          import('./features/bank/bank-list/bank-list.component').then((m) => m.BankListComponent),
        title: `Banco de preguntas${TITLE_SUFFIX}`,
      },
```

- [ ] **Step 4: Correrlo y verlo pasar**

Run: el comando del paso 2, y además `NG_CLI_ANALYTICS=false pnpm exec ng test --no-watch --include='**/app.routes.spec.ts'`
Expected: PASS en ambos.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/bank/bank-browser apps/web/src/app/app.routes.ts
git commit -m "feat(web): browse the question bank as a grid of folder cards"
```

---

### Task 5: `bank-list` se abre en la carpeta de la ruta y muestra el breadcrumb

Hoy `bank-list` arranca sin carpeta seleccionada y espera un clic en el árbol. Con la ruta nueva ya llega con una carpeta, así que debe cargarla sola y pintar la ruta de migas para poder volver.

**Files:**
- Modify: `apps/web/src/app/features/bank/bank-list/bank-list.component.ts`
- Modify: `apps/web/src/app/features/bank/bank-list/bank-list.component.html:1`
- Test: `apps/web/src/app/features/bank/bank-list/bank-list.component.spec.ts`

**Interfaces:**
- Consumes: el param de ruta `folderId`, `findFolderPath`, `BreadcrumbComponent`.
- Produces: nada nuevo hacia fuera.

- [ ] **Step 1: Escribir el test rojo**

Añadir al final del `describe('BankListComponent', ...)` existente:

```ts
  it('loads the folder named in the route without waiting for a click on the tree', async () => {
    const { compiled } = await setupAtFolder('mate');

    expect(compiled.querySelector('[data-testid="no-folder-selected"]')).toBeFalsy();
    expect(compiled.querySelector('[data-testid="folder-questions"]')).toBeTruthy();
  });

  it('shows the path back to the grid as breadcrumbs', async () => {
    const { compiled } = await setupAtFolder('mate');

    const crumbs = compiled.querySelectorAll('[data-testid="breadcrumb-crumb"]');
    expect(crumbs.length).toBeGreaterThan(1);
    expect(crumbs[0].textContent).toContain('Mi banco');
  });
```

Con un helper `setupAtFolder(folderId)` junto al `setup()` que ya existe, que monta el componente con `provideRouter` y `RouterTestingHarness.create('/bank/carpeta/' + folderId)` y hace flush de `/bank/folders` con el mismo `FOLDERS` del fichero.

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `cd apps/web && NG_CLI_ANALYTICS=false pnpm exec ng test --no-watch --include='**/bank-list/bank-list.component.spec.ts'`
Expected: FAIL — sigue pintando `no-folder-selected` y no hay ningún `breadcrumb-crumb`.

- [ ] **Step 3: Implementar lo mínimo**

En el `.ts`: leer el param, sembrar `selectedFolderId` y exponer los crumbs.

```ts
  private readonly routeFolderId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('folderId'))),
    { initialValue: null },
  );

  protected readonly crumbs = computed<readonly BreadcrumbCrumb[]>(() => [
    { id: '__root__', label: 'Mi banco' },
    ...findFolderPath(this.foldersStore.tree(), this.selectedFolderId()).map((node) => ({
      id: node.id,
      label: node.name,
    })),
  ]);
```

y en el constructor, un `effect` que copie `routeFolderId()` a `selectedFolderId` y dispare la carga de preguntas por la misma vía que hoy usa el clic del árbol.

En el `.html`, justo dentro del contenedor raíz:

```html
  <ui-breadcrumb [items]="crumbs()" (navigate)="backToGrid($event)"></ui-breadcrumb>
```

con `backToGrid(id)` navegando a `/app/bank` con `carpeta` puesto a `null` para la raíz o al id en cualquier otro caso.

- [ ] **Step 4: Correrlo y verlo pasar**

Run: el comando del paso 2.
Expected: PASS, los 139 existentes más los 2 nuevos.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/bank/bank-list
git commit -m "feat(web): open the bank list on the folder in the route, with breadcrumbs"
```

---

### Task 6: Typecheck y pasada manual en el navegador

- [ ] **Step 1: Typecheck de la web**

Run: `cd apps/web && pnpm exec tsc --noEmit -p tsconfig.typecheck.json`
Expected: sin salida.

- [ ] **Step 2: Correr solo los specs tocados**

Run: `cd apps/web && NG_CLI_ANALYTICS=false pnpm exec ng test --no-watch --include='**/{breadcrumb,bank-browser,bank-list,folders}/**/*.spec.ts'`
Expected: todo verde; anotar los conteos.

- [ ] **Step 3: Recorrido manual**

Levantar la web y comprobar, en este orden: `/app/bank` muestra el grid de carpetas raíz; un clic entra y el breadcrumb crece; un clic en una hoja lleva a la lista de preguntas con su panel; el breadcrumb devuelve al grid en el nivel correcto; el botón atrás del navegador deshace cada paso.

- [ ] **Step 4: Commit de lo que el recorrido encuentre**

```bash
git commit -m "fix(web): <lo que el recorrido manual encontró>"
```
