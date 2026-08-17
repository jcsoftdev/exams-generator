import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('GeneraExamen');

  constructor() {
    /**
     * Injected for its constructor side effect only (see ThemeService's own
     * doc comment): applies any previously-stored explicit theme choice to
     * `document.documentElement` before any route renders. `App` wraps every
     * route via `<router-outlet>` (`app.html`), including `/login`, which
     * `ShellComponent` does not. Not stored as a field — this repo's
     * `noUnusedLocals` tsconfig setting rejects a private field that's never
     * read after assignment.
     */
    inject(ThemeService);
  }
}
