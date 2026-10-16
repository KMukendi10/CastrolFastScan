-- Soft delete captured registrations while retaining their append-only consent
-- history. Only the authenticated deletion API uses the service role to set
-- these fields after checking the caller's active profile and record ownership.
BEGIN;

ALTER TABLE mechanics
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN deleted_by_user UUID REFERENCES profiles (id) ON DELETE SET NULL;

ALTER TABLE spares_shops
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN deleted_by_user UUID REFERENCES profiles (id) ON DELETE SET NULL;

DROP POLICY mechanics_select ON mechanics;
CREATE POLICY mechanics_select ON mechanics FOR SELECT TO authenticated
    USING (deleted_at IS NULL AND can_access(captured_by_user));

DROP POLICY mechanics_update ON mechanics;
CREATE POLICY mechanics_update ON mechanics FOR UPDATE TO authenticated
    USING (deleted_at IS NULL AND can_access(captured_by_user))
    WITH CHECK (deleted_at IS NULL AND can_access(captured_by_user));

DROP POLICY spares_shops_select ON spares_shops;
CREATE POLICY spares_shops_select ON spares_shops FOR SELECT TO authenticated
    USING (deleted_at IS NULL AND can_access(captured_by_user));

DROP POLICY spares_shops_update ON spares_shops;
CREATE POLICY spares_shops_update ON spares_shops FOR UPDATE TO authenticated
    USING (deleted_at IS NULL AND can_access(captured_by_user))
    WITH CHECK (deleted_at IS NULL AND can_access(captured_by_user));

DROP POLICY spares_visits_select ON spares_visits;
CREATE POLICY spares_visits_select ON spares_visits FOR SELECT TO authenticated
    USING (can_access(captured_by_user) AND EXISTS (
        SELECT 1 FROM spares_shops s WHERE s.shop_id = spares_visits.shop_id AND s.deleted_at IS NULL
    ));

DROP POLICY spares_visits_update ON spares_visits;
CREATE POLICY spares_visits_update ON spares_visits FOR UPDATE TO authenticated
    USING (can_access(captured_by_user) AND EXISTS (
        SELECT 1 FROM spares_shops s WHERE s.shop_id = spares_visits.shop_id AND s.deleted_at IS NULL
    ))
    WITH CHECK (can_access(captured_by_user) AND EXISTS (
        SELECT 1 FROM spares_shops s WHERE s.shop_id = spares_visits.shop_id AND s.deleted_at IS NULL
    ));

COMMIT;
