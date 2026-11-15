-- Poslovni model. Sve tabele organizacije nose tenant_id; složeni strani
-- ključevi (tenant_id, id) sprečavaju povezivanje zapisa različitih organizacija.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  default_currency text NOT NULL DEFAULT 'RSD' CHECK (default_currency ~ '^[A-Z]{3}$'),
  locale text NOT NULL DEFAULT 'sr-Latn',
  logo_mime text CHECK (logo_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  logo_data bytea CHECK (octet_length(logo_data) <= 262144),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_admins (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id text NOT NULL REFERENCES profiles(user_id),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  can_view boolean NOT NULL DEFAULT true,
  can_create boolean NOT NULL DEFAULT true,
  can_edit boolean NOT NULL DEFAULT true,
  can_export boolean NOT NULL DEFAULT false,
  can_view_sensitive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX tenant_memberships_user_idx ON tenant_memberships(user_id);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  can_view boolean NOT NULL DEFAULT true,
  can_create boolean NOT NULL DEFAULT true,
  can_edit boolean NOT NULL DEFAULT true,
  can_export boolean NOT NULL DEFAULT false,
  can_view_sensitive boolean NOT NULL DEFAULT false,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_tenant_idx ON invitations(tenant_id, created_at DESC);

CREATE TABLE business_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX business_activities_name_idx ON business_activities(tenant_id, lower(name));

CREATE TABLE production_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX production_categories_name_idx ON production_categories(tenant_id, lower(name));

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  description text,
  category text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX services_name_idx ON services(tenant_id, lower(name));

-- Osnovni identitet klijenta. Podaci specifični za ulogu (lice, poslovni
-- subjekt, gazdinstvo) nalaze se u zasebnim tabelama.
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  type text NOT NULL CHECK (type IN ('person', 'farm', 'entrepreneur', 'company')),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 240),
  status text NOT NULL DEFAULT 'potential'
    CHECK (status IN ('potential', 'contacted', 'negotiation', 'active', 'inactive', 'archived')),
  activity_id uuid,
  responsible_user_id text,
  -- Fizičko lice (takođe klijent) koje stoji iza gazdinstva ili radnje.
  linked_person_id uuid,
  phone text,
  phone_digits text GENERATED ALWAYS AS (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) STORED,
  email text,
  address text,
  city text,
  municipality text,
  first_contact_date date,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (linked_person_id IS NULL OR linked_person_id <> id),
  FOREIGN KEY (tenant_id, activity_id) REFERENCES business_activities(tenant_id, id),
  FOREIGN KEY (tenant_id, responsible_user_id) REFERENCES tenant_memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, linked_person_id) REFERENCES clients(tenant_id, id)
);
CREATE INDEX clients_status_idx ON clients(tenant_id, status);
CREATE INDEX clients_updated_idx ON clients(tenant_id, updated_at DESC);
CREATE INDEX clients_created_idx ON clients(tenant_id, created_at DESC);
CREATE INDEX clients_name_idx ON clients(tenant_id, lower(display_name));
CREATE INDEX clients_municipality_idx ON clients(tenant_id, municipality);
CREATE INDEX clients_email_idx ON clients(tenant_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX clients_phone_idx ON clients(tenant_id, phone_digits) WHERE phone_digits IS NOT NULL;
CREATE INDEX clients_responsible_idx ON clients(tenant_id, responsible_user_id);
CREATE INDEX clients_activity_idx ON clients(tenant_id, activity_id);

CREATE TABLE client_person_details (
  client_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  -- JMBG: šifrovana vrednost (AES-256-GCM) i HMAC otisak za tačno poklapanje.
  jmbg_ciphertext text,
  jmbg_hash text,
  CHECK ((jmbg_ciphertext IS NULL) = (jmbg_hash IS NULL)),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX client_person_jmbg_idx ON client_person_details(tenant_id, jmbg_hash) WHERE jmbg_hash IS NOT NULL;

CREATE TABLE client_business_details (
  client_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_name text NOT NULL,
  registration_number text CHECK (registration_number ~ '^[0-9]{8}$'),
  tax_number text CHECK (tax_number ~ '^[0-9]{9}$'),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX client_business_mb_idx ON client_business_details(tenant_id, registration_number) WHERE registration_number IS NOT NULL;
CREATE UNIQUE INDEX client_business_pib_idx ON client_business_details(tenant_id, tax_number) WHERE tax_number IS NOT NULL;

CREATE TABLE agricultural_holdings (
  client_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  bpg text CHECK (bpg ~ '^[0-9]{12}$'),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX agricultural_holdings_bpg_idx ON agricultural_holdings(tenant_id, bpg) WHERE bpg IS NOT NULL;

CREATE TABLE client_productions (
  client_id uuid NOT NULL,
  production_category_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  PRIMARY KEY (client_id, production_category_id),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, production_category_id) REFERENCES production_categories(tenant_id, id)
);
CREATE UNIQUE INDEX client_productions_primary_idx ON client_productions(client_id) WHERE is_primary;
CREATE INDEX client_productions_category_idx ON client_productions(tenant_id, production_category_id);

CREATE TABLE collaborations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  client_id uuid NOT NULL,
  service_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description text,
  start_date date,
  planned_end_date date,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'negotiation', 'contracted', 'in_progress', 'completed', 'cancelled')),
  contract_value numeric(14, 2) CHECK (contract_value >= 0),
  currency text NOT NULL DEFAULT 'RSD' CHECK (currency ~ '^[A-Z]{3}$'),
  responsible_user_id text,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (planned_end_date IS NULL OR start_date IS NULL OR planned_end_date >= start_date),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id),
  FOREIGN KEY (tenant_id, responsible_user_id) REFERENCES tenant_memberships(tenant_id, user_id)
);
CREATE INDEX collaborations_client_idx ON collaborations(tenant_id, client_id);
CREATE INDEX collaborations_status_idx ON collaborations(tenant_id, status);
CREATE INDEX collaborations_service_idx ON collaborations(tenant_id, service_id);
CREATE INDEX collaborations_updated_idx ON collaborations(tenant_id, updated_at DESC);

-- Evidencija aktivnosti. Zapisi se samo dodaju; izmena i brisanje su zabranjeni.
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  user_id text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  client_id uuid,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tenant_idx ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX audit_logs_client_idx ON audit_logs(tenant_id, client_id, created_at DESC) WHERE client_id IS NOT NULL;

CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs: zapisi se ne mogu menjati niti brisati';
END $$;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants', 'tenant_settings', 'profiles', 'tenant_memberships',
    'business_activities', 'production_categories', 'services', 'clients', 'collaborations']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
