import { describe, expect, it } from 'vitest';
import { SHARED_NAME } from './index.js';

describe('@hm/shared', () => {
  it('exposes its package name', () => {
    expect(SHARED_NAME).toBe('@hm/shared');
  });
});
