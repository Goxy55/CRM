-- Row Level Security. Aplikacija na početku svake transakcije postavlja
-- kontekst (app.tenant_id, app.user_id ...); bez konteksta upit ne vidi ništa.
-- FORCE znači da pravila važe i za vlasnika tabela.
CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app_user_id() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
CREATE FUNCTION app_is_platform() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.platform', true), '') = 'on' $$;
CREATE FUNCTION app_invite_hash() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.invite_hash', true), '') $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants', 'tenant_settings', 'platform_admins', 'profiles',
    'tenant_memberships', 'invitations', 'business_activities', 'production_categories',
    'services', 'clients', 'client_person_details', 'client_business_details',
    'agricultural_holdings', 'client_productions', 'collaborations', 'audit_logs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
  -- Poslovne tabele: isključivo aktivna organizacija. Administrator platforme
  -- nema pravilo koje bi mu dalo pristup ovim podacima.
  FOREACH t IN ARRAY ARRAY['tenant_settings', 'business_activities', 'production_categories',
    'services', 'clients', 'client_person_details', 'client_business_details',
    'agricultural_holdings', 'client_productions', 'collaborations']
  LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

CREATE POLICY tenants_select ON tenants FOR SELECT USING (
  id = app_tenant_id() OR app_is_platform()
  OR EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = tenants.id AND m.user_id = app_user_id())
);
CREATE POLICY tenants_insert ON tenants FOR INSERT WITH CHECK (app_is_platform());
CREATE POLICY tenants_update ON tenants FOR UPDATE
  USING (id = app_tenant_id() OR app_is_platform())
  WITH CHECK (id = app_tenant_id() OR app_is_platform());

CREATE POLICY platform_admins_select ON platform_admins FOR SELECT
  USING (user_id = app_user_id() OR app_is_platform());
CREATE POLICY platform_admins_insert ON platform_admins FOR INSERT WITH CHECK (app_is_platform());

CREATE POLICY memberships_select ON tenant_memberships FOR SELECT
  USING (tenant_id = app_tenant_id() OR user_id = app_user_id() OR app_is_platform());
CREATE POLICY memberships_insert ON tenant_memberships FOR INSERT
  WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY memberships_update ON tenant_memberships FOR UPDATE
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  user_id = app_user_id() OR app_is_platform()
  OR EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id = profiles.user_id AND m.tenant_id = app_tenant_id())
);
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (user_id = app_user_id());
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());

CREATE POLICY invitations_all ON invitations
  USING (tenant_id = app_tenant_id() OR app_is_platform() OR token_hash = app_invite_hash())
  WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform() OR token_hash = app_invite_hash());

-- Evidencija: samo čitanje i dodavanje. Bez pravila za UPDATE/DELETE te radnje
-- su zabranjene, a okidač ih dodatno odbija.
CREATE POLICY audit_select ON audit_logs FOR SELECT
  USING (tenant_id = app_tenant_id() OR (tenant_id IS NULL AND app_is_platform()));
CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (tenant_id = app_tenant_id() OR (tenant_id IS NULL AND app_is_platform()));
