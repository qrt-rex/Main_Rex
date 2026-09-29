import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { Button } from '../../components/common/Button';
import { Checkbox, Input, Select, Textarea } from '../../components/common/Input';
import { PublicShell, SectionTitle } from './PublicShell';

const POLICY: [string, string][] = [
  ['Purpose', 'This document sets out the employment standards, responsibilities and terms governing your engagement with the Company.'],
  ['Employment terms', 'Your employment is subject to satisfactory verification of educational credentials, previous employment references, background checks and identity proofs.'],
  ['Roles and responsibilities', 'You agree to perform all duties assigned to you with the highest standard of professional integrity, dedication and diligence.'],
  ['Compensation and benefits', 'Your monthly salary is calculated and paid as per your offer letter, including statutory deductions such as Provident Fund (PF) and Professional Tax (PT).'],
  ['Work hours', 'Standard working hours are 9 hours per day including breaks, Monday to Friday, with flexibility as project and operational needs require.'],
  ['Leave policy', 'Employees are entitled to earned leave, sick leave and public holidays as set out in the Rexera leave guidelines.'],
  ['Confidentiality', 'You shall keep all proprietary information, client data, business strategies and intellectual property of Rexera confidential, during and after your employment.'],
  ['Code of conduct', 'Rexera has zero tolerance for discrimination, harassment, unethical conduct or actions harmful to the company’s reputation.'],
  ['Disciplinary action', 'Violations of company policy may lead to disciplinary proceedings, up to and including immediate termination and legal recourse.'],
  ['Performance reviews', 'Formal performance reviews are held twice a year to evaluate goals, achievements and career progression.'],
  ['Termination', 'Either party may end employment by serving the notice period, or salary in lieu of it, as defined in your offer letter.'],
  ['Digital acknowledgement', 'By submitting this form and ticking the declaration, you confirm you have read, understood and agree to all the terms here.'],
  ['Governing law', 'This agreement is governed by the laws of India, under the jurisdiction of the courts of Hyderabad, Telangana.'],
];

const EMPTY = {
  full_name: '', parent_name: '', date_of_birth: '', gender: 'Male', marital_status: 'Single', nationality: 'Indian', blood_group: 'O+',
  mobile_number: '', alternate_mobile: '', permanent_address: '', correspondence_address: '',
  aadhaar_number: '', pan_number: '', emergency_contact_name: '', emergency_contact_number: '', emergency_contact_relation: '',
  bank_name: '', account_no: '', confirm_account_no: '', ifsc_code: '', signature_name: '',
};
type Form = typeof EMPTY;

/**
 * Public onboarding for a selected candidate (was joining-login.html + joining-form.html):
 * joining token -> code emailed to the invited address -> 3-step form -> employee record.
 * The server re-checks the token, the verified code and every ID/bank format.
 */
export function JoiningPortal() {
  const [stage, setStage] = useState<'token' | 'otp' | 'form' | 'done'>('token');
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState(1);
  const [f, setF] = useState<Form>(EMPTY);
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message: string; employee_code?: string } | null>(null);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const fail = (err: unknown, fallback: string) => setErrors({ form: err instanceof ApiError ? err.message : fallback });

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
    } catch (err) {
      fail(err, fallback);
    } finally {
      setBusy(false);
    }
  };

  const checkToken = (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return setErrors({ token: 'Enter the joining token from your offer email.' });
    run(async () => {
      const res = await api.post<{ valid: boolean; message: string; token: string; email?: string; full_name?: string }>('/api/joining/validate-token', { token: token.trim() });
      if (!res.valid) return setErrors({ token: res.message });
      setToken(res.token);
      setEmail(res.email ?? '');
      setF((s) => ({ ...s, full_name: s.full_name || res.full_name || '' }));
      setInfo(res.message);
      setStage('otp');
    }, 'Could not check the token.');
  };

  const checkOtp = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) return setErrors({ otp: 'Enter the 6-digit code.' });
    run(async () => {
      await api.post('/api/joining/verify-token-otp', { token, otp });
      setStage('form');
    }, 'Could not verify the code.');
  };

  const resend = () => run(async () => {
    await api.post('/api/otp/send', { email, purpose: 'onboarding' });
    setInfo(`A new code has been sent to ${email}.`);
  }, 'Could not resend the code.');

  const validate = (n: number): boolean => {
    const er: Record<string, string> = {};
    const need = (k: keyof Form, msg: string) => { if (!f[k].trim()) er[k] = msg; };
    if (n === 1) {
      need('full_name', 'Enter your full legal name.');
      need('parent_name', "Enter your father's or mother's name.");
      need('date_of_birth', 'Enter your date of birth.');
      if (f.mobile_number.replace(/\D/g, '').length < 10) er.mobile_number = 'Enter a 10-digit mobile number.';
      need('permanent_address', 'Enter your permanent address.');
      need('correspondence_address', 'Enter your current address.');
    }
    if (n === 2) {
      if (!/^\d{12}$/.test(f.aadhaar_number.replace(/[\s-]/g, ''))) er.aadhaar_number = 'Aadhaar must be exactly 12 digits.';
      if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(f.pan_number.trim().toUpperCase())) er.pan_number = 'PAN format is 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).';
      need('emergency_contact_name', 'Enter an emergency contact.');
      if (f.emergency_contact_number.replace(/\D/g, '').length < 10) er.emergency_contact_number = 'Enter a 10-digit phone number.';
      need('emergency_contact_relation', 'Enter the relationship.');
      need('bank_name', 'Enter your bank name.');
      need('account_no', 'Enter your account number.');
      if (f.account_no.trim() !== f.confirm_account_no.trim()) er.confirm_account_no = 'Account numbers do not match.';
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifsc_code.trim().toUpperCase())) er.ifsc_code = 'IFSC format is like HDFC0001024.';
    }
    setErrors(er);
    return !Object.keys(er).length;
  };

  const next = () => {
    if (!validate(step)) return;
    if (step === 2 && !f.signature_name) setF((s) => ({ ...s, signature_name: s.full_name }));
    setStep(step + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!agreed) return setErrors({ agreed: 'You must accept the HR policy agreement.' });
    if (!f.signature_name.trim()) return setErrors({ signature_name: 'Type your full legal name as your signature.' });
    run(async () => {
      const { confirm_account_no: _confirm, signature_name, ...rest } = f;
      void _confirm;
      const res = await api.post<{ message: string; employee_code?: string }>('/api/joining/submit-onboarding', {
        ...Object.fromEntries(Object.entries(rest).map(([k, x]) => [k, x.trim()])),
        token, email,
        aadhaar_number: f.aadhaar_number.replace(/[\s-]/g, ''),
        pan_number: f.pan_number.trim().toUpperCase(),
        ifsc_code: f.ifsc_code.trim().toUpperCase(),
        family_contact: '',
        agreement: { accepted: true, signature_name: signature_name.trim() },
      });
      setResult(res);
      setStage('done');
    }, 'Could not submit onboarding.');
  };

  if (stage === 'done' && result) {
    return (
      <PublicShell title="Onboarding complete" width="max-w-xl">
        <div className="py-6 text-center">
          <CheckCircle2 size={48} className="mx-auto text-success" aria-hidden="true" />
          <p className="mx-auto mt-3 max-w-md text-sm text-text-secondary">{result.message}</p>
          {result.employee_code && (
            <div className="mx-auto mt-5 max-w-xs rounded-md border border-border bg-surface-secondary p-4">
              <p className="text-xs text-text-muted">Your employee code</p>
              <p className="mt-1 font-mono text-2xl font-bold text-text">{result.employee_code}</p>
            </div>
          )}
          <p className="mt-5 text-xs text-text-muted">Your details and policy agreement have been recorded. You can close this window.</p>
        </div>
      </PublicShell>
    );
  }

  if (stage === 'token' || stage === 'otp') {
    return (
      <PublicShell title="Onboarding portal" description="For candidates who have received a joining token from Rexera HR." width="max-w-md">
        {stage === 'token' ? (
          <form onSubmit={checkToken} noValidate className="space-y-4">
            <Input label="Joining token" required value={token} onChange={(e) => setToken(e.target.value.toUpperCase())} error={errors.token}
              placeholder="REX-A1B2C3" inputClassName="text-center font-mono tracking-widest" hint="Printed in your offer email." autoFocus />
            {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
            <Button type="submit" loading={busy} className="w-full justify-center">Verify token</Button>
          </form>
        ) : (
          <form onSubmit={checkOtp} noValidate className="space-y-4">
            <div className="flex items-start gap-2 rounded-md bg-surface-secondary p-3 text-sm text-text-secondary">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
              <span>{info || `We sent a 6-digit code to ${email}.`}</span>
            </div>
            <Input label="Verification code" required inputMode="numeric" autoComplete="one-time-code" value={otp} error={errors.otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputClassName="text-center font-mono text-lg tracking-[0.4em]" autoFocus />
            {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
            <Button type="submit" loading={busy} className="w-full justify-center">Verify and open the form</Button>
            <div className="flex justify-between text-xs">
              <button type="button" className="text-text-muted hover:text-text" onClick={() => { setStage('token'); setOtp(''); setErrors({}); }}>Use a different token</button>
              <button type="button" className="font-medium text-primary hover:underline disabled:opacity-50" disabled={busy} onClick={resend}>Resend code</button>
            </div>
          </form>
        )}
      </PublicShell>
    );
  }

  const steps = ['Personal info', 'ID and banking', 'HR policy agreement'];
  return (
    <PublicShell title="Employee onboarding" description={`Signed in with token ${token} · ${email}`}>
      <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s} aria-current={step === i + 1 ? 'step' : undefined}
            className={`rounded-md border px-3 py-2 text-xs font-medium ${step === i + 1 ? 'border-primary bg-primary text-on-primary' : step > i + 1 ? 'border-success text-success' : 'border-border text-text-muted'}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      <form onSubmit={submit} noValidate>
        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full legal name (as on Aadhaar / PAN)" required value={f.full_name} onChange={set('full_name')} error={errors.full_name} />
            <Input label="Father / mother name" required value={f.parent_name} onChange={set('parent_name')} error={errors.parent_name} />
            <Input label="Date of birth" type="date" required value={f.date_of_birth} onChange={set('date_of_birth')} error={errors.date_of_birth} />
            <Select label="Gender" value={f.gender} onChange={set('gender')}>{['Male', 'Female', 'Other'].map((x) => <option key={x}>{x}</option>)}</Select>
            <Select label="Marital status" value={f.marital_status} onChange={set('marital_status')}>{['Single', 'Married', 'Other'].map((x) => <option key={x}>{x}</option>)}</Select>
            <Input label="Nationality" value={f.nationality} onChange={set('nationality')} />
            <Select label="Blood group" value={f.blood_group} onChange={set('blood_group')}>{['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map((x) => <option key={x}>{x}</option>)}</Select>
            <Input label="Mobile number" type="tel" required value={f.mobile_number} onChange={set('mobile_number')} error={errors.mobile_number} />
            <Input label="Alternate number" type="tel" value={f.alternate_mobile} onChange={set('alternate_mobile')} />
            <Input label="Email" value={email} disabled hint="The address your invitation was sent to." />
            <Textarea label="Permanent address" required value={f.permanent_address} onChange={set('permanent_address')} error={errors.permanent_address} />
            <Textarea label="Current address" required value={f.correspondence_address} onChange={set('correspondence_address')} error={errors.correspondence_address} />
          </div>
        )}
        {step === 2 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Aadhaar number" required maxLength={14} placeholder="1234 5678 9012" value={f.aadhaar_number} onChange={set('aadhaar_number')} error={errors.aadhaar_number} />
              <Input label="PAN" required maxLength={10} placeholder="ABCDE1234F" value={f.pan_number} onChange={(e) => setF((s) => ({ ...s, pan_number: e.target.value.toUpperCase() }))} error={errors.pan_number} />
            </div>
            <SectionTitle>Emergency contact</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Name" required value={f.emergency_contact_name} onChange={set('emergency_contact_name')} error={errors.emergency_contact_name} />
              <Input label="Phone" type="tel" required value={f.emergency_contact_number} onChange={set('emergency_contact_number')} error={errors.emergency_contact_number} />
              <Input label="Relationship" required placeholder="e.g. Spouse / Father" value={f.emergency_contact_relation} onChange={set('emergency_contact_relation')} error={errors.emergency_contact_relation} />
            </div>
            <SectionTitle>Salary bank account</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Bank name" required value={f.bank_name} onChange={set('bank_name')} error={errors.bank_name} />
              <Input label="IFSC code" required maxLength={11} placeholder="HDFC0001024" value={f.ifsc_code} onChange={(e) => setF((s) => ({ ...s, ifsc_code: e.target.value.toUpperCase() }))} error={errors.ifsc_code} />
              <Input label="Account number" required value={f.account_no} onChange={set('account_no')} error={errors.account_no} autoComplete="off" />
              <Input label="Confirm account number" required value={f.confirm_account_no} onChange={set('confirm_account_no')} error={errors.confirm_account_no} autoComplete="off" onPaste={(e) => e.preventDefault()} />
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <p className="mb-3 text-sm text-text-muted">Please read the policy carefully. Signing it is required to complete enrolment.</p>
            <div className="max-h-80 space-y-3 overflow-y-auto rounded-md border border-border bg-surface-secondary p-4 text-sm" tabIndex={0} aria-label="HR policy agreement">
              {POLICY.map(([h, p], i) => (
                <div key={h}><p className="font-medium text-text">{i + 1}. {h}</p><p className="text-text-secondary">{p}</p></div>
              ))}
            </div>
            <div className="mt-4 space-y-4">
              <Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)} label={`I have read, understood and agree to all ${POLICY.length} sections of the Rexera HR policy agreement.`} />
              {errors.agreed && <p role="alert" className="text-xs text-danger">{errors.agreed}</p>}
              <Input label="Digital signature (your full legal name)" required value={f.signature_name} onChange={set('signature_name')} error={errors.signature_name} className="sm:max-w-sm" />
            </div>
          </>
        )}
        {errors.form && <p role="alert" className="mt-4 text-sm text-danger">{errors.form}</p>}
        <div className="mt-6 flex justify-between gap-3">
          {step > 1 ? <Button variant="secondary" onClick={() => { setErrors({}); setStep(step - 1); }}><ArrowLeft size={15} /> Back</Button> : <span />}
          {step < 3
            ? <Button onClick={next}>Next <ArrowRight size={15} /></Button>
            : <Button type="submit" loading={busy}>Accept and complete onboarding</Button>}
        </div>
      </form>
    </PublicShell>
  );
}
