CREATE TABLE IF NOT EXISTS agent_evaluations (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  agent_id VARCHAR(36) NOT NULL,
  manager_id VARCHAR(36) NOT NULL,
  evaluation_date DATE NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_agent_evaluations_manager_day (agent_id, manager_id, evaluation_date),
  KEY idx_agent_evaluations_agent_date (agent_id, evaluation_date),
  CONSTRAINT chk_agent_evaluations_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_agent_evaluations_agent FOREIGN KEY (agent_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_evaluations_manager FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;
