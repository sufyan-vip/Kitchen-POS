-- Staff PIN security: salted hashes replace the legacy plaintext `pin` value.
-- The legacy column stays for pre-hash installs and is migrated on first login.
ALTER TABLE staff ADD COLUMN pin_hash TEXT;
ALTER TABLE staff ADD COLUMN pin_salt TEXT;
