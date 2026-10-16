CREATE TABLE IF NOT EXISTS notation (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  agent_id VARCHAR(36) NOT NULL,
  manager_id VARCHAR(36) NOT NULL,
  evaluation_date DATE NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notation_agent_manager_date (agent_id, manager_id, evaluation_date),
  KEY idx_notation_agent_date (agent_id, evaluation_date),
  KEY idx_notation_manager_date (manager_id, evaluation_date),
  CONSTRAINT fk_notation_agent FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notation_manager FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_notation_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- La migration 20261009_create_agent_evaluations.sql précède celle-ci.
-- Copie les anciennes notations sans supprimer la table historique.
INSERT INTO notation (id, agent_id, manager_id, evaluation_date, rating, comment, created_at, updated_at)
SELECT id, agent_id, manager_id, evaluation_date, rating, comment, created_at, updated_at
FROM agent_evaluations
ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), updated_at = VALUES(updated_at);
