import { beforeAll, describe, expect, it } from 'vitest';
import type * as searchModule from '../src/services/search';

let search: typeof searchModule;

beforeAll(async () => {
  Object.defineProperty(globalThis, 'window', { value: { location: { hostname: 'test' } }, configurable: true });
  search = await import('../src/services/search');
});

describe('normalize', () => {
  it('folds Vietnamese tone marks, case and whitespace', () => {
    for (const input of ['lỗi', 'LỖI', 'lôi', 'loi', '  Lỗi ', 'lỗi']) {
      expect(search.normalize(input)).toBe('loi');
    }
    expect(search.normalize('  Tin   nhắn\n đã  XÓA ')).toBe('tin nhan da xoa');
  });

  it('folds đ and Đ, which NFD leaves intact', () => {
    expect(search.normalize('Đường đi')).toBe('duong di');
  });

  it('returns an empty string for empty input', () => {
    expect(search.normalize('')).toBe('');
  });

  it('keeps diacritics in the exact-accent form', () => {
    expect(search.foldCaseForSearch('  LỖI   Đây ')).toBe('lỗi đây');
  });

  it('highlights the original accented text for an unaccented query', () => {
    expect(search.highlightText('Bị lỗi đường truyền', 'loi duong')).toBe(
      'Bị <span class="search-highlight">lỗi đường</span> truyền'
    );
    expect(search.highlightText('Bị lỗi', 'loi', false)).toBe('Bị lỗi');
    expect(search.highlightText('Bị LỖI', 'lỗi', false)).toBe('Bị <span class="search-highlight">LỖI</span>');
  });
});
