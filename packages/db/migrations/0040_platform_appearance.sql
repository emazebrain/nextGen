-- 0040: platform appearance — one background (theme default, a solid colour, or an uploaded image) for every user.
-- A single row. The image lives in the row itself: it is small (the API caps it at 3 MB), read rarely (browsers
-- keep it by version) and must survive redeploys on hosts whose disk does not.
-- Nothing here is patient data. Anyone may read it (the sign-in page shows it); only platform admins change it.

CREATE TABLE app.platform_appearance (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  kind         text NOT NULL DEFAULT 'default' CHECK (kind IN ('default', 'color', 'image')),
  color        text CHECK (color ~ '^#[0-9a-f]{6}$'),
  blur         text NOT NULL DEFAULT 'light' CHECK (blur IN ('none', 'light', 'strong')),
  image        bytea,
  image_mime   text CHECK (image_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  image_sha256 bytea,
  version      integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES app.app_user(id),
  CONSTRAINT appearance_color_set CHECK (kind <> 'color' OR color IS NOT NULL),
  CONSTRAINT appearance_image_set CHECK (kind <> 'image' OR (image IS NOT NULL AND image_mime IS NOT NULL)),
  CONSTRAINT appearance_image_size CHECK (image IS NULL OR octet_length(image) <= 3145728)
);

INSERT INTO app.platform_appearance (id) VALUES (true);

ALTER TABLE app.platform_appearance ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.platform_appearance FORCE ROW LEVEL SECURITY;

CREATE POLICY appearance_read ON app.platform_appearance FOR SELECT USING (true);
-- The admin check is inlined (see 0036): helper functions recurse on hosts where the owner cannot bypass RLS.
CREATE POLICY appearance_write ON app.platform_appearance FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- The row is never inserted or deleted by the app: there is exactly one.
GRANT SELECT, UPDATE ON app.platform_appearance TO emb_app;
