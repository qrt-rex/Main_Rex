// Every phone number the CRM stores is a 10-digit number (the backend checks the same rule).

/** Digits only, without a +91 / leading 0 in front of a 10-digit number. */
function normalise(value: string) {
  let d = value.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  else if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
  return d;
}

/** For onChange: keeps digits only, drops a pasted +91 / leading 0, and stops at 10 digits. */
export const phoneDigits = (value: string) => normalise(value).slice(0, 10);

/** Blank passes (optional fields); otherwise exactly 10 digits, also for older values saved as "+91 98765 43210". */
export const isPhoneOk = (value: string) => !value || /^\d{10}$/.test(normalise(value));

export const PHONE_ERROR = 'Enter a 10-digit number.';

/** Input attributes for a phone field. */
export const phoneInput = { type: 'tel', inputMode: 'numeric', maxLength: 10, placeholder: '10-digit number' } as const;
