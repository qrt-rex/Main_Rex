import { Check, Lock } from 'lucide-react';

export interface CatalogGroup {
  id: string;
  label: string;
  permissions: { key: string; label: string }[];
}
export interface RoleDef {
  id: string;
  label: string;
}

interface Props {
  group: CatalogGroup;
  roles: RoleDef[];
  matrix: Record<string, string[]>;
  pending: Set<string>;
  onToggle: (role: string, permission: string, granted: boolean) => void;
}

/** One module's permissions × roles. Super Admin is shown as always-on and can't be edited. */
export function PermissionMatrix({ group, roles, matrix, pending, onToggle }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
        <caption className="sr-only">{group.label} permissions by role</caption>
        <thead>
          <tr>
            <th scope="col" className="border-b border-border bg-surface-secondary px-4 py-2.5 text-left text-xs font-medium text-text-muted">Permission</th>
            {roles.map((r) => (
              <th key={r.id} scope="col" className="w-28 border-b border-border bg-surface-secondary px-2 py-2.5 text-center text-xs font-medium text-text-muted">{r.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.permissions.map((p) => (
            <tr key={p.key} className="hover:bg-surface-secondary">
              <th scope="row" className="border-b border-border px-4 py-2.5 text-left font-normal">
                <span className="block text-sm text-text">{p.label}</span>
                <code className="text-[11px] text-text-muted">{p.key}</code>
              </th>
              {roles.map((r) => {
                const locked = r.id === 'superadmin';
                const granted = locked || (matrix[r.id] ?? []).includes(p.key);
                const busy = pending.has(`${r.id}:${p.key}`);
                return (
                  <td key={r.id} className="border-b border-border px-2 py-2.5 text-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={granted}
                      aria-label={`${p.label} for ${r.label}`}
                      disabled={locked || busy}
                      title={locked ? 'Super Admin always has full access' : undefined}
                      onClick={() => onToggle(r.id, p.key, !granted)}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors
                        ${granted ? 'border-primary bg-primary text-on-primary' : 'border-border-strong bg-surface text-transparent hover:border-primary'}
                        ${locked ? 'cursor-not-allowed opacity-60' : ''} ${busy ? 'animate-pulse' : ''}`}
                    >
                      {locked ? <Lock size={11} aria-hidden="true" /> : <Check size={13} strokeWidth={3} aria-hidden="true" />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
