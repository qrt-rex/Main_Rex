import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import { navItem, sections } from '../modules/registry';

/** Page for a registered CRM module whose workflows haven't been specified yet. */
export function ModulePage({ id }: { id: string }) {
  const item = navItem(id);
  const section = sections.find((s) => s.items.some((i) => i.id === id))!;
  return (
    <>
      <PageHeader title={item.label} description={item.description} breadcrumbs={[{ label: section.label }, { label: item.label }]} />
      <Card>
        <EmptyState
          icon={item.icon}
          title={`${item.label} isn't set up yet`}
          description="This module is registered in the CRM and protected by its own permission. Its records and workflows will appear here once the module is configured."
        />
      </Card>
    </>
  );
}
