-- ============================================================================
-- Real fix for the click-tracking endpoint's ''::uuid RLS-cast crash
-- (2026-09-03) — the SAME documented bug class already found and fixed
-- dozens of times in this project (record_email_open, redeem_referral_
-- click, get_client_portal_token, etc.): candidate_messages has FORCE ROW
-- LEVEL SECURITY, and the click-tracking endpoint is a real, anonymous,
-- no-tenant-context caller (the recipient's own email client clicking a
-- link, exactly like the tracking pixel) — a raw UPDATE through
-- db.system_conn() (app.tenant_id='') throws `invalid input syntax for
-- type uuid: ""` on the RLS policy's own cast, silently swallowed by the
-- endpoint's broad try/except. Confirmed live via a real click-tracking
-- test before writing this fix, not assumed.
--
-- One SECURITY DEFINER function handles the whole real flow atomically
-- (the click count/timestamps update, the thread bump, and the sender
-- notification) — a SECURITY DEFINER function runs its ENTIRE body with
-- the owner's (postgres, bypasses RLS) privileges, not just its first
-- statement, avoiding the need for several separate RLS-unsafe writes
-- from the Python layer. Run as postgres (this table's real owner,
-- confirmed via pg_tables before sql/108 — same as record_email_open).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_link_click(p_token text, p_is_download boolean)
  RETURNS TABLE(out_id uuid, out_subject text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_tenant_id uuid;
  v_sent_by uuid;
  v_thread_id uuid;
  v_subject text;
BEGIN
  UPDATE candidate_messages
  SET link_click_count = link_click_count + 1,
      first_link_click_at = COALESCE(first_link_click_at, now()),
      last_link_click_at = now(),
      last_activity_at = now(),
      attachment_download_count = attachment_download_count + (CASE WHEN p_is_download THEN 1 ELSE 0 END),
      first_attachment_download_at = CASE WHEN p_is_download
        THEN COALESCE(first_attachment_download_at, now()) ELSE first_attachment_download_at END,
      last_attachment_download_at = CASE WHEN p_is_download THEN now() ELSE last_attachment_download_at END
  WHERE tracking_token = p_token::uuid
  RETURNING id, tenant_id, sent_by, thread_id, subject
  INTO v_id, v_tenant_id, v_sent_by, v_thread_id, v_subject;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  IF v_thread_id IS NOT NULL THEN
    UPDATE email_threads
    SET last_activity_at = now(), last_direction = 'inbound',
        message_count = message_count + 1, reply_count = reply_count + 1
    WHERE id = v_thread_id;
  END IF;

  IF v_sent_by IS NOT NULL THEN
    INSERT INTO notifications (tenant_id, user_id, recipient_user_id, title, body, type, resource, resource_id, channel)
    VALUES (
      v_tenant_id, v_sent_by, v_sent_by,
      CASE WHEN p_is_download THEN 'Attachment downloaded' ELSE 'Link clicked' END,
      'Your email "' || COALESCE(v_subject, '(no subject)') || '" — a link was just ' ||
        (CASE WHEN p_is_download THEN 'downloaded' ELSE 'clicked' END) || '.',
      'info', 'candidate_message', v_id, 'inapp'
    );
  END IF;

  RETURN QUERY SELECT v_id, v_subject;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_link_click(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_link_click(text, boolean) TO app_user;
