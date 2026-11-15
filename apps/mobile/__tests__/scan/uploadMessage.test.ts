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

  it("shows the server's message when today's scan limit is reached", () => {
    const detail =
      "You've reached today's limit of 50 receipt scans. You can still add this expense manually.";
    const problem = {
      type: 'urn:lunti:problem:ocr-daily-limit',
      title: 'Too Many Requests',
      status: 429,
      detail,
      errors: [],
    };
    expect(uploadMessage(new ApiError('rate-limited', 429, problem, 40000))).toBe(detail);
  });

  it("shows the server's message when the app-wide limit is reached", () => {
    const detail =
      "Receipt scanning has reached today's limit. Please enter this receipt manually or try again tomorrow.";
    const problem = {
      type: 'urn:lunti:problem:service-unavailable',
      title: 'Service Unavailable',
      status: 503,
      detail,
      errors: [],
    };
    expect(uploadMessage(new ApiError('unavailable', 503, problem, 40000))).toBe(detail);
  });
});
