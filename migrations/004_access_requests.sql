-- Samostalna prijava korisnika uz odobrenje administratora organizacije.
-- Prijava je moguća samo preko linka organizacije (podrazumevano isključen);
-- novi nalog dobija članstvo u statusu 'pending', bez ikakvog pristupa podacima.
ALTER TABLE tenant_memberships DROP CONSTRAINT tenant_memberships_status_check;
ALTER TABLE tenant_memberships ADD CONSTRAINT tenant_memberships_status_check
  CHECK (status IN ('active', 'inactive', 'pending'));

ALTER TABLE tenant_settings ADD COLUMN signup_token text;
CREATE UNIQUE INDEX tenant_settings_signup_token_idx ON tenant_settings(signup_token) WHERE signup_token IS NOT NULL;

CREATE FUNCTION app_signup_token() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.signup_token', true), '') $$;

-- Posetilac sa važećim linkom sme da pročita samo naziv organizacije tog linka.
CREATE POLICY tenant_settings_signup ON tenant_settings FOR SELECT
  USING (signup_token IS NOT NULL AND signup_token = app_signup_token());
CREATE POLICY tenants_signup ON tenants FOR SELECT USING (
  EXISTS (SELECT 1 FROM tenant_settings s WHERE s.tenant_id = tenants.id AND s.signup_token = app_signup_token())
);

-- Odbijen zahtev se briše; postojeća (aktivna ili isključena) članstva ne mogu se brisati.
CREATE POLICY memberships_delete_pending ON tenant_memberships FOR DELETE
  USING (tenant_id = app_tenant_id() AND status = 'pending');
CREATE INDEX tenant_memberships_pending_idx ON tenant_memberships(tenant_id, created_at) WHERE status = 'pending';
