/**
 * IT Dashboard — now routes to the full IT Command Center.
 *
 * The original basic view is superseded by the comprehensive multi-section
 * command centre in `src/it/ItCommandCenter.tsx`.  This file stays as the
 * export surface so existing imports (`./ItDashboard`) keep working without
 * changing `RoleDashboard.tsx` or `App.tsx`.
 */
export { ItCommandCenter as ItDashboard } from '../it/ItCommandCenter';
