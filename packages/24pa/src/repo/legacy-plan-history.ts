// Completing a report does not prove that all audio/text deliveries arrived.
const deliveries = "pa24.outbox o where (o.dedup_key = r.outbox_key or o.dedup_key like r.outbox_key || ':%')";
const any = (condition: string) => `exists (select 1 from ${deliveries} and (${condition}))`;
export const legacyExecutionStatus = "case when r.status in ('model_done','sent') then 'completed' when r.status = 'unconfirmed' then 'needs_reconciliation' when r.status = 'delivering' then 'running' else r.status end";
export const legacyDeliveryStatus = `case when r.outbox_key is null then 'not_requested'
  when ${any("o.status = 'unknown'")} then 'unknown'
  when ${any("o.status = 'sent'")} and ${any("o.status <> 'sent'")} then 'partial'
  when ${any("o.status = 'sent'")} then 'sent'
  when ${any("o.status = 'failed'")} then 'failed'
  when ${any("o.status = 'expired'")} then 'expired'
  when ${any("o.status in ('pending','sending')")} then 'pending' else 'unknown' end`;
