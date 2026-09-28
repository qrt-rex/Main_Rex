import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** The permission that makes this entity exist for a user. Without it the item is invisible. */
  permission: string;
  description?: string;
  /** Module not built yet: renders a "not configured" page instead of real functionality. */
  placeholder?: boolean;
  /** Match the path exactly (for section index routes). */
  end?: boolean;
}

export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  items: NavItem[];
}
