ALTER TABLE report_issues
  ADD COLUMN activity_id INT NULL AFTER report_id,
  ADD KEY idx_report_issues_activity_id (activity_id),
  ADD CONSTRAINT fk_report_issues_activity
    FOREIGN KEY (activity_id) REFERENCES report_activities(id) ON DELETE SET NULL;
