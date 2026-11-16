import { CollaborationForm } from "@/components/collaboration-form";
import { StatusSelect } from "@/components/controls";
import { CollaborationStatusBadge, PageHeader } from "@/components/ui";
import { COLLABORATION_STATUSES } from "@/lib/domain";
import { formatDateTime } from "@/lib/format";
import { load } from "@/server/page";
import { getCollaboration } from "@/server/services/collaborations";
import { getLookups } from "@/server/services/lookups";
import { requireSession } from "@/server/session";
import { labels } from "@/i18n";

export const metadata = { title: "Saradnja" };

export default async function CollaborationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireSession();
  const k = await load(getCollaboration(ctx, id));
  const lookups = await getLookups(ctx);
  return (
    <>
      <PageHeader
        title={k.title}
        description={`${k.clientName} · kreirano ${formatDateTime(k.createdAt)} · poslednja izmena ${formatDateTime(k.updatedAt)}`}
        actions={
          ctx.perms.edit ? (
            <StatusSelect kind="collaboration" id={id} value={k.status} options={COLLABORATION_STATUSES.map((s) => ({ value: s, label: labels.collaborationStatus[s] }))} />
          ) : (
            <CollaborationStatusBadge status={k.status} />
          )
        }
      />
      <CollaborationForm
        key={k.updatedAt.toISOString()}
        id={id}
        readOnly={!ctx.perms.edit}
        lookups={lookups}
        clients={[{ id: k.clientId, name: k.clientName }]}
        initial={{
          clientId: k.clientId, serviceId: k.serviceId, title: k.title, description: k.description ?? "",
          startDate: k.startDate ?? "", plannedEndDate: k.plannedEndDate ?? "", status: k.status,
          contractValue: k.contractValue ?? "", currency: k.currency, responsibleUserId: k.responsibleUserId ?? "", note: k.note ?? "",
        }}
      />
    </>
  );
}
