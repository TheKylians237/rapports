ALTER TABLE report_issues
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'Pending' AFTER needs_manager_help,
  ADD COLUMN reviewed_by VARCHAR(36) NULL AFTER status,
  ADD COLUMN reviewed_at DATETIME NULL AFTER reviewed_by,
  ADD COLUMN review_comment TEXT NULL AFTER reviewed_at,
  ADD KEY idx_report_issues_status_created (status, created_at),
  ADD CONSTRAINT fk_report_issues_reviewed_by
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
