-- Migration additive : daily_reports devient l'en-tête canonique.
-- Sauvegarder la base avant exécution. Ne supprime aucune table ni ancienne colonne.

ALTER TABLE daily_reports
  ADD COLUMN review_comment TEXT NULL,
  ADD COLUMN reviewed_by VARCHAR(36) NULL,
  ADD COLUMN reviewed_at DATETIME NULL,
  ADD INDEX idx_daily_reports_reviewed_by (reviewed_by),
  ADD CONSTRAINT fk_daily_reports_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

-- Référence canonique UUID pour les activités liées aux anciens rapports int.
ALTER TABLE report_activities
  ADD COLUMN daily_report_id VARCHAR(36) CHARACTER SET utf8 COLLATE utf8_general_ci NULL,
  MODIFY COLUMN report_id INT(11) NULL,
  ADD INDEX idx_report_activities_daily_report_id (daily_report_id);

-- Aligne les statuts d'approbation sur la convention draft/submitted/approved/rejected.
ALTER TABLE daily_reports DROP CONSTRAINT `daily_reports.STATUS`;
UPDATE daily_reports
   SET status = CASE LOWER(TRIM(status))
     WHEN 'pending' THEN 'submitted'
     WHEN 'validated' THEN 'approved'
     WHEN 'valide' THEN 'approved'
     WHEN 'validé' THEN 'approved'
     ELSE status END;
ALTER TABLE daily_reports
  ADD CONSTRAINT chk_daily_reports_status CHECK (status IN ('draft', 'submitted', 'approved', 'rejected'));

-- Crée un rapport journalier pour les anciens en-têtes reports sans équivalent.
INSERT INTO daily_reports
  (id, user_id, report_date, total_hours, status, general_comments, created_at, updated_at)
SELECT UUID(), legacy.user_id, legacy.report_date, COALESCE(SUM(ra.hours), 0), 'submitted',
       MAX(legacy.comments), MIN(legacy.created_at), CURRENT_TIMESTAMP()
  FROM reports legacy
  LEFT JOIN report_activities ra ON ra.report_id = legacy.id
  LEFT JOIN daily_reports current_report
    ON current_report.user_id = legacy.user_id
   AND current_report.report_date = legacy.report_date
 WHERE current_report.id IS NULL
 GROUP BY legacy.user_id, legacy.report_date;

-- Relie toutes les activités historiques à l'en-tête canonique de même agent/date.
UPDATE report_activities ra
JOIN reports legacy ON legacy.id = ra.report_id
JOIN daily_reports canonical
  ON canonical.user_id = legacy.user_id
 AND canonical.report_date = legacy.report_date
SET ra.daily_report_id = canonical.id
WHERE ra.daily_report_id IS NULL;

-- Conserve l'ancien identifiant entier à titre d'historique, sans ambiguïté.
ALTER TABLE report_activities
  CHANGE COLUMN report_id legacy_report_id INT(11) NULL;

-- Valider que la migration a relié toutes les activités avant de rendre le lien obligatoire.
SELECT COUNT(*) AS activities_without_daily_report
  FROM report_activities WHERE daily_report_id IS NULL;

SET @unlinked_activities = (SELECT COUNT(*) FROM report_activities WHERE daily_report_id IS NULL);
SET @activity_fk_sql = IF(
  @unlinked_activities = 0,
  'ALTER TABLE report_activities MODIFY COLUMN daily_report_id VARCHAR(36) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL, ADD CONSTRAINT fk_report_activities_daily_report FOREIGN KEY (daily_report_id) REFERENCES daily_reports(id) ON DELETE CASCADE',
  'SELECT ''Migration interrompue : corriger les activités sans rapport canonique avant ajout de la clé étrangère.'' AS migration_status'
);
PREPARE activity_fk_stmt FROM @activity_fk_sql;
EXECUTE activity_fk_stmt;
DEALLOCATE PREPARE activity_fk_stmt;

-- `reports` est conservée temporairement ; legacy_report_id garde l'ancien lien int pour audit.
