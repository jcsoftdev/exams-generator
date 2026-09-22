import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { JsonPreviewComponent } from './json-preview.component';

/**
 * The JSON preview tool on a PUBLIC url, outside the authenticated shell.
 *
 * It is the only screen in this app reachable without a session, and it can
 * be because it has nothing to leak: `JsonPreviewComponent` injects no
 * service, issues no HTTP request and reads no tenant data — it parses text
 * the visitor themselves pasted and typesets it in their own browser. So the
 * thing being shared is the renderer, never anybody's questions.
 *
 * Exists as a wrapper rather than a second route onto the same component
 * because a page outside the shell has no topbar to render its heading, and
 * a visitor with no account needs one line telling them what this is.
 */
@Component({
  selector: 'app-public-json-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonPreviewComponent, RouterLink],
  template: `
    <main class="min-h-screen bg-n50 px-4 py-8">
      <div class="mx-auto flex max-w-3xl flex-col gap-4">
        <header class="flex flex-col gap-1">
          <h1 data-testid="public-preview-heading" class="text-2xl font-semibold text-n900">
            Preview de preguntas
          </h1>
          <p class="text-sm text-n600">
            Pega el JSON de una pregunta (o su enunciado en Typst) y mira cómo se ve tipografiada.
            Nada se guarda: todo se procesa en tu navegador.
          </p>
        </header>

        <app-json-preview></app-json-preview>

        <footer class="text-sm text-n600">
          <a data-testid="public-preview-login" routerLink="/login" class="underline">
            Iniciar sesión
          </a>
        </footer>
      </div>
    </main>
  `,
})
export class PublicJsonPreviewComponent {}
