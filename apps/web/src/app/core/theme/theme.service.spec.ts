import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThemeService } from './theme.service';

const THEME_STORAGE_KEY = 'theme';

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  );
}

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('resolves a stored "dark" preference on construction and applies it to the DOM', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    stubMatchMedia(false); // system prefers light — the stored value must still win

    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);

    expect(service.mode()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resolves a stored "light" preference on construction and applies it to the DOM', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    stubMatchMedia(true); // system prefers dark — the stored value must still win

    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);

    expect(service.mode()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('falls back to the system preference via matchMedia when nothing is stored', () => {
    stubMatchMedia(true); // system prefers dark

    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);

    expect(service.mode()).toBe('dark');
    // No explicit choice yet — the CSS media query handles it; the service
    // must NOT set the attribute itself in this branch (design doc §2).
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('falls back to light when the system has no dark preference and nothing is stored', () => {
    stubMatchMedia(false);

    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);

    expect(service.mode()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('toggle() flips the signal, sets the DOM attribute, and persists to localStorage', () => {
    stubMatchMedia(false); // resolves to 'light' initially

    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);
    expect(service.mode()).toBe('light');

    service.toggle();

    expect(service.mode()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('toggle() back to light updates the DOM attribute and localStorage again', () => {
    stubMatchMedia(false);
    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);

    service.toggle(); // light -> dark
    service.toggle(); // dark -> light

    expect(service.mode()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});
