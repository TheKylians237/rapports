ALTER TABLE users
  ADD COLUMN two_factor_secret varchar(64) DEFAULT NULL,
  ADD COLUMN is_2fa_enabled tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN backup_codes text DEFAULT NULL;
