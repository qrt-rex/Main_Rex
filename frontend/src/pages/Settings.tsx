import { useSearchParams } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { dateTime } from '../lib/format';
import { Avatar } from '../components/common/Avatar';
import { Button } from '../components/common/Button';
import { Card, CardHeader } from '../components/common/Card';
import { Tabs } from '../components/common/Tabs';
import { ThemeOptions } from '../components/common/ThemeSelector';
import { useConfirm } from '../components/common/ConfirmDialog';
import { PageHeader } from '../components/layout/PageHeader';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'security', label: 'Security' },
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-text">{value}</dd>
    </div>
  );
}

export function Settings() {
  const { user, logout } = useAuth();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'profile';
  if (!user) return null;
  const name = user.username || user.email;

  const signOut = async () => {
    const ok = await confirm({ title: 'Sign out?', message: 'This ends your session on this device. You will need your password and a verification code to sign in again.', confirmText: 'Sign out' });
    if (ok) await logout('manual');
  };

  return (
    <>
      <PageHeader title="Settings" description="Your account, appearance and session." />
      <Tabs tabs={TABS} active={tab} onChange={(id) => setParams({ tab: id }, { replace: true })} className="mb-5" />

      {tab === 'profile' && (
        <Card className="max-w-3xl">
          <CardHeader title="Profile" description="Managed by your administrator." />
          <div className="px-4">
            <div className="flex items-center gap-3 border-b border-border py-4">
              <Avatar name={name} size={44} />
              <div className="min-w-0">
                <p className="truncate font-semibold text-text">{name}</p>
                <p className="truncate text-sm text-text-muted">{user.role_label}</p>
              </div>
            </div>
            <dl className="divide-y divide-border">
              <Row label="Email" value={user.email} />
              <Row label="Role" value={user.role_label} />
              <Row label="Access" value={`${user.permissions.length} permission${user.permissions.length === 1 ? '' : 's'}`} />
              <Row label="Last sign-in" value={dateTime(user.last_login)} />
            </dl>
          </div>
        </Card>
      )}

      {tab === 'preferences' && (
        <Card className="max-w-3xl">
          <CardHeader title="Appearance" description="Saved on this device and applied across every module." />
          <div className="p-4"><ThemeOptions /></div>
        </Card>
      )}

      {tab === 'security' && (
        <Card className="max-w-3xl">
          <CardHeader title="Security" />
          <div className="divide-y divide-border px-4">
            <div className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="text-sm font-medium text-text">Two-factor authentication</p>
                <p className="text-sm text-text-muted">A code is emailed to you on every sign-in.</p>
              </div>
              <span className="text-sm font-medium text-success">Enabled</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="text-sm font-medium text-text">Password</p>
                <p className="text-sm text-text-muted">Use "Forgot password?" on the sign-in page to set a new one.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="text-sm font-medium text-text">Sign out</p>
                <p className="text-sm text-text-muted">Ends your session on the server and on this device.</p>
              </div>
              <Button variant="secondary" onClick={signOut}><LogOut size={15} /> Sign out</Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
