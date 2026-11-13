/**
 * Form validation for sign-in and sign-up (react-hook-form + zod, AGENTS.md §8).
 * Password rule from SignUp.html: at least 8 characters with a number.
 */
import { z } from 'zod';

const email = z
  .string()
  .trim()
  .min(1, { error: 'Enter your email.' })
  .pipe(z.email({ error: 'Enter a valid email address.' }));

export const signInSchema = z.object({
  email,
  password: z.string().min(1, { error: 'Enter your password.' }),
  keepSignedIn: z.boolean(),
});

export const PASSWORD_MIN = 8;
/** Supabase (bcrypt) ignores anything past 72 bytes, so longer passwords are refused up front. */
export const PASSWORD_MAX = 72;

/** New-password rule shared by sign-up and password reset (mirrors Supabase's settings). */
const newPassword = z
  .string()
  .min(PASSWORD_MIN, { error: `Use at least ${PASSWORD_MIN} characters.` })
  .max(PASSWORD_MAX, { error: `Use ${PASSWORD_MAX} characters or fewer.` })
  .regex(/\d/, { error: 'Add at least one number.' });

export const signUpSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, { error: 'Enter your full name.' })
      .max(100, { error: 'Use 100 characters or fewer.' }),
    email,
    password: newPassword,
    confirmPassword: z.string().min(1, { error: 'Type your password again.' }),
    // RA 10173: both consents are required (DESIGN_HANDOFF.md §5.6).
    acceptTerms: z
      .boolean()
      .refine((v) => v, { error: 'Accept the Terms of Use and Privacy Notice to continue.' }),
    dataConsent: z.boolean().refine((v) => v, { error: 'Consent to data processing to continue.' }),
  })
  .refine((v) => !v.confirmPassword || v.password === v.confirmPassword, {
    error: "Passwords don't match.",
    path: ['confirmPassword'],
  });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password: newPassword,
    confirmPassword: z.string().min(1, { error: 'Type your new password again.' }),
  })
  .refine((v) => !v.confirmPassword || v.password === v.confirmPassword, {
    error: "Passwords don't match.",
    path: ['confirmPassword'],
  });

export type SignInInput = z.input<typeof signInSchema>;
export type SignInValues = z.output<typeof signInSchema>;
export type SignUpInput = z.input<typeof signUpSchema>;
export type SignUpValues = z.output<typeof signUpSchema>;

export type ForgotPasswordValues = z.output<typeof forgotPasswordSchema>;
export type ResetPasswordValues = z.output<typeof resetPasswordSchema>;

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string };

/**
 * Rough strength for the 4-segment meter. One point each for: length ≥ 8, a number,
 * mixed case, and a symbol or length ≥ 12. Anything under 8 characters stays "Too short".
 */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: '' };
  if (password.length < PASSWORD_MIN) return { score: 1, label: 'Too short' };
  let score = 1;
  if (/\d/.test(password)) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password) || password.length >= 12) score += 1;
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'] as const;
  return { score: score as PasswordStrength['score'], label: labels[score] };
}
