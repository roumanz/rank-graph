CREATE TABLE IF NOT EXISTS `ranking_types` (
  `id` INT NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE IF NOT EXISTS `ranking_snapshots` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `type_id` INT NOT NULL,
  `ranking_date` DATE NOT NULL,
  `fetched_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `rows_count` INT NOT NULL DEFAULT 0,
  UNIQUE KEY `uniq_type_date` (`type_id`, `ranking_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE IF NOT EXISTS `rankings` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `type_id` INT NOT NULL,
  `ranking_date` DATE NOT NULL,
  `reg_no` VARCHAR(16) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `club` VARCHAR(16) NOT NULL,
  `gender` CHAR(1) DEFAULT NULL,
  `rank_pos` INT NOT NULL,
  UNIQUE KEY `uniq_entry` (`type_id`, `ranking_date`, `reg_no`),
  KEY `idx_reg_no` (`reg_no`),
  KEY `idx_name` (`name`),
  KEY `idx_club` (`club`),
  KEY `idx_type_date` (`type_id`, `ranking_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;
