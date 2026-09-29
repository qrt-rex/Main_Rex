import { useState, type FormEvent } from 'react';
import { CheckCircle2, Plus, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { Button } from '../../components/common/Button';
import { Checkbox, Input, Select, Textarea } from '../../components/common/Input';
import { PublicShell, SectionTitle } from './PublicShell';

type Row = Record<string, string>;

const EDU = [['degree', 'Degree / qualification', 'B.Tech / MCA / B.Com'], ['institution', 'Institution', 'College / university'], ['year', 'Year', '2022'], ['grade', 'Grade', '8.5 CGPA / 75%']] as const;
const EXP = [['company', 'Company', 'Company name'], ['role', 'Role', 'Designation'], ['duration', 'Duration', 'Jan 2022 – Present'], ['responsibilities', 'Key responsibilities', 'What you did']] as const;
const SKILL = [['name', 'Skill', 'e.g. Excel / GST filing'], ['comments', 'Years / remarks', 'e.g. 3 years']] as const;
const LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];

const blank = (cols: readonly (readonly [string, string, string])[], extra: Row = {}): Row => ({ ...Object.fromEntries(cols.map(([k]) => [k, ''])), ...extra });

/** Rows of small inputs that can be added and removed (education, experience, skills). */
function Rows({ label, cols, rows, onChange, make, level }: {
  label: string; cols: readonly (readonly [string, string, string])[]; rows: Row[]; onChange: (r: Row[]) => void; make: () => Row; level?: boolean;
}) {
  const set = (i: number, k: string, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-border p-2 sm:grid-cols-[repeat(var(--n),minmax(0,1fr))_auto] sm:border-0 sm:p-0" style={{ ['--n' as string]: cols.length + (level ? 1 : 0) }}>
          {cols.map(([k, name, ph]) => (
            <Input key={k} aria-label={`${label} ${i + 1}: ${name}`} placeholder={ph} value={r[k]} onChange={(e) => set(i, k, e.target.value)} />
          ))}
          {level && (
            <Select aria-label={`${label} ${i + 1}: level`} value={r.proficiency} onChange={(e) => set(i, 'proficiency', e.target.value)}>
              {LEVELS.map((l) => <option key={l}>{l}</option>)}
            </Select>
          )}
          <Button variant="ghost" size="icon" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <X size={15} />
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={() => onChange([...rows, make()])}><Plus size={14} /> Add {label.toLowerCase()}</Button>
    </div>
  );
}

/** Public candidate interview application (was the old portal's index.html). Posts to /api/candidates. */
export function CandidateApply() {
  const empty = {
    candidate_name: '', position_applied: '', email: '', contact_number: '', interview_date: '', current_company: '', total_experience: '',
    current_ctc: '', expected_ctc: '', notice_period: '30 Days', languages_known: '', hobbies: '', strengths: '', weaknesses: '',
  };
  const [v, setV] = useState(empty);
  const [education, setEducation] = useState<Row[]>([blank(EDU)]);
  const [experience, setExperience] = useState<Row[]>([blank(EXP)]);
  const [skills, setSkills] = useState<Row[]>([blank(SKILL, { proficiency: 'Intermediate' })]);
  const [declared, setDeclared] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (v.candidate_name.trim().length < 2) er.candidate_name = 'Enter your full name.';
    if (!v.position_applied.trim()) er.position_applied = 'Enter the position you are applying for.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) er.email = 'Enter a valid email address.';
    if (v.contact_number.replace(/\D/g, '').length < 10) er.contact_number = 'Enter a 10-digit mobile number.';
    if (!education.some((r) => r.degree.trim())) er.education = 'Add at least your highest qualification.';
    if (!declared) er.declared = 'Please accept the declaration.';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      const trim = (rows: Row[], key: string) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x.trim()]))).filter((r) => r[key]);
      const res = await api.post<{ message?: string }>('/api/candidates', {
        ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()])),
        education: trim(education, 'degree'), work_experience: trim(experience, 'company'), skills: trim(skills, 'name'), declaration_accepted: true,
      });
      setDone(res.message || 'Your application has been submitted.');
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'Could not submit the application. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <PublicShell title="Application submitted">
        <div className="py-8 text-center">
          <CheckCircle2 size={48} className="mx-auto text-success" aria-hidden="true" />
          <p className="mx-auto mt-3 max-w-md text-sm text-text-secondary">{done} Thank you for applying to Rexera. Our talent acquisition team will review your profile.</p>
          <Button className="mt-6" variant="secondary" onClick={() => { setDone(''); setV(empty); setEducation([blank(EDU)]); setExperience([blank(EXP)]); setSkills([blank(SKILL, { proficiency: 'Intermediate' })]); setDeclared(false); }}>Submit another application</Button>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell title="Candidate interview application" description="Please complete these details accurately. The Rexera talent acquisition team will review your profile.">
      <form onSubmit={submit} noValidate>
        <SectionTitle>1. Basic and position details</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Full name" required value={v.candidate_name} onChange={set('candidate_name')} error={errors.candidate_name} autoComplete="name" />
          <Input label="Position applied for" required value={v.position_applied} onChange={set('position_applied')} error={errors.position_applied} />
          <Input label="Email address" type="email" required value={v.email} onChange={set('email')} error={errors.email} autoComplete="email" />
          <Input label="Mobile number" type="tel" required value={v.contact_number} onChange={set('contact_number')} error={errors.contact_number} autoComplete="tel" />
          <Input label="Interview date" type="date" value={v.interview_date} onChange={set('interview_date')} />
          <Input label="Current organisation" value={v.current_company} onChange={set('current_company')} />
          <Input label="Total work experience" placeholder="e.g. 3.5 years" value={v.total_experience} onChange={set('total_experience')} />
          <Select label="Notice period" value={v.notice_period} onChange={set('notice_period')}>
            {['Immediate', '15 Days', '30 Days', '60 Days', '90 Days'].map((p) => <option key={p}>{p}</option>)}
          </Select>
          <Input label="Current CTC" placeholder="e.g. ₹8,00,000 per year" value={v.current_ctc} onChange={set('current_ctc')} />
          <Input label="Expected CTC" placeholder="e.g. ₹12,00,000 per year" value={v.expected_ctc} onChange={set('expected_ctc')} />
        </div>

        <SectionTitle>2. Educational qualifications</SectionTitle>
        <p className="mb-2 text-xs text-text-muted">Highest qualification first.</p>
        <Rows label="Degree" cols={EDU} rows={education} onChange={setEducation} make={() => blank(EDU)} />
        {errors.education && <p role="alert" className="mt-1 text-xs text-danger">{errors.education}</p>}

        <SectionTitle>3. Work experience</SectionTitle>
        <Rows label="Experience" cols={EXP} rows={experience} onChange={setExperience} make={() => blank(EXP)} />

        <SectionTitle>4. Skills</SectionTitle>
        <Rows label="Skill" cols={SKILL} rows={skills} onChange={setSkills} make={() => blank(SKILL, { proficiency: 'Intermediate' })} level />

        <SectionTitle>5. Additional information</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Languages known" value={v.languages_known} onChange={set('languages_known')} />
          <Input label="Hobbies and interests" value={v.hobbies} onChange={set('hobbies')} />
          <Textarea label="Key strengths" value={v.strengths} onChange={set('strengths')} />
          <Textarea label="Areas for improvement" value={v.weaknesses} onChange={set('weaknesses')} />
        </div>

        <div className="mt-6 rounded-md border border-border bg-surface-secondary p-4">
          <Checkbox checked={declared} onChange={(e) => setDeclared(e.target.checked)}
            label="I declare that the details above are true and correct to the best of my knowledge. I understand that a false statement may lead to disqualification or termination of employment." />
          {errors.declared && <p role="alert" className="mt-1 text-xs text-danger">{errors.declared}</p>}
        </div>
        {errors.form && <p role="alert" className="mt-4 text-sm text-danger">{errors.form}</p>}
        <div className="mt-6 flex justify-center">
          <Button type="submit" loading={busy} className="min-w-56 justify-center">Submit application</Button>
        </div>
      </form>
    </PublicShell>
  );
}
