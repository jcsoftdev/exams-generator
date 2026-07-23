-- =============================================================================
-- OPT-IN: Row-Level Security for tenant isolation (defense-in-depth)
-- =============================================================================
-- STATUS: NOT applied automatically. This file is intentionally OUTSIDE the
-- Drizzle migration journal (`drizzle/_journal.json`) so `db:migrate` never
-- runs it. It is a reviewed-rollout template, not a ready migration.
--
-- WHY NOT AUTO-APPLIED: tenant isolation is currently enforced in the
-- application layer (assertCanManageTenant / questionVisibility). RLS adds a
-- second, database-enforced layer — but enabling it WITHOUT the app-side
-- wiring below makes every policy default-DENY and breaks 100% of queries,
-- because the pooled connection has no per-request tenant context.
--
-- REQUIRED APP WIRING before enabling (all three):
--   1. The app DB role must NOT be the table owner and must NOT have BYPASSRLS
--      (owners/superusers bypass RLS silently). Create a dedicated `app_rw`
--      role and connect as it.
--   2. Per request/transaction, set the tenant context:
--         SET LOCAL app.tenant_id = '<uuid>';        -- NULL/absent for platform staff
--         SET LOCAL app.is_platform_staff = 'on'|'off';
--      Wire this in a Nest middleware/interceptor that opens a transaction per
--      request and issues the SET LOCAL from the JWT (AuthTokenPayload).
--   3. A security review of the write policies (INSERT/UPDATE/DELETE) — the
--      central-vs-tenant management rule (platform staff manage tenant_id IS
--      NULL; school staff manage their own tenant_id) must be expressed as
--      policies, mirroring canManageQuestionTenant().
--
-- The block below covers the READ (visibility) path for `questions` as the
-- reference case. Replicate for `exams` (tenant_id NOT NULL — simpler: strict
-- equality) and `assets` before enabling. Writes are left as TODO on purpose.
-- =============================================================================

-- Helper: current tenant from the connection setting (NULL when unset).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_is_platform_staff() RETURNS boolean AS $$
  SELECT coalesce(current_setting('app.is_platform_staff', true), 'off') = 'on';
$$ LANGUAGE sql STABLE;

-- --- questions: visibility (central rows OR own-tenant rows) ------------------
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions FORCE ROW LEVEL SECURITY;

CREATE POLICY questions_select_visibility ON questions
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = app_current_tenant()
    OR app_is_platform_staff()
  );

-- TODO(write policies): INSERT/UPDATE/DELETE mirroring canManageQuestionTenant()
--   - platform staff (app_is_platform_staff()) may manage rows where tenant_id IS NULL
--   - school staff may manage rows where tenant_id = app_current_tenant()
-- CREATE POLICY questions_write_central ON questions FOR ALL
--   USING (...) WITH CHECK (...);

-- --- exams: TODO — tenant_id is NOT NULL, so strict equality -----------------
-- ALTER TABLE exams ENABLE ROW LEVEL SECURITY;  ... USING (tenant_id = app_current_tenant())

-- --- assets: TODO — tenant_id is nullable (central logos etc.) ---------------
