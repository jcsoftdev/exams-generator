import {
  ApplicationConfig,
  importProvidersFrom,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
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
  Bell,
  LayoutDashboard,
  BookOpen,
  FileText,
  Inbox,
  Settings,
  History,
  Sun,
  Moon,
} from 'lucide-angular';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { authErrorInterceptor } from './core/auth/auth-error.interceptor';
import { checkTenantLookup } from './core/tenant/tenant-lookup.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(withInterceptors([authInterceptor, authErrorInterceptor])),
    provideAppInitializer(checkTenantLookup),
    provideCharts(withDefaultRegisterables()),
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
        Bell,
        LayoutDashboard,
        BookOpen,
        FileText,
        Inbox,
        Settings,
        History,
        Sun,
        Moon,
      }),
    ),
  ],
};
