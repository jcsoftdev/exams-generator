import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DashboardStats } from './dashboard.models';

/**
 * Angular client for `GET /dashboard/stats` (design doc §4) — mirrors
 * `BankService`'s shape: `inject(HttpClient)`, one method per endpoint. The
 * bearer JWT is attached automatically by `authInterceptor`.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  getStats(): Observable<DashboardStats> {
    return this.http.get<DashboardStats>(`${environment.apiBaseUrl}/dashboard/stats`);
  }
}
