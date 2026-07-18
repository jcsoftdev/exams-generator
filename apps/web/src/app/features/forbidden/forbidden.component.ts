import { Component } from '@angular/core';

@Component({
  selector: 'app-forbidden',
  template: `
    <main class="forbidden">
      <h1>403 - Forbidden</h1>
      <p>You do not have permission to access this page.</p>
    </main>
  `,
})
export class ForbiddenComponent {}
