-- automaticUpdatedAt is owned exclusively by the Feishu webhook.
-- The legacy trigger treated every later edit to an imported customer as an
-- automatic update because source_message_hash remains "customer-import".
drop trigger if exists customer_automatic_updated_at_trigger on public.customer_summaries;
drop function if exists public.set_customer_automatic_updated_at();
