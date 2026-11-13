import { ApiError } from '../../src/api/client';
import { uploadMessage } from '../../src/features/scan/flow';

jest.mock(
  '../../src/lib/supabase',
  () => require('../../test-utils/fakeSupabase').supabaseModuleMock,
);

describe('uploadMessage (Phase 8B limits)', () => {
  it('says a photo over the size limit is too large', () => {
    expect(uploadMessage(new ApiError('validation', 413))).toBe(
      'This photo is too large. Try another one.',
    );
  });

  it('says how long to wait when scanning too often', () => {
    expect(uploadMessage(new ApiError('rate-limited', 429, undefined, 45))).toBe(
      'Too many requests. Please try again in 45 seconds.',
    );
  });
});
