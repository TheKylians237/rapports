-- Add a report recipient so agents can select a service manager in their department.
-- NULL remains valid for historical submissions and is handled as an unassigned legacy report.
ALTER TABLE daily_reports
  ADD COLUMN submitted_to VARCHAR(36) NULL AFTER user_id,
  ADD INDEX idx_daily_reports_submitted_to (submitted_to),
  ADD CONSTRAINT fk_daily_reports_submitted_to FOREIGN KEY (submitted_to)
    REFERENCES users(id) ON DELETE SET NULL;
