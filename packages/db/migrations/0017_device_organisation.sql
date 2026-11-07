-- 0017: a device belongs to one organisation (offline devices review, ADR 0019).
-- * Spaces can be made on a device only for clinics of its organisation.
-- * Any active staff member of that organisation may send the device's waiting results (the outbox secret), even
--   without a space of their own; a space secret still goes only to its owner.
-- * A ticket is acted on only for a therapist who holds or held a space on the ticket's device (or who sends it
--   themselves): act_for_ticket can no longer take on an arbitrary user id.
-- Expand-only.

ALTER TABLE app.device ADD COLUMN organization_id uuid REFERENCES app.organization(id);
UPDATE app.device d SET organization_id = (
  SELECT m.organization_id FROM app.membership m
   WHERE m.user_id = d.created_by AND m.status = 'active'
   ORDER BY (m.clinic_id IS NULL), m.organization_id LIMIT 1)
 WHERE d.organization_id IS NULL;

DROP POLICY device_insert ON app.device;
CREATE POLICY device_insert ON app.device FOR INSERT
  WITH CHECK (created_by = app.current_user_id()
              AND organization_id IN (SELECT m.organization_id FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active'));

CREATE OR REPLACE FUNCTION app.device_org(p_device uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT organization_id FROM app.device WHERE id = p_device
$$;

-- May this user use the device (send its outbox, see it)? An active member of its organisation, or a space holder.
CREATE OR REPLACE FUNCTION app.may_use_device(p_device uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM app.membership m JOIN app.device d ON d.id = p_device
             WHERE m.user_id = p_user AND m.status = 'active' AND m.organization_id = d.organization_id)
    OR app.has_space_on(p_device, p_user))
$$;

-- Has this user ever had a space on the device (ended ones count: their tickets stay good for their life)?
CREATE OR REPLACE FUNCTION app.held_space_on(p_device uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.device_space s WHERE s.device_id = p_device AND s.user_id = p_user)
$$;

DROP POLICY space_insert ON app.device_space;
CREATE POLICY space_insert ON app.device_space FOR INSERT
  WITH CHECK (user_id = app.current_user_id()
              AND app.has_clinic_role(clinic_id, ARRAY['therapist', 'assistant', 'clinic_manager', 'org_admin']::app.member_role[])
              AND EXISTS (SELECT 1 FROM app.clinic c WHERE c.id = clinic_id AND c.organization_id = app.device_org(device_id)));

CREATE OR REPLACE FUNCTION app.act_for_ticket(p_therapist uuid, p_device uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  uploader uuid := app.current_user_id();
BEGIN
  IF uploader IS NULL
     OR NOT EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = uploader AND m.status = 'active')
     OR NOT (uploader = p_therapist
             OR (p_device IS NOT NULL AND app.may_use_device(p_device, uploader) AND app.held_space_on(p_device, p_therapist))) THEN
    RAISE EXCEPTION 'ticketed_ingest_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.uploader_id', uploader::text, true);
  PERFORM set_config('app.ticket_actor', p_therapist::text, true);
  PERFORM set_config('app.user_id', p_therapist::text, true);
END $$;

GRANT SELECT ON app.device, app.device_space, app.membership, app.clinic TO emb_rls_helper;
ALTER FUNCTION app.device_org(uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.may_use_device(uuid, uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.held_space_on(uuid, uuid) OWNER TO emb_rls_helper;
REVOKE EXECUTE ON FUNCTION app.device_org(uuid), app.may_use_device(uuid, uuid), app.held_space_on(uuid, uuid), app.has_space_on(uuid, uuid), app.device_exists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.device_org(uuid), app.may_use_device(uuid, uuid), app.held_space_on(uuid, uuid), app.has_space_on(uuid, uuid), app.device_exists(uuid) TO emb_app;

-- Reading and touching the device row follows "may use the device" (the outbox secret route reads it).
DROP POLICY device_read ON app.device;
CREATE POLICY device_read ON app.device FOR SELECT
  USING (created_by = app.current_user_id() OR app.may_use_device(id, app.current_user_id()));
DROP POLICY device_touch ON app.device;
CREATE POLICY device_touch ON app.device FOR UPDATE
  USING (created_by = app.current_user_id() OR app.may_use_device(id, app.current_user_id()));
