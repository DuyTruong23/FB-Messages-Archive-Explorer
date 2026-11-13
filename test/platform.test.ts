import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAndroidApp } from '../src/config/platform';

describe('isAndroidApp', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is false in the web build', () => {
    expect(isAndroidApp()).toBe(false);
  });

  it('is true in android mode', () => {
    vi.stubEnv('MODE', 'android');
    expect(isAndroidApp()).toBe(true);
  });
});
