-- Unread counts for the badges are computed from these rows on every page,
-- so each is a scan of a small partial index rather than of all history.
create index if not exists notifications_unread_idx on notifications (user_id) where read_at is null;
create index if not exists messages_unread_idx on messages (conversation_id, sender_id) where read_at is null;
