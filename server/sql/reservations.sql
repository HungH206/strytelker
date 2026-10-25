CREATE TABLE IF NOT EXISTS toyo_customers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS toyo_reservations (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES toyo_customers(id),
  journey_hash TEXT NOT NULL UNIQUE,
  vehicle_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL,
  receipt JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS toyo_reservation_plans (
  reservation_id UUID PRIMARY KEY REFERENCES toyo_reservations(id),
  finance JSONB, quote JSONB NOT NULL, insurance JSONB, offer_id TEXT
);
CREATE TABLE IF NOT EXISTS toyo_reservation_events (
  id UUID PRIMARY KEY,
  reservation_id UUID NOT NULL REFERENCES toyo_reservations(id),
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS toyo_reservations_created_idx ON toyo_reservations(created_at DESC);
CREATE INDEX IF NOT EXISTS toyo_events_reservation_idx ON toyo_reservation_events(reservation_id, created_at);
