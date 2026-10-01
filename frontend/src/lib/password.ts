// Same rule as the API (backend/app/utils/validators.py, require_strong_password).
export const PASSWORD_RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: '8 to 16 characters', test: (p) => p.length >= 8 && p.length <= 16 },
  { label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'A number', test: (p) => /\d/.test(p) },
  { label: 'A special symbol (e.g. @ # $ !)', test: (p) => /[^A-Za-z0-9\s]/.test(p) },
];

export const isStrongPassword = (p: string) => PASSWORD_RULES.every((r) => r.test(p));
