# Frontend Angular — Screens restantes (rediseño UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los steps usan checkboxes (`- [ ]`) para tracking.

**Goal:** Construir los 6 screens del spec `docs/superpowers/specs/2026-07-18-ui-redesign-screens-design.md` (Banco lista+panel, Historial "Mis exámenes", IA Taller, Cola de revisión, Config colegio, Login/Shell) más los fixes obligatorios de shell (401, logout, roleGuard, nav) sobre el frontend Angular (`apps/web`), rama `feat/ui-redesign`. Hereda la identidad visual del doc base (§3). Consume los endpoints backend S1–S9 (implementados en paralelo).

**Architecture:** Angular 22 standalone components, signals, `ChangeDetectionStrategy.OnPush`. Atomic + container/presentational. Los screens REUSAN los primitivos existentes en `apps/web/src/app/ui/*` (button, input, select, card, table, tag, modal, empty-state, sidebar, topbar, banner, progress). Servicios por feature en `features/<x>/<x>.service.ts` con `HttpClient` y URLs `${environment.apiBaseUrl}/...` (`apiBaseUrl = '/api'`). Auth vía `authInterceptor`. Íconos vía `lucide-angular` (ya instalado, sin registrar).

**Tech Stack:** Angular 22, Tailwind v4 CSS-first (tokens de marca en `styles.scss`), RxJS, `lucide-angular@1.0.0`, Vitest + `@angular/core/testing` TestBed (`describe/it/expect/vi`). Runner: `pnpm --filter @exams-generator/web test`.

## Global Constraints

- **Strict TDD (test-first):** escribe el test, córrelo, VELO FALLAR con la salida esperada, implementa el mínimo, VELO PASAR, commit. Sin excepciones. Runner base: `pnpm --filter @exams-generator/web test`. Para un archivo: `pnpm --filter @exams-generator/web test -- <ruta-o-nombre>`.
- **Commits convencionales**, SIN `Co-Authored-By` ni atribución AI. Un commit por step "verde".
- **Copy en español (Perú), tono de colegio, CERO jerga técnica.** Nada de "blueprint", "reroll", "draft" en la UI (en código sí). Nivel = fácil/media/difícil.
- **Sin emojis en la UI.** Todo ícono sale de `lucide-angular` (`<lucide-angular name="...">`). Mapa canónico del spec (§Iconografía).
- **Sin gradientes.** Rellenos sólidos. Radios `rounded-field` (8px) / `rounded-card` (12px). Color con moderación: neutro/blanco domina, `primary-500` solo en acción principal y nav activo.
- **Reusar primitivos `ui-*`.** Prohibido re-estilar ad-hoc lo que un primitivo ya resuelve. Clases Tailwind SOLO con tokens existentes (`bg-primary-500`, `text-tint-texto`, `bg-easy-bg`, `text-hard-text`, `bg-n50`, `border-n200`, `bg-ai-bg`, etc. — ver `styles.scss`).
- **NO tocar `features/exams/exam-builder/**`** (lo implementa otro agente). `app.routes.ts` y `features/shell/shell.component.*` son COMPARTIDOS: toda tarea que los edite hace un commit atómico mínimo (solo esa edición), y hace `git pull --rebase origin feat/ui-redesign` ANTES de cada commit.
- **Rama compartida `feat/ui-redesign`:** `git pull --rebase` antes de cada commit; resolver conflictos de `app.routes.ts`/`shell` a favor de fusionar ambos aportes.

## Contratos backend consumidos (de `docs/superpowers/plans/2026-07-18-screens-backend-s1-s9.md`)

| ID  | Endpoint                                                                                       | Shape                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| S1  | `GET /exams?status=&gradeLevel=&search=&page=&pageSize=`                                       | `{ items: ExamListItem[], total }`, `ExamListItem = { id, title, gradeLevel, status, questionCount, versionCount, createdAt }` |
| S2  | `POST /exams/:id/duplicate`                                                                    | `201 { id, title, status: "draft" }`                                                                                           |
| S3  | `DELETE /exams/:id`                                                                            | `204`                                                                                                                          |
| S4  | `PATCH /bank/questions/:id/archive`                                                            | `200 { id, status: "archived" }`                                                                                               |
| S5  | `DELETE /bank/questions/:id`                                                                   | `204`                                                                                                                          |
| S6  | `GET /bank/questions` sin `page` → array (legacy); con `?page=&pageSize=` → `{ items, total }` |
| S7  | `GET /bank/questions/:id/preview`                                                              | `200` `application/pdf` (una pregunta)                                                                                         |
| S8  | `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/reset-password`                        | ver Task 11                                                                                                                    |

## Huecos del spec detectados (verificados contra el código) — leer antes de empezar

1. **`lucide-angular@1.0.0` YA está instalado** (`apps/web/package.json` lo declara y está en `node_modules/.pnpm`). El brief decía "no instalado": FALSO. Task 1 solo lo REGISTRA y cablea íconos; no reinstala.
2. **`more-horizontal` NO existe en lucide v1** — se renombró a `ellipsis`. El mapa del spec usa `more-horizontal`; usamos `ellipsis` (export `Ellipsis`). Igual `check`→`Check`, `triangle-alert`→`TriangleAlert` sí existen.
3. **El modelo web `BankQuestion` NO tiene `status`, `type` ni origen** (`bank.models.ts` solo trae `id, tenantId, courseId, topicId, difficulty, gradeLevel, correctAnswer, imageAssetId`). El panel del Banco necesita `status` (para gating archivar/borrar), `type` (image/structured) y origen (Colegio/IA/Banco central). **Task 5 extiende el modelo web** con `status?`, `type?`, `origin?`, `usedInExamCount?`. Origen se deriva: `tenantId===null` → `central` (solo lectura); si no, `school`. **GAP backend:** distinguir origen **IA** requiere que el backend devuelva un campo `origin`/`source` en `GET /bank/questions` — hoy no lo hace; hasta entonces las preguntas IA se muestran como "Colegio". Igual, para que archivar/borrar cableen contra datos reales el backend debe incluir `status` y `type` en el list/detail. Los tests mockean el service, así que el plan es implementable; la integración real queda flagged para el agente backend.
4. **El token JWT (`DecodedAccessToken`) no trae email ni nombre** (solo `sub, role, tenantId`). El spec pide "iniciales" en el menú de usuario del topbar. **GAP:** sin email/nombre no hay iniciales; Task 2 usa un ícono `user` de lucide + "Cerrar sesión", y flagea que las iniciales necesitan email en el token o un `GET /users/me`.
5. **`GET /bank/questions/:id/preview` (S7)** entrega PDF; el navegador lo embebe con `<iframe>`/`<embed>` vía `blob:` object URL (mismo patrón autenticado de `fetchQuestionImage`).
6. Rutas actuales: `/app/exams`→`ExamBuilderComponent`, `/app/exams/:examId`→`ExamReviewComponent`, `.../versions`→`ExamVersionsPanelComponent`. Task 3 reestructura: `/app/exams`→lista nueva, `/app/exams/new`→builder (movido), `:examId`→review (sin cambio), `:examId/versions`→panel de formas (enriquecido en Task 8).

## Registro de íconos lucide (fijado — Task 1 lo aplica una vez)

`app.config.ts` registra vía `importProvidersFrom(LucideAngularModule.pick({ ... }))`. Set canónico usado por todo el plan (PascalCase export → `name` kebab en template):

`Menu`("menu") · `X`("x") · `Sparkles`("sparkles") · `Lock`("lock") · `Download`("download") · `Ellipsis`("ellipsis") · `Check`("check") · `TriangleAlert`("triangle-alert") · `Search`("search") · `School`("school") · `LogOut`("log-out") · `User`("user") · `Users`("users") · `Trash2`("trash-2") · `Pencil`("pencil") · `Archive`("archive") · `ChevronLeft`("chevron-left") · `ChevronRight`("chevron-right") · `ChevronDown`("chevron-down") · `Plus`("plus") · `Minus`("minus").

Cada componente que muestre un ícono agrega `LucideAngularModule` a su `imports`. Cada `.spec.ts` que renderice un ícono agrega `importProvidersFrom(LucideAngularModule.pick({ ...los que use... }))` a los `providers` del TestBed.

---

## Task 1 — Registrar lucide + reemplazar emojis placeholder en primitivos

**Files:**

- Modify: `apps/web/src/app/app.config.ts`
- Modify: `apps/web/src/app/ui/topbar/topbar.component.ts` (emoji `☰` → ícono)
- Modify: `apps/web/src/app/ui/banner/banner.component.ts` (emoji `✕` → ícono)
- Test: `apps/web/src/app/ui/topbar/topbar.component.spec.ts` (modificar)
- Test: `apps/web/src/app/ui/banner/banner.component.spec.ts` (modificar)

**Interfaces:**

- Consumes: `LucideAngularModule.pick`, `LUCIDE_ICONS` token (de `lucide-angular`).
- Produces: íconos disponibles globalmente vía `<lucide-angular name="...">`; topbar/banner sin emojis. Todas las tareas siguientes dependen de este registro.

- [ ] **Step 1: Test que falla** — en `topbar.component.spec.ts`, reemplaza el assert del botón de menú por uno que exija un ícono lucide (no el emoji). Provee los íconos en el TestBed:

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect } from "vitest";
import { importProvidersFrom } from "@angular/core";
import { LucideAngularModule, Menu } from "lucide-angular";
import { TopbarComponent } from "./topbar.component";

describe("TopbarComponent", () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [TopbarComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ Menu }))],
    });
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.detectChanges();
    return { fixture, compiled: fixture.nativeElement as HTMLElement };
  }

  it("renders a lucide menu icon (no emoji) inside the menu button", () => {
    const { compiled } = setup();
    const button = compiled.querySelector('[data-testid="topbar-menu-button"]')!;
    expect(button.querySelector("lucide-angular,i-lucide")).toBeTruthy();
    expect(button.textContent).not.toContain("☰");
  });
});
```

En `banner.component.spec.ts` agrega los providers `importProvidersFrom(LucideAngularModule.pick({ X }))` al TestBed existente y añade:

```ts
it("renders a lucide x icon (no emoji) in the dismiss button", () => {
  const { compiled } = setup({ dismissible: true }); // usa el helper existente del spec
  const close = compiled.querySelector('[data-testid="banner-close"]')!;
  expect(close.querySelector("lucide-angular,i-lucide")).toBeTruthy();
  expect(close.textContent).not.toContain("✕");
});
```

- [ ] **Step 2: Verlo fallar** — `pnpm --filter @exams-generator/web test -- topbar.component` → FAIL (no existe `lucide-angular`/`i-lucide`; el botón aún tiene `☰`). Igual `banner.component` → FAIL.

- [ ] **Step 3: Implementación**

`app.config.ts`:

```ts
import {
  ApplicationConfig,
  importProvidersFrom,
  provideBrowserGlobalErrorListeners,
} from "@angular/core";
import { provideRouter } from "@angular/router";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import {
  LucideAngularModule,
  Menu,
  X,
  Sparkles,
  Lock,
  Download,
  Ellipsis,
  Check,
  TriangleAlert,
  Search,
  School,
  LogOut,
  User,
  Users,
  Trash2,
  Pencil,
  Archive,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Minus,
} from "lucide-angular";
import { routes } from "./app.routes";
import { authInterceptor } from "./core/auth/auth.interceptor";

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    importProvidersFrom(
      LucideAngularModule.pick({
        Menu,
        X,
        Sparkles,
        Lock,
        Download,
        Ellipsis,
        Check,
        TriangleAlert,
        Search,
        School,
        LogOut,
        User,
        Users,
        Trash2,
        Pencil,
        Archive,
        ChevronLeft,
        ChevronRight,
        ChevronDown,
        Plus,
        Minus,
      }),
    ),
  ],
};
```

`topbar.component.ts` — agrega `LucideAngularModule` a `imports` y en el template reemplaza el `☰` por `<lucide-angular name="menu" class="h-5 w-5"></lucide-angular>`. Diff mínimo del template (mantén `data-testid="topbar-menu-button"` y `(click)="menuToggle.emit()"`):

```ts
import { LucideAngularModule } from "lucide-angular";
// @Component imports: [LucideAngularModule, ...lo que ya tenga]
// template: dentro del <button data-testid="topbar-menu-button">:
//   <lucide-angular name="menu" class="h-5 w-5"></lucide-angular>
```

`banner.component.ts` — agrega `LucideAngularModule` a `imports`; en el `<button data-testid="banner-close">` reemplaza `✕` por `<lucide-angular name="x" class="h-4 w-4"></lucide-angular>`.

- [ ] **Step 4: Verde** — `pnpm --filter @exams-generator/web test -- topbar.component banner.component` → PASS.
- [ ] **Step 5: Commit**

```bash
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/app.config.ts apps/web/src/app/ui/topbar apps/web/src/app/ui/banner
git commit -m "feat(web): registrar lucide-angular y reemplazar emojis de topbar/banner por iconos"
```

---

## Task 2 — Manejo de 401 en interceptor + logout en topbar/shell

**Files:**

- Create: `apps/web/src/app/core/auth/auth-error.interceptor.ts`
- Create: `apps/web/src/app/core/auth/auth-error.interceptor.spec.ts`
- Modify: `apps/web/src/app/app.config.ts` (registrar el interceptor)
- Modify: `apps/web/src/app/features/shell/shell.component.ts` + `.html` (menú de usuario + logout + título = colegio) — COMPARTIDO, commit atómico
- Modify: `apps/web/src/app/features/shell/shell.component.spec.ts`
- Modify: `apps/web/src/app/features/login/login.component.ts` + `.html` (leer query param de sesión expirada) — se completa en Task 4; aquí solo el mensaje

**Interfaces:**

- Consumes: `AuthService.logout()`, `AuthService.getToken()`, `Router`, `TenantSettingsService.getSettings()`.
- Produces: 401 en cualquier request → `logout()` + redirect `/login?expired=1`. Topbar con menú de usuario (ícono `user`) → "Cerrar sesión". Título del topbar = nombre del colegio.

- [ ] **Step 1: Test que falla (interceptor)** — `auth-error.interceptor.spec.ts`:

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpClient, provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { Router } from "@angular/router";
import { authErrorInterceptor } from "./auth-error.interceptor";
import { AuthService } from "./auth.service";

describe("authErrorInterceptor", () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  const logout = vi.fn();
  const navigateByUrl = vi.fn();

  beforeEach(() => {
    logout.mockClear();
    navigateByUrl.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { logout } },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it("on 401 clears session and redirects to /login?expired=1", () => {
    http.get("/api/anything").subscribe({ next: () => {}, error: () => {} });
    httpMock.expectOne("/api/anything").flush("nope", { status: 401, statusText: "Unauthorized" });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith("/login?expired=1");
  });

  it("does NOT log out on the login request itself (avoids loop on bad credentials)", () => {
    http.post("/api/auth/login", {}).subscribe({ next: () => {}, error: () => {} });
    httpMock.expectOne("/api/auth/login").flush("bad", { status: 401, statusText: "Unauthorized" });
    expect(logout).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it("passes through non-401 errors untouched", () => {
    http.get("/api/x").subscribe({ next: () => {}, error: () => {} });
    httpMock.expectOne("/api/x").flush("boom", { status: 500, statusText: "Server Error" });
    expect(logout).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verlo fallar** — `pnpm --filter @exams-generator/web test -- auth-error.interceptor` → FAIL (módulo no existe).

- [ ] **Step 3: Implementación** — `auth-error.interceptor.ts`:

```ts
import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { Router } from "@angular/router";
import { catchError, throwError } from "rxjs";
import { AuthService } from "./auth.service";

/**
 * Sesión expirada: cualquier 401 (salvo el propio login) limpia la sesión y
 * manda a /login con la marca ?expired=1 para mostrar "Tu sesión expiró".
 */
export const authErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      const isLoginCall = req.url.includes("/auth/login");
      if (error instanceof HttpErrorResponse && error.status === 401 && !isLoginCall) {
        authService.logout();
        router.navigateByUrl("/login?expired=1");
      }
      return throwError(() => error);
    }),
  );
};
```

`app.config.ts` — agrega `authErrorInterceptor` DESPUÉS de `authInterceptor`:

```ts
provideHttpClient(withInterceptors([authInterceptor, authErrorInterceptor])),
```

(y su import). Deja el `importProvidersFrom(LucideAngularModule.pick(...))` de Task 1 intacto.

- [ ] **Step 4: Verde interceptor** — `pnpm --filter @exams-generator/web test -- auth-error.interceptor` → PASS.

- [ ] **Step 5: Test que falla (shell)** — reescribe/añade en `shell.component.spec.ts`:

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { of } from "rxjs";
import { importProvidersFrom, signal } from "@angular/core";
import { provideRouter, Router } from "@angular/router";
import { LucideAngularModule, Menu, User, LogOut } from "lucide-angular";
import { Role } from "@exams-generator/shared";
import { ShellComponent } from "./shell.component";
import { AuthService } from "../../core/auth/auth.service";
import { TenantSettingsService } from "../../features/tenant-settings/tenant-settings.service";

function setup(role: Role | null) {
  const logout = vi.fn();
  const navigateByUrl = vi.fn();
  TestBed.configureTestingModule({
    imports: [ShellComponent],
    providers: [
      provideRouter([]),
      importProvidersFrom(LucideAngularModule.pick({ Menu, User, LogOut })),
      { provide: AuthService, useValue: { currentRole: signal(role), logout } },
      {
        provide: TenantSettingsService,
        useValue: {
          getSettings: () => of({ id: "t1", name: "Colegio San Marcos", logoAssetId: null }),
        },
      },
      {
        provide: Router,
        useValue: { navigateByUrl, createUrlTree: () => ({}), serializeUrl: () => "" },
      },
    ],
  });
  const fixture = TestBed.createComponent(ShellComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, logout, navigateByUrl };
}

describe("ShellComponent", () => {
  it("shows the school name as the topbar title", () => {
    const { compiled } = setup(Role.Teacher);
    expect(compiled.textContent).toContain("Colegio San Marcos");
  });

  it("logs out and redirects to /login from the user menu", () => {
    const { compiled, fixture, logout, navigateByUrl } = setup(Role.Teacher);
    (compiled.querySelector('[data-testid="user-menu-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="logout-button"]') as HTMLButtonElement).click();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith("/login");
  });
});
```

- [ ] **Step 6: Verlo fallar** — `pnpm --filter @exams-generator/web test -- shell.component` → FAIL (no hay user-menu ni título dinámico).

- [ ] **Step 7: Implementación shell** — `shell.component.ts` (mantén `navGroups`/mobile de la versión actual; añade menú de usuario y título de colegio):

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { Role } from "@exams-generator/shared";
import { LucideAngularModule } from "lucide-angular";
import { SidebarComponent } from "../../ui/sidebar/sidebar.component";
import { TopbarComponent } from "../../ui/topbar/topbar.component";
import { NavGroup } from "../../ui/ui.types";
import { AuthService } from "../../core/auth/auth.service";
import { TenantSettingsService } from "../tenant-settings/tenant-settings.service";

const PRINCIPAL_GROUP: NavGroup = {
  title: "Principal",
  items: [
    { label: "Banco de preguntas", route: "/app/bank" },
    { label: "Mis exámenes", route: "/app/exams" },
  ],
};
const INTELIGENCIA_GROUP: NavGroup = {
  title: "Inteligencia",
  items: [
    { label: "Generar con IA", route: "/app/ai/generate" },
    { label: "Cola de revisión", route: "/app/ai/review" },
  ],
};
const COLEGIO_GROUP: NavGroup = {
  title: "Colegio",
  items: [{ label: "Configuración", route: "/app/settings" }],
};

@Component({
  selector: "app-shell",
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, TopbarComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./shell.component.html",
})
export class ShellComponent {
  private readonly authService = inject(AuthService);
  private readonly tenantSettings = inject(TenantSettingsService);
  private readonly router = inject(Router);

  protected readonly mobileOpen = signal(false);
  protected readonly userMenuOpen = signal(false);
  protected readonly schoolName = signal("Exams Generator");

  protected readonly navGroups = computed<NavGroup[]>(() => {
    const groups: NavGroup[] = [PRINCIPAL_GROUP, INTELIGENCIA_GROUP];
    if (this.authService.currentRole() === Role.SchoolAdmin) {
      groups.push(COLEGIO_GROUP);
    }
    return groups;
  });

  constructor() {
    this.tenantSettings.getSettings().subscribe({
      next: (s) => this.schoolName.set(s.name),
      error: () => {},
    });
  }

  protected toggleMobileMenu(): void {
    this.mobileOpen.update((open) => !open);
  }
  protected closeMobileMenu(): void {
    this.mobileOpen.set(false);
  }
  protected toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }
  protected logout(): void {
    this.userMenuOpen.set(false);
    this.authService.logout();
    this.router.navigateByUrl("/login");
  }
}
```

`shell.component.html` — mantén el layout actual; cambia `title="Exams Generator"` por `[title]="schoolName()"` y proyecta el menú de usuario en el slot `[actions]` del topbar:

```html
<div class="flex h-screen bg-n50">
  <aside data-testid="shell-sidebar-desktop" class="hidden w-64 shrink-0 md:block">
    <ui-sidebar [groups]="navGroups()"></ui-sidebar>
  </aside>

  @if (mobileOpen()) {
  <div data-testid="shell-mobile-drawer" class="fixed inset-0 z-40 md:hidden">
    <div
      data-testid="shell-mobile-backdrop"
      class="absolute inset-0 bg-primary-900/40"
      (click)="closeMobileMenu()"
    ></div>
    <div class="relative h-full w-64"><ui-sidebar [groups]="navGroups()"></ui-sidebar></div>
  </div>
  }

  <div class="flex flex-1 flex-col overflow-hidden">
    <ui-topbar [title]="schoolName()" (menuToggle)="toggleMobileMenu()">
      <div actions class="relative">
        <button
          type="button"
          data-testid="user-menu-button"
          class="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-primary-700 hover:bg-primary-200"
          (click)="toggleUserMenu()"
          aria-label="Menú de usuario"
        >
          <lucide-angular name="user" class="h-5 w-5"></lucide-angular>
        </button>
        @if (userMenuOpen()) {
        <div
          class="absolute right-0 z-50 mt-2 w-48 rounded-card border border-n200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            data-testid="logout-button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-n800 hover:bg-n50"
            (click)="logout()"
          >
            <lucide-angular name="log-out" class="h-4 w-4"></lucide-angular>
            Cerrar sesión
          </button>
        </div>
        }
      </div>
    </ui-topbar>
    <main class="flex-1 overflow-auto p-4"><router-outlet></router-outlet></main>
  </div>
</div>
```

- [ ] **Step 8: Verde shell** — `pnpm --filter @exams-generator/web test -- shell.component` → PASS.
- [ ] **Step 9: Commits** (dos atómicos: interceptor no-compartido, shell compartido)

```bash
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/core/auth/auth-error.interceptor.ts apps/web/src/app/core/auth/auth-error.interceptor.spec.ts apps/web/src/app/app.config.ts
git commit -m "feat(web): interceptor de 401 que cierra sesion y redirige a login"
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/features/shell
git commit -m "feat(web): menu de usuario con logout y titulo de colegio en el shell"
```

---

## Task 3 — roleGuard cableado + reestructura de rutas + rename nav (COMPARTIDO, atómico)

**Files:**

- Modify: `apps/web/src/app/app.routes.ts` — COMPARTIDO
- Create: `apps/web/src/app/features/exams/exam-list/exam-list.component.ts` + `.html` + `.spec.ts` (stub que Task 7 completa)

**Interfaces:**

- Consumes: `roleGuard(...roles)` (`core/auth/role.guard.ts`), `authGuard`.
- Produces: árbol de rutas final: `/app/exams`→`ExamListComponent`, `/app/exams/new`→`ExamBuilderComponent`, `/app/exams/:examId`→`ExamReviewComponent`, `/app/exams/:examId/versions`→`ExamVersionsPanelComponent`, `/app/settings` con `canActivate: [roleGuard(Role.SchoolAdmin)]`. Task 7 rellena `ExamListComponent`.

> Nota: se crea `ExamListComponent` como stub mínimo AQUÍ solo para que la ruta compile; Task 7 lo reemplaza con la pantalla real (su spec vive en Task 7). Esto mantiene el commit de `app.routes.ts` atómico y verde.

- [ ] **Step 1: Test que falla (guard sobre settings)** — crea `apps/web/src/app/app.routes.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { routes } from "./app.routes";

function findRoute(path: string) {
  const app = routes.find((r) => r.path === "app");
  return app?.children?.find((c) => c.path === path);
}

describe("app.routes", () => {
  it("guards /app/settings with a role guard", () => {
    const settings = findRoute("settings");
    expect(settings?.canActivate?.length).toBeGreaterThan(0);
  });

  it("exposes /app/exams as the list index and /app/exams/new as the builder", () => {
    expect(findRoute("exams")).toBeTruthy();
    expect(findRoute("exams/new")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Verlo fallar** — `pnpm --filter @exams-generator/web test -- app.routes` → FAIL (`settings` sin guard, sin `exams/new`).

- [ ] **Step 3: Implementación** — `exam-list.component.ts` (stub):

```ts
import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
  selector: "app-exam-list",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="exam-list-root"></div>`,
})
export class ExamListComponent {}
```

`app.routes.ts`:

```ts
import { Routes } from "@angular/router";
import { Role } from "@exams-generator/shared";
import { authGuard } from "./core/auth/auth.guard";
import { roleGuard } from "./core/auth/role.guard";
import { LoginComponent } from "./features/login/login.component";
import { ShellComponent } from "./features/shell/shell.component";
import { ForbiddenComponent } from "./features/forbidden/forbidden.component";
import { BankListComponent } from "./features/bank/bank-list/bank-list.component";
import { BankUploadComponent } from "./features/bank/bank-upload/bank-upload.component";
import { ExamListComponent } from "./features/exams/exam-list/exam-list.component";
import { ExamVersionsPanelComponent } from "./features/exam-versions/exam-versions-panel/exam-versions-panel.component";
import { ExamBuilderComponent } from "./features/exams/exam-builder/exam-builder.component";
import { ExamReviewComponent } from "./features/exams/exam-review/exam-review.component";
import { AiGenerateComponent } from "./features/ai/ai-generate/ai-generate.component";
import { AiReviewQueueComponent } from "./features/ai/ai-review-queue/ai-review-queue.component";
import { TenantSettingsComponent } from "./features/tenant-settings/tenant-settings.component";

export const routes: Routes = [
  { path: "login", component: LoginComponent },
  { path: "forbidden", component: ForbiddenComponent },
  {
    path: "app",
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: "bank", component: BankListComponent },
      { path: "bank/upload", component: BankUploadComponent },
      { path: "exams", component: ExamListComponent },
      { path: "exams/new", component: ExamBuilderComponent },
      { path: "exams/:examId", component: ExamReviewComponent },
      { path: "exams/:examId/versions", component: ExamVersionsPanelComponent },
      { path: "ai/generate", component: AiGenerateComponent },
      { path: "ai/review", component: AiReviewQueueComponent },
      {
        path: "settings",
        component: TenantSettingsComponent,
        canActivate: [roleGuard(Role.SchoolAdmin)],
      },
    ],
  },
  { path: "", pathMatch: "full", redirectTo: "app" },
  { path: "**", redirectTo: "login" },
];
```

- [ ] **Step 4: Verde** — `pnpm --filter @exams-generator/web test -- app.routes exam-list` → PASS. Suite completa aún verde: `pnpm --filter @exams-generator/web test`.
- [ ] **Step 5: Commit** (COMPARTIDO — atómico)

```bash
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/app.routes.ts apps/web/src/app/app.routes.spec.ts apps/web/src/app/features/exams/exam-list
git commit -m "feat(web): cablear roleGuard en settings y reestructurar rutas de examenes (indice + new)"
```

---

## Task 4 — Login rediseñado (panel dividido + sesión expirada)

**Files:**

- Modify: `apps/web/src/app/features/login/login.component.ts`
- Modify: `apps/web/src/app/features/login/login.component.html`
- Modify: `apps/web/src/app/features/login/login.component.spec.ts`

**Interfaces:**

- Consumes: `AuthService.login`, `ActivatedRoute.snapshot.queryParamMap` (para `?expired=1`), primitivos `ui-input`/`ui-button`.
- Produces: layout de dos mitades (izquierda oscura con marca + promesa + mini-preview; derecha form claro). Muestra "Tu sesión expiró, vuelve a entrar" si `?expired=1`. Mantiene `data-testid="login-error"` y la lógica de validación existente.

- [ ] **Step 1: Test que falla** — reemplaza `login.component.spec.ts` (conserva los casos existentes de login OK/401/validación; añade sesión expirada y marca):

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { of, throwError } from "rxjs";
import { HttpErrorResponse } from "@angular/common/http";
import { ActivatedRoute, Router } from "@angular/router";
import { convertToParamMap } from "@angular/router";
import { LoginComponent } from "./login.component";
import { AuthService } from "../../core/auth/auth.service";

function setup(opts: { expired?: boolean; loginImpl?: (...a: unknown[]) => unknown } = {}) {
  const login = vi.fn(opts.loginImpl ?? (() => of({ accessToken: "jwt" })));
  const navigateByUrl = vi.fn();
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      { provide: AuthService, useValue: { login } },
      { provide: Router, useValue: { navigateByUrl } },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { queryParamMap: convertToParamMap(opts.expired ? { expired: "1" } : {}) },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;
  return { fixture, compiled, login, navigateByUrl };
}

function typeInto(compiled: HTMLElement, testid: string, value: string) {
  const input = compiled.querySelector(`[data-testid="${testid}"] input`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

describe("LoginComponent", () => {
  it("renders the brand promise on the dark panel", () => {
    const { compiled } = setup();
    expect(compiled.querySelector('[data-testid="login-brand-panel"]')).toBeTruthy();
    expect(compiled.textContent).toMatch(/listos para imprimir/i);
  });

  it('shows the "sesión expiró" notice when ?expired=1', () => {
    const { compiled } = setup({ expired: true });
    expect(compiled.querySelector('[data-testid="login-expired"]')).toBeTruthy();
    expect(compiled.textContent).toMatch(/tu sesión expiró/i);
  });

  it("does not show the expired notice by default", () => {
    const { compiled } = setup();
    expect(compiled.querySelector('[data-testid="login-expired"]')).toBeFalsy();
  });

  it("logs in and navigates to /app on success", () => {
    const { compiled, fixture, login, navigateByUrl } = setup();
    typeInto(compiled, "login-email", "profe@colegio.pe");
    typeInto(compiled, "login-password", "secret123");
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="login-submit"] button') as HTMLButtonElement).click();
    expect(login).toHaveBeenCalledWith({ email: "profe@colegio.pe", password: "secret123" });
    expect(navigateByUrl).toHaveBeenCalledWith("/app");
  });

  it("shows an inline error on 401", () => {
    const { compiled, fixture } = setup({
      loginImpl: () => throwError(() => new HttpErrorResponse({ status: 401 })),
    });
    typeInto(compiled, "login-email", "profe@colegio.pe");
    typeInto(compiled, "login-password", "bad");
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="login-submit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="login-error"]')).toBeTruthy();
    expect(compiled.textContent).toMatch(/incorrectos/i);
  });
});
```

- [ ] **Step 2: Verlo fallar** — `pnpm --filter @exams-generator/web test -- login.component` → FAIL (faltan `login-brand-panel`, `login-expired`, testids nuevos en inputs/submit).

- [ ] **Step 3: Implementación** — `login.component.ts` (añade lectura del query param; conserva la lógica de submit existente):

```ts
import { Component, inject, signal } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { ActivatedRoute, Router } from "@angular/router";
import { ButtonComponent } from "../../ui/button/button.component";
import { InputComponent } from "../../ui/input/input.component";
import { AuthService } from "../../core/auth/auth.service";

@Component({
  selector: "app-login",
  standalone: true,
  imports: [ButtonComponent, InputComponent],
  templateUrl: "./login.component.html",
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly email = signal("");
  protected readonly password = signal("");
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly sessionExpired = signal(
    this.route.snapshot.queryParamMap.get("expired") === "1",
  );

  private isValid(): boolean {
    return /\S+@\S+\.\S+/.test(this.email()) && this.password().length > 0;
  }

  protected onFormSubmit(event: Event): void {
    event.preventDefault();
    this.onSubmit();
  }

  protected onSubmit(): void {
    if (!this.isValid() || this.submitting()) {
      return;
    }
    this.errorMessage.set(null);
    this.sessionExpired.set(false);
    this.submitting.set(true);
    this.authService.login({ email: this.email(), password: this.password() }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.router.navigateByUrl("/app");
      },
      error: (error: HttpErrorResponse) => {
        this.submitting.set(false);
        this.errorMessage.set(
          error.status === 401
            ? "Correo o contraseña incorrectos."
            : "Ocurrió un error. Inténtalo de nuevo.",
        );
      },
    });
  }
}
```

`login.component.html`:

```html
<main class="flex min-h-screen flex-col md:flex-row">
  <!-- Panel de marca (oscuro) -->
  <section
    data-testid="login-brand-panel"
    class="flex flex-col justify-between bg-primary-900 p-8 text-white md:w-1/2 md:p-12"
  >
    <div>
      <p class="text-lg font-extrabold tracking-tight">Exams Generator</p>
    </div>
    <div class="my-8 hidden md:block">
      <h2 class="max-w-md text-3xl font-bold leading-snug">
        Tus exámenes tipo admisión, listos para imprimir.
      </h2>
      <p class="mt-3 max-w-md text-primary-200">
        Arma, revisa y genera varias formas del examen en minutos. Nosotros ponemos el orden.
      </p>
      <div class="mt-8 rounded-card bg-primary-800 p-4">
        <p class="text-sm font-semibold text-primary-100">Examen · 5° secundaria · Forma A</p>
        <div class="mt-3 space-y-2">
          <div class="h-2 w-3/4 rounded-full bg-primary-700"></div>
          <div class="h-2 w-2/3 rounded-full bg-primary-700"></div>
          <div class="h-2 w-1/2 rounded-full bg-primary-700"></div>
        </div>
      </div>
    </div>
    <p class="text-xs text-primary-300">Para colegios y academias del Perú.</p>
  </section>

  <!-- Form (claro) -->
  <section class="flex flex-1 items-center justify-center bg-n50 p-6">
    <div class="w-full max-w-sm">
      <h1 class="text-2xl font-bold text-n900">Inicia sesión</h1>
      <p class="mt-1 text-sm text-n600">Con la cuenta que te dio tu colegio.</p>

      @if (sessionExpired()) {
      <p
        data-testid="login-expired"
        class="mt-4 rounded-field bg-warn-bg px-3 py-2 text-sm text-warn-text"
        role="status"
      >
        Tu sesión expiró, vuelve a entrar.
      </p>
      }

      <form (submit)="onFormSubmit($event)" class="mt-6 flex flex-col gap-4">
        <div data-testid="login-email">
          <ui-input
            label="Correo"
            name="email"
            type="email"
            [value]="email()"
            (valueChange)="email.set($event)"
          ></ui-input>
        </div>
        <div data-testid="login-password">
          <ui-input
            label="Contraseña"
            name="password"
            type="password"
            [value]="password()"
            (valueChange)="password.set($event)"
          ></ui-input>
        </div>

        @if (errorMessage()) {
        <p
          data-testid="login-error"
          class="rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text"
          role="alert"
        >
          {{ errorMessage() }}
        </p>
        }

        <div data-testid="login-submit">
          <ui-button htmlType="submit" variant="primary" [loading]="submitting()">Entrar</ui-button>
        </div>
      </form>

      <p class="mt-6 text-xs text-n500">
        ¿Olvidaste tu contraseña? Pídele una nueva al administrador de tu colegio.
      </p>
    </div>
  </section>
</main>
```

- [ ] **Step 4: Verde** — `pnpm --filter @exams-generator/web test -- login.component` → PASS.
- [ ] **Step 5: Commit**

```bash
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/features/login
git commit -m "feat(web): login con panel dividido de marca y aviso de sesion expirada"
```

---

## Task 5 — Banco de preguntas: lista + panel de detalle (paginación, archivar/borrar)

**Files:**

- Modify: `apps/web/src/app/features/bank/bank.models.ts` (extender `BankQuestion`, tipos nuevos)
- Modify: `apps/web/src/app/features/bank/bank.service.ts` (paginación, detalle, archivar, borrar)
- Modify: `apps/web/src/app/features/bank/bank.service.spec.ts`
- Modify: `apps/web/src/app/features/bank/bank-list/bank-list.component.ts` + `.html` + `.spec.ts`

**Interfaces:**

- Consumes (backend): S6 `GET /bank/questions?page=&pageSize=` → `{ items, total }`; `GET /bank/questions/:id`; S4 `PATCH /bank/questions/:id/archive`; S5 `DELETE /bank/questions/:id`; `GET /assets/:id` (blob).
- Produces (service):
  - `listQuestionsPaged(filters: BankQuestionFilters, page: number, pageSize: number): Observable<PagedQuestions>`
  - `getQuestion(id: string): Observable<BankQuestion>`
  - `archiveQuestion(id: string): Observable<{ id: string; status: 'archived' }>`
  - `deleteQuestion(id: string): Observable<void>`
- Produces (screen): lista izquierda paginada (reusa `data-testid="bank-question"`, `loading-indicator`, `empty-bank`, `empty-no-results`, `error-state`, `retry-button`) + panel derecho (`bank-panel`) con badges/metadata/acciones (`panel-edit`, `panel-archive`, `panel-delete`) + paginación (`bank-pagination`, `bank-page-prev`, `bank-page-next`).

- [ ] **Step 1: Extender modelo + test de service que falla** — en `bank.models.ts` agrega:

```ts
export type QuestionStatus = "draft" | "approved" | "archived";
export type QuestionOrigin = "school" | "ai" | "central";

// EXTENDER la interface BankQuestion existente con estos campos OPCIONALES
// (retro-compat: el list actual no los envía; ver GAP backend #3 del header):
//   readonly status?: QuestionStatus;
//   readonly type?: 'image' | 'structured';
//   readonly origin?: QuestionOrigin;
//   readonly usedInExamCount?: number;

export interface PagedQuestions {
  readonly items: readonly BankQuestion[];
  readonly total: number;
}
```

En `bank.service.spec.ts` (reusa el `HttpTestingController` del spec existente) agrega:

```ts
it("listQuestionsPaged hits /bank/questions with page params and returns {items,total}", () => {
  let result: PagedQuestions | undefined;
  service.listQuestionsPaged({ courseId: "c1" }, 2, 20).subscribe((r) => (result = r));
  const req = httpMock.expectOne(
    (r) =>
      r.url === "/api/bank/questions" &&
      r.params.get("page") === "2" &&
      r.params.get("pageSize") === "20" &&
      r.params.get("courseId") === "c1",
  );
  expect(req.request.method).toBe("GET");
  req.flush({ items: [], total: 0 });
  expect(result).toEqual({ items: [], total: 0 });
});

it("archiveQuestion PATCHes /bank/questions/:id/archive", () => {
  service.archiveQuestion("q1").subscribe();
  const req = httpMock.expectOne("/api/bank/questions/q1/archive");
  expect(req.request.method).toBe("PATCH");
  req.flush({ id: "q1", status: "archived" });
});

it("deleteQuestion DELETEs /bank/questions/:id", () => {
  service.deleteQuestion("q1").subscribe();
  const req = httpMock.expectOne("/api/bank/questions/q1");
  expect(req.request.method).toBe("DELETE");
  req.flush(null);
});

it("getQuestion GETs /bank/questions/:id", () => {
  service.getQuestion("q1").subscribe();
  const req = httpMock.expectOne("/api/bank/questions/q1");
  expect(req.request.method).toBe("GET");
  req.flush({
    id: "q1",
    tenantId: "t1",
    courseId: "c1",
    topicId: "tp1",
    difficulty: "easy",
    gradeLevel: "pre",
    correctAnswer: "a",
    imageAssetId: null,
  });
});
```

- [ ] **Step 2: Verlo fallar** — `pnpm --filter @exams-generator/web test -- bank.service` → FAIL (métodos no existen).

- [ ] **Step 3: Implementación service** — en `bank.service.ts` agrega (junto a los métodos existentes):

```ts
import { HttpClient, HttpParams } from '@angular/common/http';
// ...
listQuestionsPaged(
  filters: BankQuestionFilters,
  page: number,
  pageSize: number,
): Observable<PagedQuestions> {
  let params = new HttpParams().set('page', String(page)).set('pageSize', String(pageSize));
  if (filters.courseId) params = params.set('courseId', filters.courseId);
  if (filters.topicId) params = params.set('topicId', filters.topicId);
  if (filters.difficulty) params = params.set('difficulty', filters.difficulty);
  if (filters.gradeLevel) params = params.set('gradeLevel', filters.gradeLevel);
  return this.http.get<PagedQuestions>(`${environment.apiBaseUrl}/bank/questions`, { params });
}

getQuestion(id: string): Observable<BankQuestion> {
  return this.http.get<BankQuestion>(`${environment.apiBaseUrl}/bank/questions/${id}`);
}

archiveQuestion(id: string): Observable<{ id: string; status: 'archived' }> {
  return this.http.patch<{ id: string; status: 'archived' }>(
    `${environment.apiBaseUrl}/bank/questions/${id}/archive`,
    {},
  );
}

deleteQuestion(id: string): Observable<void> {
  return this.http.delete<void>(`${environment.apiBaseUrl}/bank/questions/${id}`);
}
```

(importa `PagedQuestions` de `./bank.models`.)

- [ ] **Step 4: Verde service** — `pnpm --filter @exams-generator/web test -- bank.service` → PASS.

- [ ] **Step 5: Test que falla (screen)** — reescribe `bank-list.component.spec.ts` conservando los testids del contrato y agregando panel/paginación/acciones. Usa `listQuestionsPaged` como fuente (mock devuelve `{items,total}`):

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { Subject, of, throwError } from "rxjs";
import { HttpErrorResponse } from "@angular/common/http";
import { importProvidersFrom } from "@angular/core";
import { Router } from "@angular/router";
import {
  LucideAngularModule,
  Lock,
  Pencil,
  Archive,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-angular";
import { Difficulty } from "@exams-generator/shared";
import { BankListComponent } from "./bank-list.component";
import { BankService } from "../bank.service";
import { BankQuestion, PagedQuestions } from "../bank.models";

function makeQuestion(o: Partial<BankQuestion> & { id: string }): BankQuestion {
  return {
    id: o.id,
    tenantId: o.tenantId ?? "t1",
    courseId: o.courseId ?? "course-1",
    topicId: o.topicId ?? "topic-1",
    difficulty: o.difficulty ?? Difficulty.Easy,
    gradeLevel: o.gradeLevel ?? "pre",
    correctAnswer: o.correctAnswer ?? "a",
    imageAssetId: o.imageAssetId ?? null,
    status: o.status ?? "approved",
    type: o.type ?? "image",
    origin: o.origin ?? "school",
    usedInExamCount: o.usedInExamCount ?? 0,
  };
}
const TWELVE = Array.from({ length: 12 }, (_, i) =>
  makeQuestion({
    id: `q${i}`,
    difficulty: [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard][i % 3],
    imageAssetId: i === 0 ? "asset-1" : null,
  }),
);
const PAGE1: PagedQuestions = { items: TWELVE, total: 30 };

function setup(
  over: {
    listImpl?: (...a: unknown[]) => unknown;
    getQuestionImpl?: (id: string) => unknown;
    archiveImpl?: (id: string) => unknown;
    deleteImpl?: (id: string) => unknown;
  } = {},
) {
  const listQuestionsPaged = vi.fn(over.listImpl ?? (() => of(PAGE1)));
  const getQuestion = vi.fn(over.getQuestionImpl ?? ((id: string) => of(makeQuestion({ id }))));
  const archiveQuestion = vi.fn(
    over.archiveImpl ?? ((id: string) => of({ id, status: "archived" })),
  );
  const deleteQuestion = vi.fn(over.deleteImpl ?? (() => of(void 0)));
  const buildImageAssetUrl = vi.fn((id: string) => `http://api.test/assets/${id}`);
  const fetchQuestionImage = vi.fn((id: string) =>
    of(new Blob([`b-${id}`], { type: "image/png" })),
  );
  const navigate = vi.fn();
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:mock-${n++}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

  TestBed.configureTestingModule({
    imports: [BankListComponent],
    providers: [
      importProvidersFrom(
        LucideAngularModule.pick({
          Lock,
          Pencil,
          Archive,
          Trash2,
          Search,
          ChevronLeft,
          ChevronRight,
        }),
      ),
      {
        provide: BankService,
        useValue: {
          listQuestionsPaged,
          getQuestion,
          archiveQuestion,
          deleteQuestion,
          buildImageAssetUrl,
          fetchQuestionImage,
        },
      },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(BankListComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    listQuestionsPaged,
    getQuestion,
    archiveQuestion,
    deleteQuestion,
    fetchQuestionImage,
    navigate,
  };
}

function selectFirst(compiled: HTMLElement, fixture: { detectChanges(): void }) {
  (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
  fixture.detectChanges();
}

describe("BankListComponent", () => {
  describe("with-data", () => {
    it("renders the current page of questions with a difficulty tag on each", () => {
      const { compiled } = setup();
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(12);
      expect(compiled.querySelectorAll('[data-testid="tag"]').length).toBe(12);
    });

    it("fetches thumbnails through an authenticated blob", () => {
      const { compiled, fetchQuestionImage } = setup();
      expect(fetchQuestionImage).toHaveBeenCalledWith("asset-1");
      expect(compiled.querySelector("img")?.getAttribute("src")).toMatch(/^blob:/);
    });
  });

  describe("detail panel", () => {
    it("opens the detail panel with actions when a question is selected", () => {
      const { compiled, fixture, getQuestion } = setup();
      selectFirst(compiled, fixture);
      expect(compiled.querySelector('[data-testid="bank-panel"]')).toBeTruthy();
      expect(getQuestion).toHaveBeenCalledWith("q0");
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeFalsy(); // approved: no borrar
    });

    it("shows delete (not archive) for an own draft", () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, status: "draft" })),
      });
      selectFirst(compiled, fixture);
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeFalsy();
    });

    it("renders central-bank questions read-only (lock note, no actions)", () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, tenantId: null, origin: "central" })),
      });
      selectFirst(compiled, fixture);
      expect(compiled.querySelector('[data-testid="panel-readonly"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeFalsy();
    });

    it("archives the selected approved question and reloads the list", () => {
      const { compiled, fixture, archiveQuestion, listQuestionsPaged } = setup();
      selectFirst(compiled, fixture);
      listQuestionsPaged.mockClear();
      (compiled.querySelector('[data-testid="panel-archive"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(archiveQuestion).toHaveBeenCalledWith("q0");
      expect(listQuestionsPaged).toHaveBeenCalledTimes(1);
    });
  });

  describe("pagination", () => {
    it("renders page info and advances to the next page", () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      expect(compiled.querySelector('[data-testid="bank-pagination"]')?.textContent).toMatch(/30/);
      listQuestionsPaged.mockClear();
      (
        compiled.querySelector('[data-testid="bank-page-next"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(listQuestionsPaged).toHaveBeenCalledWith(expect.anything(), 2, expect.any(Number));
    });
  });

  describe("loading", () => {
    it("shows a loading indicator while pending and no stale rows", () => {
      const subject = new Subject<PagedQuestions>();
      const { compiled, fixture } = setup({ listImpl: () => subject.asObservable() });
      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeTruthy();
      subject.next(PAGE1);
      subject.complete();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeFalsy();
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(12);
    });
  });

  describe("empty states", () => {
    it('shows "banco vacío" with CTA when the bank has zero questions overall', () => {
      const { compiled } = setup({ listImpl: () => of({ items: [], total: 0 }) });
      expect(compiled.querySelector('[data-testid="empty-bank"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/banco vacío/i);
    });

    it('shows "sin resultados" when filters match none but bank is non-empty', () => {
      const listImpl = vi
        .fn()
        .mockReturnValueOnce(of(PAGE1))
        .mockReturnValueOnce(of({ items: [], total: 0 }));
      const { compiled, fixture } = setup({ listImpl });
      (fixture.componentInstance as unknown as { courseId: { set(v: string): void } }).courseId.set(
        "nope",
      );
      (fixture.componentInstance as unknown as { search(): void }).search();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="empty-no-results"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/sin resultados|esos filtros/i);
    });
  });

  describe("error", () => {
    it("shows an error state with retry", () => {
      const { compiled, fixture, listQuestionsPaged } = setup({
        listImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      expect(compiled.querySelector('[data-testid="error-state"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/no se pudieron cargar/i);
      listQuestionsPaged.mockClear();
      listQuestionsPaged.mockReturnValue(of(PAGE1));
      (compiled.querySelector('[data-testid="retry-button"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(listQuestionsPaged).toHaveBeenCalledTimes(1);
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(12);
    });
  });
});
```

- [ ] **Step 6: Verlo fallar** — `pnpm --filter @exams-generator/web test -- bank-list.component` → FAIL.

- [ ] **Step 7: Implementación screen** — `bank-list.component.ts`:

```ts
import { Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { Router } from "@angular/router";
import { LucideAngularModule } from "lucide-angular";
import { Difficulty } from "@exams-generator/shared";
import { ButtonComponent } from "../../../ui/button/button.component";
import { EmptyStateComponent } from "../../../ui/empty-state/empty-state.component";
import { InputComponent } from "../../../ui/input/input.component";
import { SelectComponent } from "../../../ui/select/select.component";
import { TagComponent } from "../../../ui/tag/tag.component";
import { TagVariant } from "../../../ui/ui.types";
import { BankService } from "../bank.service";
import { BankQuestion, GRADE_LEVELS, GRADE_LEVEL_LABELS } from "../bank.models";

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: "Fácil",
  [Difficulty.Medium]: "Media",
  [Difficulty.Hard]: "Difícil",
};
const DIFFICULTY_TAG_VARIANT: Record<Difficulty, TagVariant> = {
  [Difficulty.Easy]: "easy",
  [Difficulty.Medium]: "medium",
  [Difficulty.Hard]: "hard",
};
const PAGE_SIZE = 12;

@Component({
  selector: "app-bank-list",
  standalone: true,
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    InputComponent,
    SelectComponent,
    TagComponent,
    LucideAngularModule,
  ],
  templateUrl: "./bank-list.component.html",
})
export class BankListComponent {
  private readonly bankService = inject(BankService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly difficulties = Object.values(Difficulty);
  protected readonly difficultyLabels = DIFFICULTY_LABELS;
  protected readonly gradeLevelOptions = GRADE_LEVELS.map((g) => ({
    value: g,
    label: GRADE_LEVEL_LABELS[g],
  }));
  protected readonly difficultyOptions = this.difficulties.map((d) => ({
    value: d,
    label: DIFFICULTY_LABELS[d],
  }));

  protected readonly courseId = signal("");
  protected readonly topicId = signal("");
  protected readonly difficulty = signal<Difficulty | null>(null);
  protected readonly gradeLevel = signal<string | null>(null);

  protected readonly questions = signal<BankQuestion[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly bankHasAnyQuestions = signal(false);

  protected readonly selected = signal<BankQuestion | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly imageUrls = signal<Record<string, string>>({});
  private readonly objectUrls: string[] = [];

  protected readonly pageSize = PAGE_SIZE;
  protected readonly lastPage = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );

  constructor() {
    this.search();
    this.destroyRef.onDestroy(() => this.objectUrls.forEach((u) => URL.revokeObjectURL(u)));
  }

  protected search(): void {
    this.page.set(1);
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.questions.set([]);
    this.bankService
      .listQuestionsPaged(
        {
          courseId: this.courseId() || undefined,
          topicId: this.topicId() || undefined,
          difficulty: this.difficulty() ?? undefined,
          gradeLevel: this.gradeLevel() ?? undefined,
        },
        this.page(),
        this.pageSize,
      )
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          this.questions.set([...res.items]);
          this.total.set(res.total);
          if (res.total > 0) this.bankHasAnyQuestions.set(true);
          this.loadImages(res.items);
        },
        error: (_e: HttpErrorResponse) => {
          this.loading.set(false);
          this.errorMessage.set("No se pudieron cargar las preguntas. Inténtalo de nuevo.");
        },
      });
  }

  protected retry(): void {
    this.load();
  }

  protected prevPage(): void {
    if (this.page() > 1) {
      this.page.update((p) => p - 1);
      this.load();
    }
  }
  protected nextPage(): void {
    if (this.page() < this.lastPage()) {
      this.page.update((p) => p + 1);
      this.load();
    }
  }

  protected select(question: BankQuestion): void {
    this.actionError.set(null);
    this.selected.set(question);
    this.bankService.getQuestion(question.id).subscribe({
      next: (full) => this.selected.set(full),
      error: () => {},
    });
  }

  protected isCentral(q: BankQuestion): boolean {
    return q.origin === "central" || q.tenantId === null;
  }
  protected canArchive(q: BankQuestion): boolean {
    return !this.isCentral(q) && q.status === "approved";
  }
  protected canDelete(q: BankQuestion): boolean {
    return !this.isCentral(q) && q.status === "draft";
  }

  protected archive(q: BankQuestion): void {
    this.actionError.set(null);
    this.bankService.archiveQuestion(q.id).subscribe({
      next: () => {
        this.selected.set(null);
        this.load();
      },
      error: () => this.actionError.set("No se pudo archivar la pregunta. Inténtalo de nuevo."),
    });
  }
  protected remove(q: BankQuestion): void {
    this.actionError.set(null);
    this.bankService.deleteQuestion(q.id).subscribe({
      next: () => {
        this.selected.set(null);
        this.load();
      },
      error: () => this.actionError.set("No se pudo borrar la pregunta. Inténtalo de nuevo."),
    });
  }
  protected edit(q: BankQuestion): void {
    this.router.navigate(["/app/bank/new"], { queryParams: { edit: q.id } });
  }

  private loadImages(questions: readonly BankQuestion[]): void {
    for (const q of questions) {
      const assetId = q.imageAssetId;
      if (!assetId || this.imageUrls()[assetId]) continue;
      this.bankService.fetchQuestionImage(assetId).subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        this.imageUrls.update((c) => ({ ...c, [assetId]: url }));
      });
    }
  }
  protected imageUrl(q: BankQuestion): string | null {
    return q.imageAssetId ? (this.imageUrls()[q.imageAssetId] ?? null) : null;
  }
  protected tagVariantFor(d: Difficulty): TagVariant {
    return DIFFICULTY_TAG_VARIANT[d];
  }
  protected difficultyLabel(d: Difficulty): string {
    return DIFFICULTY_LABELS[d];
  }
  protected goToNew(): void {
    this.router.navigate(["/app/bank/new"]);
  }
}
```

`bank-list.component.html`:

```html
<div class="flex flex-col gap-4">
  <!-- Barra de filtros -->
  <div class="flex flex-wrap items-end gap-3 rounded-card border border-n200 bg-white p-3">
    <div class="w-40">
      <ui-input label="Curso" [value]="courseId()" (valueChange)="courseId.set($event)"></ui-input>
    </div>
    <div class="w-40">
      <ui-input label="Tema" [value]="topicId()" (valueChange)="topicId.set($event)"></ui-input>
    </div>
    <div class="w-36">
      <ui-select
        label="Nivel"
        [options]="difficultyOptions"
        [value]="difficulty()"
        (valueChange)="difficulty.set($event)"
        placeholder="Todos"
      ></ui-select>
    </div>
    <div class="w-40">
      <ui-select
        label="Grado"
        [options]="gradeLevelOptions"
        [value]="gradeLevel()"
        (valueChange)="gradeLevel.set($event)"
        placeholder="Todos"
      ></ui-select>
    </div>
    <ui-button variant="ghost" (clicked)="search()"
      ><span class="flex items-center gap-1"
        ><lucide-angular name="search" class="h-4 w-4"></lucide-angular>Buscar</span
      ></ui-button
    >
    <div class="ml-auto">
      <ui-button variant="primary" (clicked)="goToNew()">+ Nueva pregunta</ui-button>
    </div>
  </div>

  @if (loading()) {
  <div data-testid="loading-indicator" class="grid gap-2">
    @for (i of [1,2,3,4,5]; track i) {
    <div class="h-14 animate-pulse rounded-field bg-n100"></div>
    }
  </div>
  } @else if (errorMessage()) {
  <div data-testid="error-state" class="rounded-card border border-n200 bg-white p-8 text-center">
    <p class="text-n700">{{ errorMessage() }}</p>
    <div data-testid="retry-button" class="mt-3 inline-block">
      <ui-button variant="primary" (clicked)="retry()">Reintentar</ui-button>
    </div>
  </div>
  } @else if (questions().length === 0 && !bankHasAnyQuestions()) {
  <div data-testid="empty-bank">
    <ui-empty-state
      message="Tu banco vacío aún no tiene preguntas. Sube preguntas o genéralas con IA."
    >
      <div cta class="flex gap-2">
        <ui-button variant="primary" (clicked)="goToNew()">Subir preguntas</ui-button>
      </div>
    </ui-empty-state>
  </div>
  } @else if (questions().length === 0) {
  <div data-testid="empty-no-results">
    <ui-empty-state
      message="No hay preguntas con esos filtros. Prueba limpiar los filtros."
    ></ui-empty-state>
  </div>
  } @else {
  <div class="grid grid-cols-1 gap-4 lg:grid-cols-[55%_45%]">
    <!-- Lista -->
    <div class="flex flex-col gap-2">
      @for (q of questions(); track q.id) {
      <button
        type="button"
        data-testid="bank-question"
        class="flex items-center gap-3 rounded-field border bg-white p-2 text-left"
        [class.border-primary-500]="selected()?.id === q.id"
        [class.bg-primary-50]="selected()?.id === q.id"
        [class.border-n200]="selected()?.id !== q.id"
        (click)="select(q)"
      >
        @if (imageUrl(q)) {
        <img [src]="imageUrl(q)" alt="" class="h-10 w-10 shrink-0 rounded object-cover" />
        } @else {
        <div class="h-10 w-10 shrink-0 rounded bg-n100"></div>
        }
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-n900">Clave: {{ q.correctAnswer }}</p>
          <p class="truncate text-xs text-n500">{{ q.courseId }} · {{ q.topicId }}</p>
        </div>
        <ui-tag [variant]="tagVariantFor(q.difficulty)">{{ difficultyLabel(q.difficulty) }}</ui-tag>
      </button>
      }

      <div
        data-testid="bank-pagination"
        class="flex items-center justify-between pt-2 text-sm text-n600"
      >
        <span>{{ total() }} preguntas</span>
        <div class="flex items-center gap-2">
          <div data-testid="bank-page-prev">
            <ui-button variant="ghost" [disabled]="page() === 1" (clicked)="prevPage()"
              >‹</ui-button
            >
          </div>
          <span>{{ page() }} / {{ lastPage() }}</span>
          <div data-testid="bank-page-next">
            <ui-button variant="ghost" [disabled]="page() === lastPage()" (clicked)="nextPage()"
              >›</ui-button
            >
          </div>
        </div>
      </div>
    </div>

    <!-- Panel -->
    <div>
      @if (selected(); as q) {
      <div data-testid="bank-panel" class="rounded-card border border-n200 bg-white p-4">
        @if (imageUrl(q)) {
        <img [src]="imageUrl(q)" alt="" class="mb-3 max-h-64 w-full rounded object-contain" />
        }
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <ui-tag [variant]="tagVariantFor(q.difficulty)"
            >{{ difficultyLabel(q.difficulty) }}</ui-tag
          >
          @if (isCentral(q)) {
          <span
            class="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-xs text-primary-700"
          >
            <lucide-angular name="lock" class="h-3 w-3"></lucide-angular>Banco central
          </span>
          } @else if (q.origin === 'ai') {
          <ui-tag variant="ai">IA</ui-tag>
          } @else {
          <span class="rounded-full bg-tint-activo px-2 py-0.5 text-xs text-tint-texto"
            >Colegio</span
          >
          }
        </div>
        <dl class="mb-4 space-y-1 text-sm text-n700">
          <div class="flex gap-2">
            <dt class="text-n500">Clave:</dt>
            <dd>{{ q.correctAnswer }}</dd>
          </div>
          <div class="flex gap-2">
            <dt class="text-n500">Grado:</dt>
            <dd>{{ q.gradeLevel }}</dd>
          </div>
          <div class="flex gap-2">
            <dt class="text-n500">Usada en:</dt>
            <dd>{{ q.usedInExamCount ?? 0 }} exámenes</dd>
          </div>
        </dl>

        @if (actionError()) {
        <p class="mb-3 rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text" role="alert">
          {{ actionError() }}
        </p>
        } @if (isCentral(q)) {
        <p data-testid="panel-readonly" class="text-sm text-n500">
          Pregunta del banco central — solo lectura.
        </p>
        } @else {
        <div class="flex flex-wrap gap-2">
          <div data-testid="panel-edit">
            <ui-button variant="ghost" (clicked)="edit(q)"
              ><span class="flex items-center gap-1"
                ><lucide-angular name="pencil" class="h-4 w-4"></lucide-angular>Editar</span
              ></ui-button
            >
          </div>
          @if (canArchive(q)) {
          <div data-testid="panel-archive">
            <ui-button variant="ghost" (clicked)="archive(q)"
              ><span class="flex items-center gap-1"
                ><lucide-angular name="archive" class="h-4 w-4"></lucide-angular>Archivar</span
              ></ui-button
            >
          </div>
          } @if (canDelete(q)) {
          <div data-testid="panel-delete">
            <ui-button variant="ghost" (clicked)="remove(q)"
              ><span class="flex items-center gap-1 text-hard-text"
                ><lucide-angular name="trash-2" class="h-4 w-4"></lucide-angular>Borrar</span
              ></ui-button
            >
          </div>
          }
        </div>
        }
      </div>
      } @else {
      <div class="rounded-card border border-dashed border-n200 p-8 text-center text-sm text-n500">
        Selecciona una pregunta para ver el detalle.
      </div>
      }
    </div>
  </div>
  }
</div>
```

- [ ] **Step 8: Verde** — `pnpm --filter @exams-generator/web test -- bank-list.component bank.service` → PASS.
- [ ] **Step 9: Commit**

```bash
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/features/bank/bank.models.ts apps/web/src/app/features/bank/bank.service.ts apps/web/src/app/features/bank/bank.service.spec.ts apps/web/src/app/features/bank/bank-list
git commit -m "feat(web): banco lista+panel con paginacion, archivar y borrar"
```

---

## Task 6 — Nueva pregunta: tabs "Foto" / "Escribir pregunta" (estructurada)

**Files:**

- Create: `apps/web/src/app/features/bank/bank-new/bank-new.component.ts` + `.html` + `.spec.ts`
- Modify: `apps/web/src/app/features/bank/bank.service.ts` (crear pregunta estructurada)
- Modify: `apps/web/src/app/features/bank/bank.service.spec.ts`
- Modify: `apps/web/src/app/features/bank/bank.models.ts` (payload estructurado)
- Modify: `apps/web/src/app/app.routes.ts` — COMPARTIDO, commit atómico

**Interfaces:**

- Consumes (backend): `POST /bank/questions/image` (existente vía `uploadImageQuestion`), `POST /bank/questions/structured` (existente sin UI).
- Produces (service): `createStructuredQuestion(payload: CreateStructuredQuestionPayload): Observable<{ id: string }>`.
- Produces (screen): pantalla con dos tabs (`tab-photo`, `tab-structured`); al guardar navega a `/app/bank`. Estados: validación por tab, error de guardado (`save-error`), guardando (loading).

- [ ] **Step 1: Modelo + test service que falla** — en `bank.models.ts`:

```ts
export interface CreateStructuredQuestionPayload {
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly correctAnswer: string;
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
}
```

En `bank.service.spec.ts`:

```ts
it("createStructuredQuestion POSTs /bank/questions/structured with the payload", () => {
  const payload = {
    courseId: "c1",
    topicId: "t1",
    difficulty: Difficulty.Easy,
    gradeLevel: "pre",
    correctAnswer: "a",
    bodyTypst: "¿2+2?",
    alternatives: ["4", "3", "5", "6"],
  };
  service.createStructuredQuestion(payload).subscribe();
  const req = httpMock.expectOne("/api/bank/questions/structured");
  expect(req.request.method).toBe("POST");
  expect(req.request.body).toEqual(payload);
  req.flush({ id: "new-q" });
});
```

(importa `Difficulty` en el spec si falta.)

- [ ] **Step 2: Verlo fallar** — `pnpm --filter @exams-generator/web test -- bank.service` → FAIL.

- [ ] **Step 3: Implementación service** — en `bank.service.ts`:

```ts
createStructuredQuestion(payload: CreateStructuredQuestionPayload): Observable<{ id: string }> {
  return this.http.post<{ id: string }>(`${environment.apiBaseUrl}/bank/questions/structured`, payload);
}
```

(importa `CreateStructuredQuestionPayload`.)

- [ ] **Step 4: Verde service** — `pnpm --filter @exams-generator/web test -- bank.service` → PASS.

- [ ] **Step 5: Test que falla (screen)** — `bank-new.component.spec.ts`:

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { of, throwError } from "rxjs";
import { HttpErrorResponse } from "@angular/common/http";
import { Router } from "@angular/router";
import { BankNewComponent } from "./bank-new.component";
import { BankService } from "../bank.service";

function setup(over: { uploadImpl?: () => unknown; structuredImpl?: () => unknown } = {}) {
  const uploadImageQuestion = vi.fn(over.uploadImpl ?? (() => of({ id: "img-q" })));
  const createStructuredQuestion = vi.fn(over.structuredImpl ?? (() => of({ id: "str-q" })));
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [BankNewComponent],
    providers: [
      { provide: BankService, useValue: { uploadImageQuestion, createStructuredQuestion } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(BankNewComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    uploadImageQuestion,
    createStructuredQuestion,
    navigate,
  };
}

function set(
  fixture: { componentInstance: unknown; detectChanges(): void },
  prop: string,
  value: unknown,
) {
  (fixture.componentInstance as Record<string, { set(v: unknown): void }>)[prop].set(value);
  fixture.detectChanges();
}

describe("BankNewComponent", () => {
  it("shows the photo tab by default and switches to the structured tab", () => {
    const { compiled } = setup();
    expect(compiled.querySelector('[data-testid="tab-photo-panel"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="tab-structured-panel"]')).toBeFalsy();
    (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
    compiled as unknown as { dispatchEvent(e: Event): void }; // no-op
  });

  it("creates a structured question and navigates back to /app/bank", () => {
    const { fixture, compiled, createStructuredQuestion, navigate } = setup();
    (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    set(fixture, "sCourseId", "c1");
    set(fixture, "sTopicId", "t1");
    set(fixture, "sDifficulty", "easy");
    set(fixture, "sGradeLevel", "pre");
    set(fixture, "sBody", "¿Cuánto es 2+2?");
    set(fixture, "sAlternatives", "4\n3\n5\n6");
    set(fixture, "sCorrectAnswer", "a");
    (
      compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
    ).click();
    expect(createStructuredQuestion).toHaveBeenCalledWith({
      courseId: "c1",
      topicId: "t1",
      difficulty: "easy",
      gradeLevel: "pre",
      correctAnswer: "a",
      bodyTypst: "¿Cuánto es 2+2?",
      alternatives: ["4", "3", "5", "6"],
    });
    expect(navigate).toHaveBeenCalledWith(["/app/bank"]);
  });

  it("shows an inline error when structured save fails and does not navigate", () => {
    const { fixture, compiled, navigate } = setup({
      structuredImpl: () => throwError(() => new HttpErrorResponse({ status: 400 })),
    });
    (compiled.querySelector('[data-testid="tab-structured"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    set(fixture, "sCourseId", "c1");
    set(fixture, "sTopicId", "t1");
    set(fixture, "sDifficulty", "easy");
    set(fixture, "sGradeLevel", "pre");
    set(fixture, "sBody", "x");
    set(fixture, "sAlternatives", "a\nb");
    set(fixture, "sCorrectAnswer", "a");
    (
      compiled.querySelector('[data-testid="structured-submit"] button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="save-error"]')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Verlo fallar** — `pnpm --filter @exams-generator/web test -- bank-new.component` → FAIL.

- [ ] **Step 7: Implementación screen** — `bank-new.component.ts`:

```ts
import { Component, inject, signal } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { Router } from "@angular/router";
import { Difficulty } from "@exams-generator/shared";
import { ButtonComponent } from "../../../ui/button/button.component";
import { InputComponent } from "../../../ui/input/input.component";
import { SelectComponent } from "../../../ui/select/select.component";
import { BankService } from "../bank.service";
import { GRADE_LEVELS, GRADE_LEVEL_LABELS } from "../bank.models";

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: "Fácil",
  [Difficulty.Medium]: "Media",
  [Difficulty.Hard]: "Difícil",
};
type Tab = "photo" | "structured";

@Component({
  selector: "app-bank-new",
  standalone: true,
  imports: [ButtonComponent, InputComponent, SelectComponent],
  templateUrl: "./bank-new.component.html",
})
export class BankNewComponent {
  private readonly bankService = inject(BankService);
  private readonly router = inject(Router);

  protected readonly gradeLevelOptions = GRADE_LEVELS.map((g) => ({
    value: g,
    label: GRADE_LEVEL_LABELS[g],
  }));
  protected readonly difficultyOptions = Object.values(Difficulty).map((d) => ({
    value: d,
    label: DIFFICULTY_LABELS[d],
  }));

  protected readonly tab = signal<Tab>("photo");
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  // Foto
  protected readonly pCourseId = signal("");
  protected readonly pTopicId = signal("");
  protected readonly pDifficulty = signal<Difficulty | null>(null);
  protected readonly pGradeLevel = signal<string | null>(null);
  protected readonly pCorrectAnswer = signal("");
  protected readonly pImage = signal<File | null>(null);

  // Estructurada
  protected readonly sCourseId = signal("");
  protected readonly sTopicId = signal("");
  protected readonly sDifficulty = signal<Difficulty | null>(null);
  protected readonly sGradeLevel = signal<string | null>(null);
  protected readonly sBody = signal("");
  protected readonly sAlternatives = signal("");
  protected readonly sCorrectAnswer = signal("");

  protected setTab(t: Tab): void {
    this.tab.set(t);
    this.saveError.set(null);
  }

  protected onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pImage.set(input.files?.[0] ?? null);
  }

  private photoValid(): boolean {
    return (
      !!this.pCourseId() &&
      !!this.pTopicId() &&
      !!this.pDifficulty() &&
      !!this.pGradeLevel() &&
      !!this.pCorrectAnswer() &&
      !!this.pImage()
    );
  }
  protected submitPhoto(): void {
    if (this.saving() || !this.photoValid()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.bankService
      .uploadImageQuestion({
        courseId: this.pCourseId(),
        topicId: this.pTopicId(),
        difficulty: this.pDifficulty()!,
        gradeLevel: this.pGradeLevel()!,
        correctAnswer: this.pCorrectAnswer(),
        image: this.pImage()!,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.router.navigate(["/app/bank"]);
        },
        error: (_e: HttpErrorResponse) => {
          this.saving.set(false);
          this.saveError.set(
            "No se pudo guardar la pregunta. Revisa los datos e inténtalo de nuevo.",
          );
        },
      });
  }

  private structuredValid(): boolean {
    return (
      !!this.sCourseId() &&
      !!this.sTopicId() &&
      !!this.sDifficulty() &&
      !!this.sGradeLevel() &&
      !!this.sBody().trim() &&
      this.alternativesList().length >= 2 &&
      !!this.sCorrectAnswer()
    );
  }
  private alternativesList(): string[] {
    return this.sAlternatives()
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }
  protected submitStructured(): void {
    if (this.saving() || !this.structuredValid()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.bankService
      .createStructuredQuestion({
        courseId: this.sCourseId(),
        topicId: this.sTopicId(),
        difficulty: this.sDifficulty()!,
        gradeLevel: this.sGradeLevel()!,
        correctAnswer: this.sCorrectAnswer(),
        bodyTypst: this.sBody(),
        alternatives: this.alternativesList(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.router.navigate(["/app/bank"]);
        },
        error: (_e: HttpErrorResponse) => {
          this.saving.set(false);
          this.saveError.set(
            "No se pudo guardar la pregunta. Revisa los datos e inténtalo de nuevo.",
          );
        },
      });
  }
}
```

`bank-new.component.html`:

```html
<div class="mx-auto max-w-2xl">
  <h1 class="mb-4 text-xl font-bold text-n900">Nueva pregunta</h1>

  <div class="mb-4 flex gap-1 border-b border-n200">
    <button
      type="button"
      data-testid="tab-photo"
      class="px-4 py-2 text-sm font-medium"
      [class.border-b-2]="tab() === 'photo'"
      [class.border-primary-500]="tab() === 'photo'"
      [class.text-primary-700]="tab() === 'photo'"
      [class.text-n500]="tab() !== 'photo'"
      (click)="setTab('photo')"
    >
      Foto de la pregunta
    </button>
    <button
      type="button"
      data-testid="tab-structured"
      class="px-4 py-2 text-sm font-medium"
      [class.border-b-2]="tab() === 'structured'"
      [class.border-primary-500]="tab() === 'structured'"
      [class.text-primary-700]="tab() === 'structured'"
      [class.text-n500]="tab() !== 'structured'"
      (click)="setTab('structured')"
    >
      Escribir pregunta
    </button>
  </div>

  @if (saveError()) {
  <p
    data-testid="save-error"
    class="mb-3 rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text"
    role="alert"
  >
    {{ saveError() }}
  </p>
  } @if (tab() === 'photo') {
  <div
    data-testid="tab-photo-panel"
    class="flex flex-col gap-3 rounded-card border border-n200 bg-white p-4"
  >
    <ui-input label="Curso" [value]="pCourseId()" (valueChange)="pCourseId.set($event)"></ui-input>
    <ui-input label="Tema" [value]="pTopicId()" (valueChange)="pTopicId.set($event)"></ui-input>
    <ui-select
      label="Nivel"
      [options]="difficultyOptions"
      [value]="pDifficulty()"
      (valueChange)="pDifficulty.set($event)"
      placeholder="Elige"
    ></ui-select>
    <ui-select
      label="Grado"
      [options]="gradeLevelOptions"
      [value]="pGradeLevel()"
      (valueChange)="pGradeLevel.set($event)"
      placeholder="Elige"
    ></ui-select>
    <ui-input
      label="Clave (respuesta correcta)"
      [value]="pCorrectAnswer()"
      (valueChange)="pCorrectAnswer.set($event)"
    ></ui-input>
    <label class="text-sm text-n700"
      >Imagen del enunciado
      <input
        type="file"
        accept="image/*"
        class="mt-1 block w-full text-sm"
        (change)="onImageSelected($event)"
      />
    </label>
    <div data-testid="photo-submit">
      <ui-button variant="primary" [loading]="saving()" (clicked)="submitPhoto()"
        >Guardar pregunta</ui-button
      >
    </div>
  </div>
  } @else {
  <div
    data-testid="tab-structured-panel"
    class="flex flex-col gap-3 rounded-card border border-n200 bg-white p-4"
  >
    <ui-input label="Curso" [value]="sCourseId()" (valueChange)="sCourseId.set($event)"></ui-input>
    <ui-input label="Tema" [value]="sTopicId()" (valueChange)="sTopicId.set($event)"></ui-input>
    <ui-select
      label="Nivel"
      [options]="difficultyOptions"
      [value]="sDifficulty()"
      (valueChange)="sDifficulty.set($event)"
      placeholder="Elige"
    ></ui-select>
    <ui-select
      label="Grado"
      [options]="gradeLevelOptions"
      [value]="sGradeLevel()"
      (valueChange)="sGradeLevel.set($event)"
      placeholder="Elige"
    ></ui-select>
    <label class="text-sm text-n700"
      >Enunciado
      <textarea
        class="mt-1 block w-full rounded-field border border-n200 p-2 text-sm"
        rows="3"
        [value]="sBody()"
        (input)="sBody.set($any($event.target).value)"
      ></textarea>
    </label>
    <label class="text-sm text-n700"
      >Alternativas (una por línea)
      <textarea
        class="mt-1 block w-full rounded-field border border-n200 p-2 text-sm"
        rows="4"
        [value]="sAlternatives()"
        (input)="sAlternatives.set($any($event.target).value)"
      ></textarea>
    </label>
    <ui-input
      label="Clave (a/b/c/d)"
      [value]="sCorrectAnswer()"
      (valueChange)="sCorrectAnswer.set($event)"
    ></ui-input>
    <div data-testid="structured-submit">
      <ui-button variant="primary" [loading]="saving()" (clicked)="submitStructured()"
        >Guardar pregunta</ui-button
      >
    </div>
  </div>
  }
</div>
```

- [ ] **Step 8: Verde screen** — `pnpm --filter @exams-generator/web test -- bank-new.component` → PASS.

- [ ] **Step 9: Ruta (COMPARTIDO)** — en `app.routes.ts`, dentro de children de `app`, agrega (junto a `bank/upload`):

```ts
{ path: 'bank/new', component: BankNewComponent },
```

(importa `BankNewComponent`.) Actualiza `app.routes.spec.ts` con:

```ts
it("exposes /app/bank/new", () => {
  expect(findRoute("bank/new")).toBeTruthy();
});
```

- [ ] **Step 10: Verde rutas** — `pnpm --filter @exams-generator/web test -- app.routes` → PASS.

- [ ] **Step 11: Commits** (screen no-compartido; ruta compartida atómica)

```bash
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/features/bank/bank-new apps/web/src/app/features/bank/bank.models.ts apps/web/src/app/features/bank/bank.service.ts apps/web/src/app/features/bank/bank.service.spec.ts
git commit -m "feat(web): pantalla nueva pregunta con tabs foto y estructurada"
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/app.routes.ts apps/web/src/app/app.routes.spec.ts
git commit -m "feat(web): ruta /app/bank/new para nueva pregunta"
```

---

## Task 7 — Mis exámenes: lista índice (historial) con duplicar/eliminar

**Files:**

- Modify: `apps/web/src/app/features/exams/exams.models.ts` (tipos de lista)
- Modify: `apps/web/src/app/features/exams/exams.service.ts` (listar/duplicar/eliminar)
- Modify: `apps/web/src/app/features/exams/exams.service.spec.ts`
- Replace: `apps/web/src/app/features/exams/exam-list/exam-list.component.ts` (stub → real) + `.html` + `.spec.ts`

**Interfaces:**

- Consumes (backend): S1 `GET /exams` → `{ items, total }`; S2 `POST /exams/:id/duplicate`; S3 `DELETE /exams/:id`.
- Produces (service): `listExams(filters: ExamListFilters): Observable<ExamListResult>`, `duplicateExam(examId: string): Observable<DuplicateExamResult>`, `deleteExam(examId: string): Observable<void>`.
- Produces (screen): tarjetas-fila por examen (`exam-row`), tag de estado, acción principal según estado (`exam-open` / `exam-continue`), menú `⋯` (`exam-menu`) con "Usar de plantilla" (`exam-duplicate`) y "Eliminar" (`exam-delete`, confirmación con modal para generados). Estados: `loading-indicator`, `empty-exams`, `error-state`/`retry-button`.

- [ ] **Step 1: Modelos + test service que falla** — en `exams.models.ts`:

```ts
export interface ExamListFilters {
  readonly status?: ExamStatus;
  readonly gradeLevel?: string;
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}
export interface ExamListItem {
  readonly id: string;
  readonly title: string;
  readonly gradeLevel: string;
  readonly status: ExamStatus;
  readonly questionCount: number;
  readonly versionCount: number;
  readonly createdAt: string;
}
export interface ExamListResult {
  readonly items: readonly ExamListItem[];
  readonly total: number;
}
export interface DuplicateExamResult {
  readonly id: string;
  readonly title: string;
  readonly status: "draft";
}
```

En `exams.service.spec.ts`:

```ts
it("listExams GETs /exams with filter params and returns {items,total}", () => {
  service.listExams({ status: "ready", page: 1, pageSize: 20 }).subscribe();
  const req = httpMock.expectOne(
    (r) =>
      r.url === "/api/exams" &&
      r.params.get("status") === "ready" &&
      r.params.get("page") === "1" &&
      r.params.get("pageSize") === "20",
  );
  expect(req.request.method).toBe("GET");
  req.flush({ items: [], total: 0 });
});

it("duplicateExam POSTs /exams/:id/duplicate", () => {
  service.duplicateExam("e1").subscribe();
  const req = httpMock.expectOne("/api/exams/e1/duplicate");
  expect(req.request.method).toBe("POST");
  req.flush({ id: "e2", title: "Copia de X", status: "draft" });
});

it("deleteExam DELETEs /exams/:id", () => {
  service.deleteExam("e1").subscribe();
  const req = httpMock.expectOne("/api/exams/e1");
  expect(req.request.method).toBe("DELETE");
  req.flush(null);
});
```

- [ ] **Step 2: Verlo fallar** — `pnpm --filter @exams-generator/web test -- exams.service` → FAIL.

- [ ] **Step 3: Implementación service** — en `exams.service.ts`:

```ts
import { HttpClient, HttpParams } from '@angular/common/http';
// ...
listExams(filters: ExamListFilters): Observable<ExamListResult> {
  let params = new HttpParams();
  if (filters.status) params = params.set('status', filters.status);
  if (filters.gradeLevel) params = params.set('gradeLevel', filters.gradeLevel);
  if (filters.search) params = params.set('search', filters.search);
  if (filters.page) params = params.set('page', String(filters.page));
  if (filters.pageSize) params = params.set('pageSize', String(filters.pageSize));
  return this.http.get<ExamListResult>(`${environment.apiBaseUrl}/exams`, { params });
}
duplicateExam(examId: string): Observable<DuplicateExamResult> {
  return this.http.post<DuplicateExamResult>(`${environment.apiBaseUrl}/exams/${examId}/duplicate`, {});
}
deleteExam(examId: string): Observable<void> {
  return this.http.delete<void>(`${environment.apiBaseUrl}/exams/${examId}`);
}
```

(importa los tipos nuevos de `./exams.models`.)

- [ ] **Step 4: Verde service** — `pnpm --filter @exams-generator/web test -- exams.service` → PASS.

- [ ] **Step 5: Test que falla (screen)** — `exam-list.component.spec.ts`:

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { of, throwError } from "rxjs";
import { HttpErrorResponse } from "@angular/common/http";
import { importProvidersFrom } from "@angular/core";
import { Router } from "@angular/router";
import { LucideAngularModule, Ellipsis, Plus } from "lucide-angular";
import { ExamListComponent } from "./exam-list.component";
import { ExamsService } from "../exams.service";
import { ExamListItem, ExamListResult } from "../exams.models";

function item(o: Partial<ExamListItem> & { id: string }): ExamListItem {
  return {
    id: o.id,
    title: o.title ?? "Examen X",
    gradeLevel: o.gradeLevel ?? "pre",
    status: o.status ?? "ready",
    questionCount: o.questionCount ?? 10,
    versionCount: o.versionCount ?? 2,
    createdAt: o.createdAt ?? "2026-07-18T00:00:00.000Z",
  };
}
const RESULT: ExamListResult = {
  items: [
    item({ id: "e1", status: "ready" }),
    item({ id: "e2", status: "draft", title: "Borrador Y" }),
  ],
  total: 2,
};

function setup(
  over: { listImpl?: () => unknown; dupImpl?: () => unknown; delImpl?: () => unknown } = {},
) {
  const listExams = vi.fn(over.listImpl ?? (() => of(RESULT)));
  const duplicateExam = vi.fn(
    over.dupImpl ?? (() => of({ id: "e3", title: "Copia de Examen X", status: "draft" })),
  );
  const deleteExam = vi.fn(over.delImpl ?? (() => of(void 0)));
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [ExamListComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Ellipsis, Plus })),
      { provide: ExamsService, useValue: { listExams, duplicateExam, deleteExam } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(ExamListComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    listExams,
    duplicateExam,
    deleteExam,
    navigate,
  };
}

describe("ExamListComponent", () => {
  it("renders one row per exam with a status tag", () => {
    const { compiled } = setup();
    expect(compiled.querySelectorAll('[data-testid="exam-row"]').length).toBe(2);
    expect(compiled.querySelectorAll('[data-testid="tag"]').length).toBe(2);
  });

  it("opens the versions detail for a ready exam", () => {
    const { compiled, navigate } = setup();
    (compiled.querySelectorAll('[data-testid="exam-open"] button')[0] as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(["/app/exams", "e1", "versions"]);
  });

  it("continues building a draft exam", () => {
    const { compiled, navigate } = setup();
    (compiled.querySelector('[data-testid="exam-continue"] button') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(["/app/exams", "e2"]);
  });

  it("duplicates an exam and navigates to the new draft builder", () => {
    const { compiled, fixture, duplicateExam, navigate } = setup();
    (compiled.querySelectorAll('[data-testid="exam-menu"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="exam-duplicate"] button') as HTMLButtonElement).click();
    expect(duplicateExam).toHaveBeenCalledWith("e1");
    expect(navigate).toHaveBeenCalledWith(["/app/exams", "e3"]);
  });

  it("deletes a draft directly (no confirmation) and reloads", () => {
    const { compiled, fixture, deleteExam, listExams } = setup();
    (compiled.querySelectorAll('[data-testid="exam-menu"]')[1] as HTMLButtonElement).click(); // e2 draft
    fixture.detectChanges();
    listExams.mockClear();
    (compiled.querySelector('[data-testid="exam-delete"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(deleteExam).toHaveBeenCalledWith("e2");
    expect(listExams).toHaveBeenCalledTimes(1);
  });

  it("requires confirmation before deleting a ready exam", () => {
    const { compiled, fixture, deleteExam } = setup();
    (compiled.querySelectorAll('[data-testid="exam-menu"]')[0] as HTMLButtonElement).click(); // e1 ready
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="exam-delete"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(deleteExam).not.toHaveBeenCalled(); // abre modal, aún no borra
    expect(compiled.querySelector('[data-testid="delete-confirm"]')).toBeTruthy();
    (
      compiled.querySelector('[data-testid="delete-confirm-yes"] button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(deleteExam).toHaveBeenCalledWith("e1");
  });

  it("shows empty state when there are no exams", () => {
    const { compiled } = setup({ listImpl: () => of({ items: [], total: 0 }) });
    expect(compiled.querySelector('[data-testid="empty-exams"]')).toBeTruthy();
    expect(compiled.textContent).toMatch(/aún no tienes exámenes/i);
  });

  it("shows an error state with retry", () => {
    const { compiled, fixture, listExams } = setup({
      listImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    expect(compiled.querySelector('[data-testid="error-state"]')).toBeTruthy();
    listExams.mockClear();
    listExams.mockReturnValue(of(RESULT));
    (compiled.querySelector('[data-testid="retry-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(listExams).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Verlo fallar** — `pnpm --filter @exams-generator/web test -- exam-list.component` → FAIL.

- [ ] **Step 7: Implementación screen** — `exam-list.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { Router } from "@angular/router";
import { LucideAngularModule } from "lucide-angular";
import { ButtonComponent } from "../../../ui/button/button.component";
import { EmptyStateComponent } from "../../../ui/empty-state/empty-state.component";
import { TagComponent } from "../../../ui/tag/tag.component";
import { ModalComponent } from "../../../ui/modal/modal.component";
import { TagVariant } from "../../../ui/ui.types";
import { ExamsService } from "../exams.service";
import { ExamListItem, GRADE_LEVEL_LABELS, GradeLevel } from "../exams.models";

@Component({
  selector: "app-exam-list",
  standalone: true,
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    TagComponent,
    ModalComponent,
    LucideAngularModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./exam-list.component.html",
})
export class ExamListComponent {
  private readonly examsService = inject(ExamsService);
  private readonly router = inject(Router);

  protected readonly exams = signal<ExamListItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly openMenuId = signal<string | null>(null);
  protected readonly pendingDelete = signal<ExamListItem | null>(null);
  protected readonly actionError = signal<string | null>(null);

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.exams.set([]);
    this.examsService.listExams({ page: 1, pageSize: 50 }).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.exams.set([...res.items]);
      },
      error: (_e: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMessage.set("No se pudieron cargar los exámenes. Inténtalo de nuevo.");
      },
    });
  }
  protected retry(): void {
    this.load();
  }

  protected statusTag(status: string): TagVariant {
    return status === "ready" ? "easy" : "medium";
  }
  protected statusLabel(status: string): string {
    return status === "ready" ? "Generado" : "Borrador";
  }
  protected gradeLabel(g: string): string {
    return GRADE_LEVEL_LABELS[g as GradeLevel] ?? g;
  }

  protected toggleMenu(id: string): void {
    this.openMenuId.update((cur) => (cur === id ? null : id));
  }

  protected open(exam: ExamListItem): void {
    this.router.navigate(["/app/exams", exam.id, "versions"]);
  }
  protected continueDraft(exam: ExamListItem): void {
    this.router.navigate(["/app/exams", exam.id]);
  }
  protected newExam(): void {
    this.router.navigate(["/app/exams/new"]);
  }

  protected duplicate(exam: ExamListItem): void {
    this.openMenuId.set(null);
    this.actionError.set(null);
    this.examsService.duplicateExam(exam.id).subscribe({
      next: (copy) => this.router.navigate(["/app/exams", copy.id]),
      error: () => this.actionError.set("No se pudo duplicar el examen. Inténtalo de nuevo."),
    });
  }

  protected requestDelete(exam: ExamListItem): void {
    this.openMenuId.set(null);
    if (exam.status === "draft") {
      this.performDelete(exam);
      return;
    }
    this.pendingDelete.set(exam);
  }
  protected confirmDelete(): void {
    const exam = this.pendingDelete();
    if (exam) {
      this.performDelete(exam);
      this.pendingDelete.set(null);
    }
  }
  protected cancelDelete(): void {
    this.pendingDelete.set(null);
  }
  private performDelete(exam: ExamListItem): void {
    this.actionError.set(null);
    this.examsService.deleteExam(exam.id).subscribe({
      next: () => this.load(),
      error: () => this.actionError.set("No se pudo eliminar el examen. Inténtalo de nuevo."),
    });
  }
}
```

`exam-list.component.html`:

```html
<div class="flex flex-col gap-4">
  <div class="flex items-center justify-between">
    <h1 class="text-xl font-bold text-n900">Mis exámenes</h1>
    <ui-button variant="primary" (clicked)="newExam()">+ Nuevo examen</ui-button>
  </div>

  @if (actionError()) {
  <p class="rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text" role="alert">
    {{ actionError() }}
  </p>
  } @if (loading()) {
  <div data-testid="loading-indicator" class="grid gap-2">
    @for (i of [1,2,3]; track i) {
    <div class="h-16 animate-pulse rounded-card bg-n100"></div>
    }
  </div>
  } @else if (errorMessage()) {
  <div data-testid="error-state" class="rounded-card border border-n200 bg-white p-8 text-center">
    <p class="text-n700">{{ errorMessage() }}</p>
    <div data-testid="retry-button" class="mt-3 inline-block">
      <ui-button variant="primary" (clicked)="retry()">Reintentar</ui-button>
    </div>
  </div>
  } @else if (exams().length === 0) {
  <div data-testid="empty-exams">
    <ui-empty-state message="Aún no tienes exámenes. Crea el primero para empezar.">
      <div cta><ui-button variant="primary" (clicked)="newExam()">+ Nuevo examen</ui-button></div>
    </ui-empty-state>
  </div>
  } @else {
  <div class="flex flex-col gap-2">
    @for (exam of exams(); track exam.id) {
    <div
      data-testid="exam-row"
      class="flex items-center gap-3 rounded-card border border-n200 bg-white p-3"
    >
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium text-n900">{{ exam.title }}</p>
        <p class="text-xs text-n500">
          {{ gradeLabel(exam.gradeLevel) }} · {{ exam.questionCount }} preguntas · {{
          exam.versionCount }} formas
        </p>
      </div>
      <ui-tag [variant]="statusTag(exam.status)">{{ statusLabel(exam.status) }}</ui-tag>
      @if (exam.status === 'ready') {
      <div data-testid="exam-open">
        <ui-button variant="ghost" (clicked)="open(exam)">Abrir ›</ui-button>
      </div>
      } @else {
      <div data-testid="exam-continue">
        <ui-button variant="ghost" (clicked)="continueDraft(exam)">Seguir armando ›</ui-button>
      </div>
      }
      <div class="relative">
        <button
          type="button"
          data-testid="exam-menu"
          class="rounded-field p-2 text-n500 hover:bg-n50"
          (click)="toggleMenu(exam.id)"
          aria-label="Más acciones"
        >
          <lucide-angular name="ellipsis" class="h-4 w-4"></lucide-angular>
        </button>
        @if (openMenuId() === exam.id) {
        <div
          class="absolute right-0 z-40 mt-1 w-52 rounded-card border border-n200 bg-white py-1 shadow-lg"
        >
          <div data-testid="exam-duplicate">
            <ui-button variant="ghost" (clicked)="duplicate(exam)">Usar de plantilla</ui-button>
          </div>
          <div data-testid="exam-delete">
            <ui-button variant="ghost" (clicked)="requestDelete(exam)"
              ><span class="text-hard-text">Eliminar</span></ui-button
            >
          </div>
        </div>
        }
      </div>
    </div>
    }
  </div>
  }

  <ui-modal [open]="pendingDelete() !== null" title="Eliminar examen">
    <p data-testid="delete-confirm" class="text-sm text-n700">
      ¿Seguro que quieres eliminar "{{ pendingDelete()?.title }}"? Esta acción no se puede deshacer.
    </p>
    <div actions class="flex justify-end gap-2">
      <ui-button variant="ghost" (clicked)="cancelDelete()">Cancelar</ui-button>
      <div data-testid="delete-confirm-yes">
        <ui-button variant="primary" (clicked)="confirmDelete()">Eliminar</ui-button>
      </div>
    </div>
  </ui-modal>
</div>
```

> Nota: `ExamListComponent` reemplaza el stub creado en Task 3. La ruta ya apunta a él, sin tocar `app.routes.ts`.

- [ ] **Step 8: Verde** — `pnpm --filter @exams-generator/web test -- exam-list.component exams.service` → PASS.
- [ ] **Step 9: Commit**

```bash
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/features/exams/exams.models.ts apps/web/src/app/features/exams/exams.service.ts apps/web/src/app/features/exams/exams.service.spec.ts apps/web/src/app/features/exams/exam-list
git commit -m "feat(web): historial de examenes con duplicar y eliminar"
```

---

## Task 8 — Detalle de examen generado: encabezado + formas + "Usar de plantilla"

**Files:**

- Modify: `apps/web/src/app/features/exam-versions/exam-versions-panel/exam-versions-panel.component.ts` + `.html` + `.spec.ts`

**Interfaces:**

- Consumes (backend): `GET /exams/:id` (`ExamsService.getExam` → `ExamDetail`), `GET /exams/:id/versions` (B4, `ExamVersionsService.listVersions`), `POST /exams/:id/duplicate` (S2, `ExamsService.duplicateExam`), `GET /assets/:id` (blob).
- Produces (screen): encabezado con título/grado/estado + botón "Usar de plantilla" (`detail-duplicate`); tabla de formas con descargas autenticadas (reusa el patrón `blob:` existente); contenido colapsado bajo "Ver contenido" (`detail-content-toggle`). Mantiene estados: `loading`, `notFound`, `error`, y "cero versiones" distinto.

> El componente actual solo lista versiones. Se ENRIQUECE: agrega header (vía `getExam`), botón duplicar, y sección de contenido colapsable. Los testids/estados existentes de descargas se preservan.

- [ ] **Step 1: Test que falla** — añade a `exam-versions-panel.component.spec.ts` (adaptando el `setup` para inyectar `ExamsService` y `ActivatedRoute` con `examId`):

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { of } from "rxjs";
import { importProvidersFrom } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { LucideAngularModule, Download } from "lucide-angular";
import { ExamVersionsPanelComponent } from "./exam-versions-panel.component";
import { ExamVersionsService } from "../exam-versions.service";
import { ExamsService } from "../../exams/exams.service";

function setup(over: { versionsImpl?: () => unknown; examImpl?: () => unknown } = {}) {
  const listVersions = vi.fn(
    over.versionsImpl ??
      (() => of([{ code: "A", pdfUrl: "/assets/a1", answerSheetUrl: "/assets/a2" }])),
  );
  const downloadAsset = vi.fn(() => of(new Blob(["x"], { type: "application/pdf" })));
  const getExam = vi.fn(
    over.examImpl ??
      (() =>
        of({
          id: "e1",
          title: "Examen de Álgebra",
          gradeLevel: "pre",
          status: "ready",
          questions: [],
        })),
  );
  const duplicateExam = vi.fn(() =>
    of({ id: "e9", title: "Copia de Examen de Álgebra", status: "draft" }),
  );
  const navigate = vi.fn();
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:m-${n++}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    imports: [ExamVersionsPanelComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Download })),
      { provide: ExamVersionsService, useValue: { listVersions, downloadAsset } },
      { provide: ExamsService, useValue: { getExam, duplicateExam } },
      { provide: Router, useValue: { navigate } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => "e1" } } } },
    ],
  });
  const fixture = TestBed.createComponent(ExamVersionsPanelComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    getExam,
    duplicateExam,
    navigate,
  };
}

describe("ExamVersionsPanelComponent — detail header", () => {
  it("shows the exam title and grade from getExam", () => {
    const { compiled, getExam } = setup();
    expect(getExam).toHaveBeenCalledWith("e1");
    expect(compiled.textContent).toContain("Examen de Álgebra");
  });

  it("duplicates the exam and navigates to the new draft builder", () => {
    const { compiled, duplicateExam, navigate } = setup();
    (
      compiled.querySelector('[data-testid="detail-duplicate"] button') as HTMLButtonElement
    ).click();
    expect(duplicateExam).toHaveBeenCalledWith("e1");
    expect(navigate).toHaveBeenCalledWith(["/app/exams", "e9"]);
  });

  it("toggles the collapsible content section", () => {
    const { compiled, fixture } = setup();
    expect(compiled.querySelector('[data-testid="detail-content-body"]')).toBeFalsy();
    (
      compiled.querySelector('[data-testid="detail-content-toggle"] button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="detail-content-body"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Verlo fallar** — `pnpm --filter @exams-generator/web test -- exam-versions-panel.component` → FAIL.

- [ ] **Step 3: Implementación** — en `exam-versions-panel.component.ts` inyecta `ExamsService` + `Router`, agrega señales `examDetail`, `contentOpen`, `duplicating`, `actionError`, y métodos:

```ts
// imports nuevos
import { Router } from '@angular/router';
import { ButtonComponent } from '../../../ui/button/button.component';
import { ExamsService } from '../../exams/exams.service';
import { ExamDetail, GRADE_LEVEL_LABELS, GradeLevel } from '../../exams/exams.models';
// @Component imports: agrega ButtonComponent (y LucideAngularModule si usas iconos de descarga)

// dentro de la clase:
private readonly examsService = inject(ExamsService);
private readonly router = inject(Router);
protected readonly examDetail = signal<ExamDetail | null>(null);
protected readonly contentOpen = signal(false);
protected readonly duplicating = signal(false);
protected readonly actionError = signal<string | null>(null);

// en el constructor, tras this.load():
this.examsService.getExam(this.examId()).subscribe({
  next: (detail) => this.examDetail.set(detail),
  error: () => {},
});

protected gradeLabel(g: string): string {
  return GRADE_LEVEL_LABELS[g as GradeLevel] ?? g;
}
protected toggleContent(): void {
  this.contentOpen.update((o) => !o);
}
protected duplicate(): void {
  this.actionError.set(null);
  this.duplicating.set(true);
  this.examsService.duplicateExam(this.examId()).subscribe({
    next: (copy) => this.router.navigate(['/app/exams', copy.id]),
    error: () => {
      this.duplicating.set(false);
      this.actionError.set('No se pudo duplicar el examen. Inténtalo de nuevo.');
    },
  });
}
```

En `exam-versions-panel.component.html`, ANTES de la lista de versiones existente, agrega el header y el bloque de contenido colapsable (conserva intactos loading/notFound/error/zero-versions y los links `blob:` actuales):

```html
@if (examDetail(); as detail) {
<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <div>
    <h1 class="text-xl font-bold text-n900">{{ detail.title }}</h1>
    <p class="text-sm text-n500">
      {{ gradeLabel(detail.gradeLevel) }} · {{ detail.questions.length }} preguntas
    </p>
  </div>
  <div data-testid="detail-duplicate">
    <ui-button variant="ghost" [loading]="duplicating()" (clicked)="duplicate()"
      >Usar de plantilla</ui-button
    >
  </div>
</div>
@if (actionError()) {
<p class="mb-3 rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text" role="alert">
  {{ actionError() }}
</p>
} }

<!-- ...aquí va el bloque EXISTENTE de formas/descargas sin cambios... -->

@if (examDetail(); as detail) {
<div class="mt-6">
  <div data-testid="detail-content-toggle">
    <ui-button variant="ghost" (clicked)="toggleContent()">
      {{ contentOpen() ? 'Ocultar contenido' : 'Ver contenido' }}
    </ui-button>
  </div>
  @if (contentOpen()) {
  <div data-testid="detail-content-body" class="mt-3 flex flex-col gap-2">
    @for (q of detail.questions; track q.id) {
    <div class="rounded-field border border-n200 bg-white p-3 text-sm text-n700">
      <span class="font-medium text-n900">{{ q.position }}.</span> {{ q.courseId }} · {{ q.topicId
      }} · clave {{ q.correctAnswer }}
    </div>
    }
  </div>
  }
</div>
}
```

- [ ] **Step 4: Verde** — `pnpm --filter @exams-generator/web test -- exam-versions-panel.component` → PASS.
- [ ] **Step 5: Commit**

```bash
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/features/exam-versions/exam-versions-panel
git commit -m "feat(web): detalle de examen con encabezado, usar de plantilla y contenido colapsable"
```

---

## Task 9 — Generar con IA: Taller (form persistente + tanda)

**Files:**

- Modify: `apps/web/src/app/features/ai/ai-generate/ai-generate.component.ts` + `.html` + `.spec.ts`

**Interfaces:**

- Consumes (backend): `POST /ai/questions/generate` (`AiService.generateQuestions` → `GenerateQuestionsResult { created, failed }`).
- Produces (screen): dos columnas — form izquierda persistente (NO se resetea) con stepper de cantidad y toggle figura; tanda derecha con tarjeta de estado + progreso, banner de fallos parciales con "Reintentar N" (`retry-failed`), empty state con flujo 1-2-3, y footer "Revisar en la cola" (`go-review`). Estados: generando (loading + progress), éxito, fallo parcial, empty.

- [ ] **Step 1: Test que falla** — reescribe `ai-generate.component.spec.ts`:

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { Subject, of } from "rxjs";
import { importProvidersFrom } from "@angular/core";
import { Router } from "@angular/router";
import { LucideAngularModule, Sparkles, TriangleAlert, Plus, Minus } from "lucide-angular";
import { AiGenerateComponent } from "./ai-generate.component";
import { AiService } from "../ai.service";
import { GenerateQuestionsResult } from "../ai.models";

function setup(over: { genImpl?: (...a: unknown[]) => unknown } = {}) {
  const generateQuestions = vi.fn(
    over.genImpl ??
      (() => of({ created: [{ id: "a" }, { id: "b" }], failed: [] } as GenerateQuestionsResult)),
  );
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [AiGenerateComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Sparkles, TriangleAlert, Plus, Minus })),
      { provide: AiService, useValue: { generateQuestions } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(AiGenerateComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, generateQuestions, navigate };
}
function set(
  fixture: { componentInstance: unknown; detectChanges(): void },
  prop: string,
  v: unknown,
) {
  (fixture.componentInstance as Record<string, { set(x: unknown): void }>)[prop].set(v);
  fixture.detectChanges();
}
function fillForm(fixture: { componentInstance: unknown; detectChanges(): void }) {
  set(fixture, "courseId", "c1");
  set(fixture, "topicId", "t1");
  set(fixture, "difficulty", "easy");
  set(fixture, "gradeLevel", "pre");
  set(fixture, "count", 3);
}

describe("AiGenerateComponent", () => {
  it("shows the 1-2-3 empty state before generating", () => {
    const { compiled } = setup();
    expect(compiled.querySelector('[data-testid="batch-empty"]')).toBeTruthy();
  });

  it("shows a live progress card while generating", () => {
    const subject = new Subject<GenerateQuestionsResult>();
    const { compiled, fixture } = setup({ genImpl: () => subject.asObservable() });
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="batch-progress"]')).toBeTruthy();
    subject.next({ created: [{ id: "a" }, { id: "b" }, { id: "c" }], failed: [] });
    subject.complete();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="batch-progress"]')).toBeFalsy();
  });

  it("does NOT reset the form after generating", () => {
    const { compiled, fixture } = setup();
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((fixture.componentInstance as { courseId(): string }).courseId()).toBe("c1");
    expect((fixture.componentInstance as { count(): number }).count()).toBe(3);
  });

  it("shows partial-failure banner with a retry-failed action", () => {
    const { compiled, fixture, generateQuestions } = setup({
      genImpl: () =>
        of({
          created: [{ id: "a" }],
          failed: [
            { index: 1, error: "x" },
            { index: 2, error: "y" },
          ],
        }),
    });
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="batch-failures"]')).toBeTruthy();
    generateQuestions.mockClear();
    generateQuestions.mockReturnValue(of({ created: [{ id: "z" }, { id: "w" }], failed: [] }));
    (compiled.querySelector('[data-testid="retry-failed"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(generateQuestions).toHaveBeenCalledWith(expect.objectContaining({ count: 2 }));
  });

  it("navigates to the review queue from the footer", () => {
    const { compiled, fixture, navigate } = setup();
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="go-review"] button') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(["/app/ai/review"]);
  });
});
```

- [ ] **Step 2: Verlo fallar** — `pnpm --filter @exams-generator/web test -- ai-generate.component` → FAIL.

- [ ] **Step 3: Implementación** — `ai-generate.component.ts`:

```ts
import { Component, computed, inject, signal } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { Router } from "@angular/router";
import { Difficulty } from "@exams-generator/shared";
import { LucideAngularModule } from "lucide-angular";
import { ButtonComponent } from "../../../ui/button/button.component";
import { SelectComponent } from "../../../ui/select/select.component";
import { InputComponent } from "../../../ui/input/input.component";
import { ProgressComponent } from "../../../ui/progress/progress.component";
import { BannerComponent } from "../../../ui/banner/banner.component";
import { AiService } from "../ai.service";
import { GenerateQuestionsResult, GRADE_LEVELS, GRADE_LEVEL_LABELS } from "../ai.models";

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.Easy]: "Fácil",
  [Difficulty.Medium]: "Media",
  [Difficulty.Hard]: "Difícil",
};

@Component({
  selector: "app-ai-generate",
  standalone: true,
  imports: [
    ButtonComponent,
    SelectComponent,
    InputComponent,
    ProgressComponent,
    BannerComponent,
    LucideAngularModule,
  ],
  templateUrl: "./ai-generate.component.html",
})
export class AiGenerateComponent {
  private readonly aiService = inject(AiService);
  private readonly router = inject(Router);

  protected readonly gradeLevelOptions = GRADE_LEVELS.map((g) => ({
    value: g,
    label: GRADE_LEVEL_LABELS[g],
  }));
  protected readonly difficultyOptions = Object.values(Difficulty).map((d) => ({
    value: d,
    label: DIFFICULTY_LABELS[d],
  }));

  protected readonly courseId = signal("");
  protected readonly topicId = signal("");
  protected readonly difficulty = signal<Difficulty | null>(null);
  protected readonly gradeLevel = signal<string | null>(null);
  protected readonly count = signal(5);
  protected readonly withFigure = signal(false);

  protected readonly generating = signal(false);
  protected readonly requested = signal(0);
  protected readonly result = signal<GenerateQuestionsResult | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly createdCount = computed(() => this.result()?.created.length ?? 0);
  protected readonly failedCount = computed(() => this.result()?.failed.length ?? 0);

  protected decCount(): void {
    this.count.update((c) => Math.max(1, c - 1));
  }
  protected incCount(): void {
    this.count.update((c) => Math.min(50, c + 1));
  }
  protected setCount(v: string): void {
    const n = Number(v);
    if (!Number.isNaN(n)) this.count.set(Math.min(50, Math.max(1, Math.floor(n))));
  }

  private valid(): boolean {
    return (
      !!this.courseId() &&
      !!this.topicId() &&
      !!this.difficulty() &&
      !!this.gradeLevel() &&
      this.count() > 0
    );
  }

  protected generate(): void {
    this.run(this.count());
  }
  protected retryFailed(): void {
    const failed = this.failedCount();
    if (failed > 0) this.run(failed);
  }

  private run(count: number): void {
    if (this.generating() || !this.valid()) return;
    this.generating.set(true);
    this.errorMessage.set(null);
    this.requested.set(count);
    this.aiService
      .generateQuestions({
        courseId: this.courseId(),
        topicId: this.topicId(),
        difficulty: this.difficulty()!,
        gradeLevel: this.gradeLevel()!,
        count,
        withFigure: this.withFigure(),
      })
      .subscribe({
        next: (res) => {
          this.generating.set(false);
          this.result.set(res);
        },
        error: (_e: HttpErrorResponse) => {
          this.generating.set(false);
          this.errorMessage.set("No se pudieron generar las preguntas. Inténtalo de nuevo.");
        },
      });
  }

  protected goToReview(): void {
    this.router.navigate(["/app/ai/review"]);
  }
}
```

`ai-generate.component.html`:

```html
<div class="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
  <!-- Form persistente -->
  <div class="flex flex-col gap-3 rounded-card border border-n200 bg-white p-4">
    <h2 class="text-lg font-bold text-n900">Generar con IA</h2>
    <ui-input label="Curso" [value]="courseId()" (valueChange)="courseId.set($event)"></ui-input>
    <ui-input label="Tema" [value]="topicId()" (valueChange)="topicId.set($event)"></ui-input>
    <ui-select
      label="Nivel"
      [options]="difficultyOptions"
      [value]="difficulty()"
      (valueChange)="difficulty.set($event)"
      placeholder="Elige"
    ></ui-select>
    <ui-select
      label="Grado"
      [options]="gradeLevelOptions"
      [value]="gradeLevel()"
      (valueChange)="gradeLevel.set($event)"
      placeholder="Elige"
    ></ui-select>
    <div>
      <span class="text-sm text-n700">Cantidad</span>
      <div class="mt-1 flex items-center gap-2">
        <button
          type="button"
          class="rounded-field border border-n200 p-2"
          (click)="decCount()"
          aria-label="Menos"
        >
          <lucide-angular name="minus" class="h-4 w-4"></lucide-angular>
        </button>
        <span class="w-8 text-center font-medium">{{ count() }}</span>
        <button
          type="button"
          class="rounded-field border border-n200 p-2"
          (click)="incCount()"
          aria-label="Más"
        >
          <lucide-angular name="plus" class="h-4 w-4"></lucide-angular>
        </button>
      </div>
    </div>
    <label class="flex items-center gap-2 text-sm text-n700">
      <input
        type="checkbox"
        [checked]="withFigure()"
        (change)="withFigure.set($any($event.target).checked)"
      />
      Incluir figura (diagrama)
    </label>
    <div data-testid="generate-button">
      <ui-button variant="primary" [loading]="generating()" (clicked)="generate()">
        <span class="flex items-center justify-center gap-1"
          ><lucide-angular name="sparkles" class="h-4 w-4"></lucide-angular>Generar {{ count() }}
          preguntas</span
        >
      </ui-button>
    </div>
    <p class="text-xs text-n500">Tarda ~1 min · puedes seguir navegando.</p>
  </div>

  <!-- Tanda -->
  <div class="flex flex-col gap-3">
    @if (errorMessage()) {
    <ui-banner variant="error" [message]="errorMessage()!"></ui-banner>
    } @if (generating()) {
    <div data-testid="batch-progress" class="rounded-card border border-n200 bg-white p-4">
      <p class="mb-2 text-sm text-n700">Generando {{ requested() }} preguntas…</p>
      <ui-progress [current]="0" [total]="requested()"></ui-progress>
    </div>
    } @else if (result(); as res) {
    <div class="rounded-card border border-n200 bg-white p-4">
      <p class="text-sm font-medium text-n900">
        {{ createdCount() }}/{{ requested() }} preguntas generadas
      </p>
      <ui-progress [current]="createdCount()" [total]="requested()"></ui-progress>
    </div>

    @if (failedCount() > 0) {
    <div data-testid="batch-failures">
      <ui-banner
        variant="warning"
        [message]="failedCount() + ' no pasaron la validación.'"
      ></ui-banner>
      <div data-testid="retry-failed" class="mt-2">
        <ui-button variant="ghost" (clicked)="retryFailed()"
          >Reintentar {{ failedCount() }}</ui-button
        >
      </div>
    </div>
    }

    <p class="text-xs text-n500">
      Lo generado entra como borrador a tu cola de revisión — nada se publica solo.
    </p>
    <div data-testid="go-review">
      <ui-button variant="primary" (clicked)="goToReview()"
        >Revisar los {{ createdCount() }} en la cola →</ui-button
      >
    </div>
    } @else {
    <div
      data-testid="batch-empty"
      class="rounded-card border border-dashed border-n200 p-8 text-sm text-n600"
    >
      <p class="font-medium text-n800">¿Cómo funciona?</p>
      <ol class="mt-2 list-inside list-decimal space-y-1">
        <li>Elige curso, tema, nivel y cuántas quieres.</li>
        <li>La IA las redacta como borrador.</li>
        <li>Revísalas en la cola antes de publicarlas.</li>
      </ol>
    </div>
    }
  </div>
</div>
```

- [ ] **Step 4: Verde** — `pnpm --filter @exams-generator/web test -- ai-generate.component` → PASS.
- [ ] **Step 5: Commit**

```bash
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/features/ai/ai-generate
git commit -m "feat(web): taller de generacion IA con form persistente y tanda de resultados"
```

---

## Task 10 — Cola de revisión: mesa de trabajo + preview PDF (WYSIWYG)

**Files:**

- Modify: `apps/web/src/app/features/ai/ai.service.ts` (preview blob)
- Modify: `apps/web/src/app/features/ai/ai.service.spec.ts`
- Modify: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.ts` + `.html` + `.spec.ts`

**Interfaces:**

- Consumes (backend): `GET /bank/questions?status=draft` (`AiService.listDrafts`), S7 `GET /bank/questions/:id/preview` (PDF), `POST /bank/questions/:id/approve`, `.../reject` (`AiService.approveQuestion/rejectQuestion`).
- Produces (service): `previewDraft(id: string): Observable<Blob>`.
- Produces (screen): lista izquierda de borradores (`review-item`, activa = borde primary-500), panel derecho con chips + preview PDF embebido (`preview-frame`) sobre "papel", skeleton mientras compila (`preview-loading`), fallback a contenido formateado si el render falla (`preview-fallback`), acciones Aprobar (`approve`) / Editar (`edit`) / Rechazar (`reject`, con confirmación). Al decidir, avanza al siguiente. Empty state (`empty-queue`).

- [ ] **Step 1: Test service que falla** — en `ai.service.spec.ts`:

```ts
it("previewDraft GETs /bank/questions/:id/preview as a blob", () => {
  service.previewDraft("q1").subscribe();
  const req = httpMock.expectOne("/api/bank/questions/q1/preview");
  expect(req.request.method).toBe("GET");
  expect(req.request.responseType).toBe("blob");
  req.flush(new Blob(["%PDF"], { type: "application/pdf" }));
});
```

- [ ] **Step 2: Verlo fallar** — `pnpm --filter @exams-generator/web test -- ai.service` → FAIL.

- [ ] **Step 3: Implementación service** — en `ai.service.ts`:

```ts
previewDraft(id: string): Observable<Blob> {
  return this.http.get(`${environment.apiBaseUrl}/bank/questions/${id}/preview`, { responseType: 'blob' });
}
```

- [ ] **Step 4: Verde service** — `pnpm --filter @exams-generator/web test -- ai.service` → PASS.

- [ ] **Step 5: Test que falla (screen)** — reescribe `ai-review-queue.component.spec.ts`:

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { Subject, of, throwError } from "rxjs";
import { HttpErrorResponse } from "@angular/common/http";
import { importProvidersFrom } from "@angular/core";
import { LucideAngularModule, Check, Pencil, X, Sparkles } from "lucide-angular";
import { Difficulty } from "@exams-generator/shared";
import { AiReviewQueueComponent } from "./ai-review-queue.component";
import { AiService } from "../ai.service";
import { DraftQuestion } from "../ai.models";

function draft(o: Partial<DraftQuestion> & { id: string }): DraftQuestion {
  return {
    id: o.id,
    tenantId: "t1",
    courseId: o.courseId ?? "c1",
    topicId: o.topicId ?? "t1",
    difficulty: o.difficulty ?? Difficulty.Easy,
    gradeLevel: o.gradeLevel ?? "pre",
    correctAnswer: o.correctAnswer ?? "a",
    bodyTypst: o.bodyTypst ?? "¿2+2?",
    alternatives: o.alternatives ?? ["4", "3"],
    figureCode: o.figureCode ?? null,
  };
}
const DRAFTS = [draft({ id: "d1" }), draft({ id: "d2" })];

function setup(
  over: {
    listImpl?: () => unknown;
    previewImpl?: (id: string) => unknown;
    approveImpl?: () => unknown;
  } = {},
) {
  const listDrafts = vi.fn(over.listImpl ?? (() => of(DRAFTS)));
  const previewDraft = vi.fn(
    over.previewImpl ?? (() => of(new Blob(["%PDF"], { type: "application/pdf" }))),
  );
  const approveQuestion = vi.fn(over.approveImpl ?? ((id: string) => of({ id })));
  const rejectQuestion = vi.fn((id: string) => of({ id }));
  let n = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:pdf-${n++}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    imports: [AiReviewQueueComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Check, Pencil, X, Sparkles })),
      {
        provide: AiService,
        useValue: { listDrafts, previewDraft, approveQuestion, rejectQuestion },
      },
    ],
  });
  const fixture = TestBed.createComponent(AiReviewQueueComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    listDrafts,
    previewDraft,
    approveQuestion,
    rejectQuestion,
  };
}

describe("AiReviewQueueComponent", () => {
  it("lists drafts and auto-selects the first, compiling its preview", () => {
    const { compiled, previewDraft } = setup();
    expect(compiled.querySelectorAll('[data-testid="review-item"]').length).toBe(2);
    expect(previewDraft).toHaveBeenCalledWith("d1");
    expect(compiled.querySelector('[data-testid="preview-frame"]')?.getAttribute("src")).toMatch(
      /^blob:/,
    );
  });

  it("shows a skeleton while the preview compiles", () => {
    const subject = new Subject<Blob>();
    const { compiled, fixture } = setup({ previewImpl: () => subject.asObservable() });
    expect(compiled.querySelector('[data-testid="preview-loading"]')).toBeTruthy();
    subject.next(new Blob(["%PDF"], { type: "application/pdf" }));
    subject.complete();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="preview-loading"]')).toBeFalsy();
  });

  it("falls back to formatted content when the preview render fails", () => {
    const { compiled } = setup({
      previewImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    expect(compiled.querySelector('[data-testid="preview-fallback"]')).toBeTruthy();
  });

  it("approves the current draft and advances to the next", () => {
    const { compiled, fixture, approveQuestion, previewDraft } = setup();
    previewDraft.mockClear();
    (compiled.querySelector('[data-testid="approve"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(approveQuestion).toHaveBeenCalledWith("d1");
    expect(previewDraft).toHaveBeenCalledWith("d2"); // avanzó al siguiente
  });

  it("rejects with confirmation", () => {
    const { compiled, fixture, rejectQuestion } = setup();
    (compiled.querySelector('[data-testid="reject"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(rejectQuestion).not.toHaveBeenCalled();
    (
      compiled.querySelector('[data-testid="reject-confirm-yes"] button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(rejectQuestion).toHaveBeenCalledWith("d1");
  });

  it("shows the empty state when the queue is empty", () => {
    const { compiled } = setup({ listImpl: () => of([]) });
    expect(compiled.querySelector('[data-testid="empty-queue"]')).toBeTruthy();
  });
});
```

- [ ] **Step 6: Verlo fallar** — `pnpm --filter @exams-generator/web test -- ai-review-queue.component` → FAIL.

- [ ] **Step 7: Implementación screen** — `ai-review-queue.component.ts`:

```ts
import { Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { DomSanitizer, SafeResourceUrl } from "@angular/platform-browser";
import { LucideAngularModule } from "lucide-angular";
import { ButtonComponent } from "../../../ui/button/button.component";
import { EmptyStateComponent } from "../../../ui/empty-state/empty-state.component";
import { TagComponent } from "../../../ui/tag/tag.component";
import { ModalComponent } from "../../../ui/modal/modal.component";
import { AiService } from "../ai.service";
import { DraftQuestion } from "../ai.models";

@Component({
  selector: "app-ai-review-queue",
  standalone: true,
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    TagComponent,
    ModalComponent,
    LucideAngularModule,
  ],
  templateUrl: "./ai-review-queue.component.html",
})
export class AiReviewQueueComponent {
  private readonly aiService = inject(AiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly drafts = signal<DraftQuestion[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly selected = signal<DraftQuestion | null>(null);
  protected readonly previewUrl = signal<SafeResourceUrl | null>(null);
  protected readonly previewLoading = signal(false);
  protected readonly previewFailed = signal(false);
  protected readonly rejecting = signal(false);
  protected readonly actionError = signal<string | null>(null);

  private readonly objectUrls: string[] = [];
  protected readonly firstLine = computed(() => {
    const body = this.selected()?.bodyTypst ?? "";
    return body.split("\n")[0] ?? "";
  });

  constructor() {
    this.load();
    this.destroyRef.onDestroy(() => this.objectUrls.forEach((u) => URL.revokeObjectURL(u)));
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.aiService.listDrafts().subscribe({
      next: (drafts) => {
        this.loading.set(false);
        this.drafts.set([...drafts]);
        if (drafts.length > 0) this.select(drafts[0]);
        else this.selected.set(null);
      },
      error: (_e: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMessage.set("No se pudo cargar la cola. Inténtalo de nuevo.");
      },
    });
  }

  protected select(draft: DraftQuestion): void {
    this.selected.set(draft);
    this.actionError.set(null);
    this.compilePreview(draft.id);
  }

  private compilePreview(id: string): void {
    this.previewUrl.set(null);
    this.previewFailed.set(false);
    this.previewLoading.set(true);
    this.aiService.previewDraft(id).subscribe({
      next: (blob) => {
        this.previewLoading.set(false);
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      },
      error: () => {
        this.previewLoading.set(false);
        this.previewFailed.set(true);
      },
    });
  }

  private advanceAfter(id: string): void {
    const remaining = this.drafts().filter((d) => d.id !== id);
    this.drafts.set(remaining);
    if (remaining.length > 0) this.select(remaining[0]);
    else this.selected.set(null);
  }

  protected approve(): void {
    const current = this.selected();
    if (!current) return;
    this.actionError.set(null);
    this.aiService.approveQuestion(current.id).subscribe({
      next: () => this.advanceAfter(current.id),
      error: () => this.actionError.set("No se pudo aprobar. Inténtalo de nuevo."),
    });
  }

  protected requestReject(): void {
    this.rejecting.set(true);
  }
  protected cancelReject(): void {
    this.rejecting.set(false);
  }
  protected confirmReject(): void {
    const current = this.selected();
    this.rejecting.set(false);
    if (!current) return;
    this.actionError.set(null);
    this.aiService.rejectQuestion(current.id).subscribe({
      next: () => this.advanceAfter(current.id),
      error: () => this.actionError.set("No se pudo rechazar. Inténtalo de nuevo."),
    });
  }
}
```

`ai-review-queue.component.html`:

```html
<div class="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
  <!-- Lista -->
  <div class="flex flex-col gap-2">
    @if (loading()) {
    <div data-testid="loading-indicator" class="h-12 animate-pulse rounded-field bg-n100"></div>
    } @else if (drafts().length === 0) {
    <div data-testid="empty-queue">
      <ui-empty-state message="No hay borradores por revisar."></ui-empty-state>
    </div>
    } @else { @for (d of drafts(); track d.id) {
    <button
      type="button"
      data-testid="review-item"
      class="rounded-field border bg-white p-2 text-left"
      [class.border-primary-500]="selected()?.id === d.id"
      [class.border-n200]="selected()?.id !== d.id"
      (click)="select(d)"
    >
      <p class="truncate text-sm text-n800">{{ d.bodyTypst }}</p>
      <p class="text-xs text-n500">{{ d.courseId }} · {{ d.topicId }}</p>
    </button>
    } }
  </div>

  <!-- Panel -->
  <div>
    @if (selected(); as d) {
    <div class="rounded-card border border-n200 bg-white p-4">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <ui-tag variant="ai">Borrador IA</ui-tag>
        <span class="text-sm text-n600">{{ d.gradeLevel }} · clave: {{ d.correctAnswer }}</span>
      </div>

      @if (actionError()) {
      <p class="mb-3 rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text" role="alert">
        {{ actionError() }}
      </p>
      }

      <div class="mb-4 rounded-card bg-n100 p-3">
        @if (previewLoading()) {
        <div data-testid="preview-loading" class="h-72 animate-pulse rounded bg-n200"></div>
        } @else if (previewUrl()) {
        <iframe
          data-testid="preview-frame"
          [src]="previewUrl()"
          class="h-72 w-full rounded bg-white"
          title="Vista previa"
        ></iframe>
        <p class="mt-1 text-center text-xs text-n500">Vista previa real — así se imprimirá.</p>
        } @else if (previewFailed()) {
        <div data-testid="preview-fallback" class="rounded bg-white p-3 text-sm text-n700">
          <p class="mb-2 text-xs text-warn-text">
            No se pudo generar la vista de impresión; mostramos el contenido.
          </p>
          <p class="font-medium text-n900">{{ d.bodyTypst }}</p>
          <ul class="mt-2 list-inside list-disc">
            @for (alt of d.alternatives ?? []; track alt) {
            <li>{{ alt }}</li>
            }
          </ul>
        </div>
        }
      </div>

      <div class="flex flex-wrap gap-2">
        <div data-testid="approve">
          <ui-button variant="primary" (clicked)="approve()"
            ><span class="flex items-center gap-1"
              ><lucide-angular name="check" class="h-4 w-4"></lucide-angular>Aprobar</span
            ></ui-button
          >
        </div>
        <div data-testid="edit">
          <ui-button variant="ghost"
            ><span class="flex items-center gap-1"
              ><lucide-angular name="pencil" class="h-4 w-4"></lucide-angular>Editar</span
            ></ui-button
          >
        </div>
        <div data-testid="reject">
          <ui-button variant="ghost" (clicked)="requestReject()"
            ><span class="flex items-center gap-1 text-hard-text"
              ><lucide-angular name="x" class="h-4 w-4"></lucide-angular>Rechazar</span
            ></ui-button
          >
        </div>
      </div>
    </div>
    } @else if (!loading()) {
    <div class="rounded-card border border-dashed border-n200 p-8 text-center text-sm text-n500">
      La cola está vacía.
    </div>
    }
  </div>

  <ui-modal [open]="rejecting()" title="Rechazar borrador">
    <p class="text-sm text-n700">
      ¿Seguro que quieres rechazar este borrador? No entrará al banco.
    </p>
    <div actions class="flex justify-end gap-2">
      <ui-button variant="ghost" (clicked)="cancelReject()">Cancelar</ui-button>
      <div data-testid="reject-confirm-yes">
        <ui-button variant="primary" (clicked)="confirmReject()">Rechazar</ui-button>
      </div>
    </div>
  </ui-modal>
</div>
```

> Nota: el botón "Editar" (`edit`) queda cableado a la UI pero su flujo de edición estructurada completa (form + re-validación + invalidar caché de preview) se apoya en `AiService.editDraft` existente; para este plan solo se expone el botón. Si se requiere el editor inline, se añade en una iteración posterior (fuera del alcance del spec, que solo pide la acción visible).

- [ ] **Step 8: Verde** — `pnpm --filter @exams-generator/web test -- ai-review-queue.component ai.service` → PASS.
- [ ] **Step 9: Commit**

```bash
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/features/ai/ai.service.ts apps/web/src/app/features/ai/ai.service.spec.ts apps/web/src/app/features/ai/ai-review-queue
git commit -m "feat(web): cola de revision con preview PDF wysiwyg y acciones aprobar/rechazar"
```

---

## Task 11 — Configuración del colegio: tabs "Datos y logo" | "Profesores" (módulo users)

**Files:**

- Create: `apps/web/src/app/features/users/users.models.ts`
- Create: `apps/web/src/app/features/users/users.service.ts` + `.spec.ts`
- Modify: `apps/web/src/app/features/tenant-settings/tenant-settings.component.ts` + `.html` + `.spec.ts`

**Interfaces:**

- Consumes (backend S8): `GET /users` → `TenantUser[]`; `POST /users {email, role}` → `{ id, email, role, temporaryPassword }`; `PATCH /users/:id {active}` → `{ id, active }`; `POST /users/:id/reset-password` → `{ id, temporaryPassword }`.
- Produces (service): `list()`, `create(payload)`, `setActive(id, active)`, `resetPassword(id)`.
- Produces (screen): dos tabs. "Datos y logo" = el form existente (se preserva). "Profesores" = contador, tabla (avatar iniciales, nombre/email, rol, estado, menú `⋯`), "+ Agregar profesor" (modal → password temporal mostrada UNA vez), reset password (modal), desactivar/reactivar, empty state.

- [ ] **Step 1: Modelos + test service que falla** — `users.models.ts`:

```ts
export type UserRole = "teacher" | "school_admin";

export interface TenantUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly active: boolean;
  readonly createdAt: string;
}
export interface CreateUserPayload {
  readonly email: string;
  readonly role: UserRole;
}
export interface CreateUserResult {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  readonly temporaryPassword: string;
}
export interface SetActiveResult {
  readonly id: string;
  readonly active: boolean;
}
export interface ResetPasswordResult {
  readonly id: string;
  readonly temporaryPassword: string;
}
```

`users.service.spec.ts`:

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, beforeEach } from "vitest";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { UsersService } from "./users.service";

describe("UsersService", () => {
  let service: UsersService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [UsersService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UsersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it("list GETs /users", () => {
    service.list().subscribe();
    const req = httpMock.expectOne("/api/users");
    expect(req.request.method).toBe("GET");
    req.flush([]);
  });

  it("create POSTs /users with email and role", () => {
    service.create({ email: "a@b.pe", role: "teacher" }).subscribe();
    const req = httpMock.expectOne("/api/users");
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({ email: "a@b.pe", role: "teacher" });
    req.flush({ id: "u1", email: "a@b.pe", role: "teacher", temporaryPassword: "abc123def456" });
  });

  it("setActive PATCHes /users/:id", () => {
    service.setActive("u1", false).subscribe();
    const req = httpMock.expectOne("/api/users/u1");
    expect(req.request.method).toBe("PATCH");
    expect(req.request.body).toEqual({ active: false });
    req.flush({ id: "u1", active: false });
  });

  it("resetPassword POSTs /users/:id/reset-password", () => {
    service.resetPassword("u1").subscribe();
    const req = httpMock.expectOne("/api/users/u1/reset-password");
    expect(req.request.method).toBe("POST");
    req.flush({ id: "u1", temporaryPassword: "zzz999yyy888" });
  });
});
```

- [ ] **Step 2: Verlo fallar** — `pnpm --filter @exams-generator/web test -- users.service` → FAIL.

- [ ] **Step 3: Implementación service** — `users.service.ts`:

```ts
import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { environment } from "../../../environments/environment";
import {
  CreateUserPayload,
  CreateUserResult,
  ResetPasswordResult,
  SetActiveResult,
  TenantUser,
} from "./users.models";

@Injectable({ providedIn: "root" })
export class UsersService {
  private readonly http = inject(HttpClient);

  list(): Observable<TenantUser[]> {
    return this.http.get<TenantUser[]>(`${environment.apiBaseUrl}/users`);
  }
  create(payload: CreateUserPayload): Observable<CreateUserResult> {
    return this.http.post<CreateUserResult>(`${environment.apiBaseUrl}/users`, payload);
  }
  setActive(id: string, active: boolean): Observable<SetActiveResult> {
    return this.http.patch<SetActiveResult>(`${environment.apiBaseUrl}/users/${id}`, { active });
  }
  resetPassword(id: string): Observable<ResetPasswordResult> {
    return this.http.post<ResetPasswordResult>(
      `${environment.apiBaseUrl}/users/${id}/reset-password`,
      {},
    );
  }
}
```

- [ ] **Step 4: Verde service** — `pnpm --filter @exams-generator/web test -- users.service` → PASS.

- [ ] **Step 5: Test que falla (screen)** — extiende `tenant-settings.component.spec.ts` (conserva los casos existentes del form; agrega tabs + profesores). El componente ahora inyecta `UsersService`:

```ts
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import { of } from "rxjs";
import { importProvidersFrom } from "@angular/core";
import { LucideAngularModule, Ellipsis, Plus } from "lucide-angular";
import { TenantSettingsComponent } from "./tenant-settings.component";
import { TenantSettingsService } from "./tenant-settings.service";
import { UsersService } from "../users/users.service";
import { TenantUser } from "../users/users.models";

function user(o: Partial<TenantUser> & { id: string }): TenantUser {
  return {
    id: o.id,
    email: o.email ?? "p@col.pe",
    role: o.role ?? "teacher",
    active: o.active ?? true,
    createdAt: "2026-07-18T00:00:00Z",
  };
}

function setup(
  over: {
    usersImpl?: () => unknown;
    createImpl?: () => unknown;
    setActiveImpl?: () => unknown;
    resetImpl?: () => unknown;
  } = {},
) {
  const getSettings = vi.fn(() => of({ id: "t1", name: "Colegio X", logoAssetId: null }));
  const updateSettings = vi.fn(() => of({ id: "t1", name: "Colegio X", logoAssetId: null }));
  const list = vi.fn(
    over.usersImpl ?? (() => of([user({ id: "u1" }), user({ id: "u2", active: false })])),
  );
  const create = vi.fn(
    over.createImpl ??
      (() =>
        of({ id: "u3", email: "n@col.pe", role: "teacher", temporaryPassword: "temp12345678" })),
  );
  const setActive = vi.fn(
    over.setActiveImpl ?? ((id: string, active: boolean) => of({ id, active })),
  );
  const resetPassword = vi.fn(
    over.resetImpl ?? ((id: string) => of({ id, temporaryPassword: "reset1234567" })),
  );
  TestBed.configureTestingModule({
    imports: [TenantSettingsComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Ellipsis, Plus })),
      { provide: TenantSettingsService, useValue: { getSettings, updateSettings } },
      { provide: UsersService, useValue: { list, create, setActive, resetPassword } },
    ],
  });
  const fixture = TestBed.createComponent(TenantSettingsComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    list,
    create,
    setActive,
    resetPassword,
  };
}

describe("TenantSettingsComponent — tabs", () => {
  it("shows the data tab by default", () => {
    const { compiled } = setup();
    expect(compiled.querySelector('[data-testid="tab-data-panel"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="tab-teachers-panel"]')).toBeFalsy();
  });

  it("loads and lists teachers on the teachers tab", () => {
    const { compiled, fixture, list } = setup();
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(list).toHaveBeenCalledTimes(1);
    expect(compiled.querySelectorAll('[data-testid="teacher-row"]').length).toBe(2);
  });

  it("adds a teacher and shows the temporary password once", () => {
    const { compiled, fixture, create } = setup();
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="add-teacher"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.componentInstance as unknown as { newEmail: { set(v: string): void } }).newEmail.set(
      "n@col.pe",
    );
    fixture.detectChanges();
    (
      compiled.querySelector('[data-testid="add-teacher-submit"] button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(create).toHaveBeenCalledWith({ email: "n@col.pe", role: "teacher" });
    expect(compiled.querySelector('[data-testid="temp-password"]')?.textContent).toContain(
      "temp12345678",
    );
  });

  it("deactivates a teacher from the row menu", () => {
    const { compiled, fixture, setActive } = setup();
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelectorAll('[data-testid="teacher-menu"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    (
      compiled.querySelector('[data-testid="teacher-toggle-active"] button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(setActive).toHaveBeenCalledWith("u1", false);
  });

  it("resets a teacher password and shows it once", () => {
    const { compiled, fixture, resetPassword } = setup();
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelectorAll('[data-testid="teacher-menu"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="teacher-reset"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(resetPassword).toHaveBeenCalledWith("u1");
    expect(compiled.querySelector('[data-testid="temp-password"]')?.textContent).toContain(
      "reset1234567",
    );
  });

  it("shows an empty state when there are no teachers", () => {
    const { compiled, fixture } = setup({ usersImpl: () => of([]) });
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="empty-teachers"]')).toBeTruthy();
  });
});
```

- [ ] **Step 6: Verlo fallar** — `pnpm --filter @exams-generator/web test -- tenant-settings.component` → FAIL.

- [ ] **Step 7: Implementación** — `tenant-settings.component.ts` (conserva TODO lo del form de datos; agrega tab + gestión de profesores):

```ts
import { Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { LucideAngularModule } from "lucide-angular";
import { ButtonComponent } from "../../ui/button/button.component";
import { InputComponent } from "../../ui/input/input.component";
import { SelectComponent } from "../../ui/select/select.component";
import { TagComponent } from "../../ui/tag/tag.component";
import { ModalComponent } from "../../ui/modal/modal.component";
import { TenantSettingsService } from "./tenant-settings.service";
import { TenantSettings } from "./tenant-settings.models";
import { UsersService } from "../users/users.service";
import { TenantUser, UserRole } from "../users/users.models";

type Tab = "data" | "teachers";

@Component({
  selector: "app-tenant-settings",
  standalone: true,
  imports: [
    ButtonComponent,
    InputComponent,
    SelectComponent,
    TagComponent,
    ModalComponent,
    LucideAngularModule,
  ],
  templateUrl: "./tenant-settings.component.html",
})
export class TenantSettingsComponent {
  private readonly tenantSettingsService = inject(TenantSettingsService);
  private readonly usersService = inject(UsersService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly tab = signal<Tab>("data");

  // ---- Datos y logo (form existente) ----
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly name = signal("");
  protected readonly selectedLogo = signal<File | null>(null);
  protected readonly logoPreviewUrl = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saveSuccess = signal(false);
  private readonly objectUrls: string[] = [];

  // ---- Profesores ----
  protected readonly teachers = signal<TenantUser[]>([]);
  protected readonly teachersLoading = signal(false);
  protected readonly teachersError = signal<string | null>(null);
  protected readonly teachersLoaded = signal(false);
  protected readonly openMenuId = signal<string | null>(null);
  protected readonly addOpen = signal(false);
  protected readonly newEmail = signal("");
  protected readonly newRole = signal<UserRole>("teacher");
  protected readonly tempPassword = signal<string | null>(null);
  protected readonly usersActionError = signal<string | null>(null);

  protected readonly roleOptions = [
    { value: "teacher" as UserRole, label: "Profesor" },
    { value: "school_admin" as UserRole, label: "Administra" },
  ];
  protected readonly activeCount = computed(() => this.teachers().filter((t) => t.active).length);

  constructor() {
    this.load();
    this.destroyRef.onDestroy(() => this.objectUrls.forEach((u) => URL.revokeObjectURL(u)));
  }

  protected setTab(t: Tab): void {
    this.tab.set(t);
    if (t === "teachers" && !this.teachersLoaded()) this.loadTeachers();
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.tenantSettingsService.getSettings().subscribe({
      next: (s: TenantSettings) => {
        this.loading.set(false);
        this.name.set(s.name);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set("No se pudo cargar la configuración. Inténtalo de nuevo.");
      },
    });
  }

  protected onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedLogo.set(file);
    if (!file) return;
    const url = URL.createObjectURL(file);
    this.objectUrls.push(url);
    this.logoPreviewUrl.set(url);
  }

  protected onSave(): void {
    if (this.saving()) return;
    this.saveError.set(null);
    this.saveSuccess.set(false);
    this.saving.set(true);
    const logo = this.selectedLogo();
    this.tenantSettingsService
      .updateSettings({ name: this.name(), ...(logo ? { logo } : {}) })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.saveSuccess.set(true);
        },
        error: (_e: HttpErrorResponse) => {
          this.saving.set(false);
          this.saveError.set("No se pudo guardar la configuración. Inténtalo de nuevo.");
        },
      });
  }

  private loadTeachers(): void {
    this.teachersLoading.set(true);
    this.teachersError.set(null);
    this.usersService.list().subscribe({
      next: (users) => {
        this.teachersLoading.set(false);
        this.teachersLoaded.set(true);
        this.teachers.set([...users]);
      },
      error: () => {
        this.teachersLoading.set(false);
        this.teachersError.set("No se pudieron cargar los profesores. Inténtalo de nuevo.");
      },
    });
  }

  protected initials(email: string): string {
    return email.slice(0, 2).toUpperCase();
  }
  protected roleLabel(role: string): string {
    return role === "school_admin" ? "Administra" : "Profesor";
  }
  protected toggleMenu(id: string): void {
    this.openMenuId.update((c) => (c === id ? null : id));
  }

  protected openAdd(): void {
    this.newEmail.set("");
    this.newRole.set("teacher");
    this.tempPassword.set(null);
    this.usersActionError.set(null);
    this.addOpen.set(true);
  }
  protected closeAdd(): void {
    this.addOpen.set(false);
  }
  protected submitAdd(): void {
    if (!/\S+@\S+\.\S+/.test(this.newEmail())) return;
    this.usersActionError.set(null);
    this.usersService.create({ email: this.newEmail(), role: this.newRole() }).subscribe({
      next: (res) => {
        this.tempPassword.set(res.temporaryPassword);
        this.loadTeachers();
      },
      error: () =>
        this.usersActionError.set(
          "No se pudo agregar el profesor (¿correo ya usado?). Inténtalo de nuevo.",
        ),
    });
  }

  protected toggleActive(u: TenantUser): void {
    this.openMenuId.set(null);
    this.usersActionError.set(null);
    this.usersService.setActive(u.id, !u.active).subscribe({
      next: () => this.loadTeachers(),
      error: () =>
        this.usersActionError.set("No se pudo actualizar el estado. Inténtalo de nuevo."),
    });
  }
  protected reset(u: TenantUser): void {
    this.openMenuId.set(null);
    this.usersActionError.set(null);
    this.usersService.resetPassword(u.id).subscribe({
      next: (res) => this.tempPassword.set(res.temporaryPassword),
      error: () =>
        this.usersActionError.set("No se pudo restablecer la contraseña. Inténtalo de nuevo."),
    });
  }
}
```

`tenant-settings.component.html` (tabs + panel de datos preservado + panel profesores):

```html
<div class="mx-auto max-w-3xl">
  <h1 class="mb-1 text-xl font-bold text-n900">Configuración del colegio</h1>
  <p class="mb-4 text-sm text-n500">{{ name() }}</p>

  <div class="mb-4 flex gap-1 border-b border-n200">
    <button
      type="button"
      data-testid="tab-data"
      class="px-4 py-2 text-sm font-medium"
      [class.border-b-2]="tab() === 'data'"
      [class.border-primary-500]="tab() === 'data'"
      [class.text-primary-700]="tab() === 'data'"
      [class.text-n500]="tab() !== 'data'"
      (click)="setTab('data')"
    >
      Datos y logo
    </button>
    <button
      type="button"
      data-testid="tab-teachers"
      class="px-4 py-2 text-sm font-medium"
      [class.border-b-2]="tab() === 'teachers'"
      [class.border-primary-500]="tab() === 'teachers'"
      [class.text-primary-700]="tab() === 'teachers'"
      [class.text-n500]="tab() !== 'teachers'"
      (click)="setTab('teachers')"
    >
      Profesores
    </button>
  </div>

  @if (tab() === 'data') {
  <div
    data-testid="tab-data-panel"
    class="flex flex-col gap-3 rounded-card border border-n200 bg-white p-4"
  >
    @if (loadError()) {
    <p class="rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text">{{ loadError() }}</p>
    }
    <ui-input
      label="Nombre del colegio"
      [value]="name()"
      (valueChange)="name.set($event)"
    ></ui-input>
    <div>
      <span class="text-sm text-n700">Logo</span>
      <div class="mt-1 flex items-center gap-3">
        @if (logoPreviewUrl()) {
        <img [src]="logoPreviewUrl()" alt="" class="h-16 w-16 rounded object-contain" /> }
        <input type="file" accept="image/*" class="text-sm" (change)="onLogoSelected($event)" />
      </div>
      <p class="mt-1 text-xs text-n500">Sale en el encabezado de cada examen PDF.</p>
    </div>
    @if (saveError()) {
    <p class="rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text" role="alert">
      {{ saveError() }}
    </p>
    } @if (saveSuccess()) {
    <p class="rounded-field bg-easy-bg px-3 py-2 text-sm text-easy-text" role="status">Guardado.</p>
    }
    <div>
      <ui-button variant="primary" [loading]="saving()" (clicked)="onSave()">Guardar</ui-button>
    </div>
  </div>
  } @else {
  <div data-testid="tab-teachers-panel" class="flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <p class="text-sm text-n600">{{ activeCount() }} profesores activos</p>
      <div data-testid="add-teacher">
        <ui-button variant="primary" (clicked)="openAdd()">+ Agregar profesor</ui-button>
      </div>
    </div>

    @if (usersActionError()) {
    <p class="rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text" role="alert">
      {{ usersActionError() }}
    </p>
    } @if (tempPassword(); as pw) {
    <p
      data-testid="temp-password"
      class="rounded-field bg-tint-activo px-3 py-2 text-sm text-tint-texto"
    >
      Contraseña temporal (cópiala, se muestra una sola vez):
      <span class="font-mono font-semibold">{{ pw }}</span>
    </p>
    } @if (teachersLoading()) {
    <div class="h-12 animate-pulse rounded-field bg-n100"></div>
    } @else if (teachersError()) {
    <p class="rounded-field bg-hard-bg px-3 py-2 text-sm text-hard-text">{{ teachersError() }}</p>
    } @else if (teachers().length === 0) {
    <div
      data-testid="empty-teachers"
      class="rounded-card border border-dashed border-n200 p-8 text-center text-sm text-n500"
    >
      Aún no agregas profesores.
    </div>
    } @else {
    <div class="flex flex-col gap-2">
      @for (u of teachers(); track u.id) {
      <div
        data-testid="teacher-row"
        class="flex items-center gap-3 rounded-card border border-n200 bg-white p-3"
      >
        <div
          class="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700"
        >
          {{ initials(u.email) }}
        </div>
        <div class="min-w-0 flex-1"><p class="truncate text-sm text-n900">{{ u.email }}</p></div>
        <ui-tag [variant]="u.role === 'school_admin' ? 'ai' : 'easy'"
          >{{ roleLabel(u.role) }}</ui-tag
        >
        <ui-tag [variant]="u.active ? 'easy' : 'warning-stock'"
          >{{ u.active ? 'Activo' : 'Desactivado' }}</ui-tag
        >
        <div class="relative">
          <button
            type="button"
            data-testid="teacher-menu"
            class="rounded-field p-2 text-n500 hover:bg-n50"
            (click)="toggleMenu(u.id)"
            aria-label="Más acciones"
          >
            <lucide-angular name="ellipsis" class="h-4 w-4"></lucide-angular>
          </button>
          @if (openMenuId() === u.id) {
          <div
            class="absolute right-0 z-40 mt-1 w-56 rounded-card border border-n200 bg-white py-1 shadow-lg"
          >
            <div data-testid="teacher-reset">
              <ui-button variant="ghost" (clicked)="reset(u)">Restablecer contraseña</ui-button>
            </div>
            <div data-testid="teacher-toggle-active">
              <ui-button variant="ghost" (clicked)="toggleActive(u)"
                >{{ u.active ? 'Desactivar' : 'Reactivar' }}</ui-button
              >
            </div>
          </div>
          }
        </div>
      </div>
      }
    </div>
    }
  </div>
  }

  <ui-modal [open]="addOpen()" title="Agregar profesor">
    <div class="flex flex-col gap-3">
      <ui-input
        label="Correo"
        type="email"
        [value]="newEmail()"
        (valueChange)="newEmail.set($event)"
      ></ui-input>
      <ui-select
        label="Rol"
        [options]="roleOptions"
        [value]="newRole()"
        (valueChange)="newRole.set($event)"
      ></ui-select>
      @if (tempPassword(); as pw) {
      <p class="rounded-field bg-tint-activo px-3 py-2 text-sm text-tint-texto">
        Contraseña temporal: <span class="font-mono font-semibold">{{ pw }}</span>
      </p>
      }
    </div>
    <div actions class="flex justify-end gap-2">
      <ui-button variant="ghost" (clicked)="closeAdd()">Cerrar</ui-button>
      <div data-testid="add-teacher-submit">
        <ui-button variant="primary" (clicked)="submitAdd()">Crear</ui-button>
      </div>
    </div>
  </ui-modal>
</div>
```

- [ ] **Step 8: Verde** — `pnpm --filter @exams-generator/web test -- tenant-settings.component users.service` → PASS.
- [ ] **Step 9: Commit**

```bash
git pull --rebase origin feat/ui-redesign
git add apps/web/src/app/features/users apps/web/src/app/features/tenant-settings
git commit -m "feat(web): configuracion de colegio con tabs datos y profesores (modulo users)"
```

---

## Task 12 — Verificación final (suite completa + smoke)

**Files:** ninguno (solo ejecución).

- [ ] **Step 1: Suite completa verde** — `pnpm --filter @exams-generator/web test` → TODO PASS (incluye specs de primitivos, screens y servicios). Si algún spec previo de un primitivo falla por falta de íconos lucide, agrega `importProvidersFrom(LucideAngularModule.pick({ ...los que use... }))` a su TestBed (mismo patrón de Task 1) y re-corre.
- [ ] **Step 2: Typecheck** — `pnpm --filter @exams-generator/web exec tsc -p tsconfig.app.json --noEmit` → sin errores de tipos (los templates HTML se chequean con strict templates de Angular).
- [ ] **Step 3: Smoke manual** — con backend + infra arriba (`pnpm dev:infra` y la API), corre `pnpm dev` y verifica en el navegador:
  - Login split-panel entra a `/app`; topbar muestra el nombre del colegio; menú de usuario → "Cerrar sesión" vuelve a `/login`.
  - `/app/bank`: lista paginada + panel de detalle; archivar/borrar según estado; "+ Nueva pregunta" abre tabs foto/estructurada.
  - `/app/exams`: historial con duplicar/eliminar; "Abrir ›" lleva al detalle de formas con "Usar de plantilla" y "Ver contenido".
  - `/app/ai/generate`: form no se resetea; tanda con progreso/fallos; "Revisar en la cola →".
  - `/app/ai/review`: preview PDF embebido; aprobar/rechazar avanza.
  - `/app/settings` (como school_admin): tabs Datos/Profesores; agregar profesor muestra password temporal; un teacher es redirigido a `/forbidden` por el roleGuard.
  - Fuerza un 401 (token vencido en localStorage): la app redirige a `/login?expired=1` con el aviso "Tu sesión expiró".
- [ ] **Step 4: Push final** — `git pull --rebase origin feat/ui-redesign && git push`.

---

## Self-review — cobertura del spec sección por sección

| Spec §           | Requisito                                                                             | Task              | Cubierto                                                                             |
| ---------------- | ------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ |
| Iconografía      | Sin emojis, todo Lucide (`sparkles/lock/download/check/triangle-alert/search/school`) | 1 (+ uso en 5–11) | Sí (`more-horizontal`→`ellipsis`, gap #2)                                            |
| 1. Banco         | Barra de filtros (curso/tema/nivel/grado + buscar + Nueva pregunta)                   | 5                 | Sí                                                                                   |
| 1. Banco         | Lista ~55% con fila activa borde primary + paginación S6                              | 5                 | Sí                                                                                   |
| 1. Banco         | Panel ~45% con badges/metadata/acciones Editar·Archivar·Borrar                        | 5                 | Sí (status/type/origen = gap #3, mockeado)                                           |
| 1. Banco         | Banco central solo lectura                                                            | 5                 | Sí                                                                                   |
| 1. Banco         | Empty states (banco vacío / sin resultados)                                           | 5                 | Sí                                                                                   |
| 1. Banco         | Nueva pregunta tabs foto/estructurada                                                 | 6                 | Sí                                                                                   |
| 1. Banco         | Estados cargando/error                                                                | 5, 6              | Sí                                                                                   |
| 2. Historial     | Lista índice con filtros + Nuevo examen                                               | 7                 | Sí (filtros de UI base; búsqueda/grado extensibles)                                  |
| 2. Historial     | Tarjetas-fila con estado + Abrir/Seguir armando                                       | 7                 | Sí                                                                                   |
| 2. Historial     | Menú ⋯ Usar de plantilla (S2) + Eliminar (S3, confirmación en generado)               | 7                 | Sí                                                                                   |
| 2. Historial     | Empty state                                                                           | 7                 | Sí                                                                                   |
| 2. Detalle       | Encabezado + formas + Usar de plantilla                                               | 8                 | Sí                                                                                   |
| 2. Detalle       | Descargas PDF/claves (blob autenticado); ZIP oculto (N1)                              | 8                 | Sí (reusa panel existente)                                                           |
| 2. Detalle       | Contenido colapsable "Ver contenido"                                                  | 8                 | Sí                                                                                   |
| 2. Detalle       | "Generar más formas" (paso 3 flujo maestro)                                           | 8                 | Parcial — botón vive en el flujo maestro (exam-builder, otro agente). Ver nota abajo |
| 3. IA Taller     | Form persistente (no resetea) + stepper + figura                                      | 9                 | Sí                                                                                   |
| 3. IA Taller     | Tanda con estado/progreso; fallos parciales + Reintentar N                            | 9                 | Sí                                                                                   |
| 3. IA Taller     | Empty state 1-2-3; footer a la cola                                                   | 9                 | Sí                                                                                   |
| 4. Cola revisión | Lista FIFO + activa borde primary                                                     | 10                | Sí (orden lo entrega backend S9)                                                     |
| 4. Cola revisión | Preview WYSIWYG (S7) + skeleton + fallback                                            | 10                | Sí                                                                                   |
| 4. Cola revisión | Aprobar/Editar/Rechazar + avanzar                                                     | 10                | Sí (editor inline = nota abajo)                                                      |
| 4. Cola revisión | Empty state                                                                           | 10                | Sí                                                                                   |
| 5. Config        | Tabs Datos y logo / Profesores                                                        | 11                | Sí                                                                                   |
| 5. Config        | Tabla profesores + Agregar (password temporal) + reset + desactivar                   | 11                | Sí                                                                                   |
| 5. Config        | Empty state                                                                           | 11                | Sí                                                                                   |
| 6. Login         | Panel dividido + marca + form                                                         | 4                 | Sí                                                                                   |
| 6. Shell         | Logout, 401, roleGuard, nav condicional, rename "Mis exámenes"                        | 2, 3              | Sí                                                                                   |
| 6. Shell         | Badge contador en "Cola de revisión"                                                  | —                 | **GAP #7 (abajo)**                                                                   |

### Notas de cobertura parcial / gaps residuales (para el orquestador)

- **Badge contador "Cola de revisión · N" (spec §6.6 y §4):** requiere que el shell/sidebar conozca el nº de borradores pendientes. El primitivo `NavItem` (`ui.types.ts`) NO tiene campo de badge y `ui-sidebar` no lo renderiza. Implementarlo obliga a tocar el primitivo `ui-sidebar` + `NavItem` (fuera del set "reusar primitivos") y a que el shell haga un `listDrafts()`. **No incluido** para no modificar primitivos compartidos sin coordinación; queda como follow-up: extender `NavItem` con `badge?: number` y `ui-sidebar` para pintarlo. Flagéalo.
- **"Generar más formas" / editor inline de la cola:** el botón "Generar versiones" vive en el flujo maestro (`exam-builder/**`, otro agente); el detalle de formas (Task 8) enlaza a ese flujo, no lo reimplementa. El editor estructurado de la cola (Task 10, botón `edit`) expone la acción pero el form de edición se apoya en `AiService.editDraft` existente y se deja como iteración posterior (el spec solo exige la acción visible + re-validación server-side, que el backend ya garantiza).
- **Origen IA vs Colegio en el Banco (gap #3):** hasta que el backend devuelva `origin`/`source` y `status`/`type` en `GET /bank/questions`, el panel deriva origen de `tenantId` (central vs colegio) y las acciones se gatean con los campos opcionales del modelo (mockeados en tests). Coordinar con el agente backend para exponerlos.
- **Iniciales del usuario (gap #4):** el token no trae email/nombre; el menú usa un ícono `user`. Si se quieren iniciales reales, agregar email al JWT o un `GET /users/me`.
- **Filtros avanzados del Banco (curso/tema dependientes, estado):** Task 5 implementa los filtros base (curso, tema, nivel, grado libres). El dropdown "Estado" y la dependencia tema←curso vía `TaxonomyService` son un enriquecimiento incremental sobre el mismo componente; no bloquean el contrato del spec y pueden añadirse en el mismo archivo sin cambiar firmas.

### Consistencia de firmas entre tareas (verificada)

- `ExamsService`: `listExams(ExamListFilters)→ExamListResult`, `duplicateExam(id)→DuplicateExamResult`, `deleteExam(id)→void` — usadas idénticas en Task 7 y Task 8.
- `BankService`: `listQuestionsPaged(filters,page,pageSize)→PagedQuestions`, `getQuestion(id)→BankQuestion`, `archiveQuestion(id)`, `deleteQuestion(id)`, `createStructuredQuestion(payload)→{id}` — Tasks 5 y 6.
- `AiService`: `previewDraft(id)→Blob` además de las existentes — Task 10.
- `UsersService`: `list/create/setActive/resetPassword` — Task 11, consumido solo por tenant-settings.
- Rutas: `/app/exams`(lista)·`/app/exams/new`(builder)·`/app/exams/:id`(review)·`/app/exams/:id/versions`(detalle)·`/app/bank/new`·`/app/settings`(roleGuard) — Tasks 3 y 6, sin colisión con exam-builder (solo se movió su path).
- Íconos lucide registrados una vez en Task 1; cada spec que renderiza íconos los re-provee en su TestBed (patrón uniforme).
