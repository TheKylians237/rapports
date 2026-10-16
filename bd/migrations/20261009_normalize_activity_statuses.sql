-- Normalize activity progress to the two supported states.
-- Existing blocked/in-progress/unknown values become Pending; completed aliases become Completed.
UPDATE report_activities
SET status = CASE
  WHEN LOWER(TRIM(status)) IN ('completed', 'complete', 'done', 'finished', 'terminee', 'terminée', 'realisee', 'réalisée', 'achevee', 'achevée') THEN 'Completed'
  ELSE 'Pending'
END;

ALTER TABLE report_activities
  MODIFY COLUMN status VARCHAR(36) NOT NULL DEFAULT 'Pending',
  ADD CONSTRAINT chk_report_activities_status CHECK (status IN ('Completed', 'Pending'));
