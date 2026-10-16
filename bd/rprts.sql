-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Hôte : 127.0.0.1
-- Généré le : ven. 09 oct. 2026 à 03:01
-- Version du serveur : 10.4.32-MariaDB
-- Version de PHP : 8.0.30

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de données : `rprts`
--
CREATE DATABASE IF NOT EXISTS rprts CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. Sélectionner la base de données
USE rprts;
-- --------------------------------------------------------

--
-- Structure de la table `audit_logs`
--

CREATE TABLE `audit_logs` (
  `id` int(11) NOT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `action` varchar(255) NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Structure de la table `daily_reports`
--

CREATE TABLE `daily_reports` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `report_date` date NOT NULL,
  `report_hours` time NOT NULL DEFAULT current_timestamp(),
  `total_hours` decimal(4,2) DEFAULT 0.00,
  `status` varchar(20) DEFAULT 'submitted',
  `observations` text DEFAULT NULL,
  `objectives` text DEFAULT NULL,
  `next_day_targets` text DEFAULT NULL,
  `general_comments` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp()
) ;

--
-- --------------------------------------------------------

--
-- Structure de la table `password_resets`
--

CREATE TABLE `password_resets` (
  `id` int(11) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `email` varchar(191) NOT NULL,
  `otp_code` varchar(6) NOT NULL,
  `expires_at` datetime NOT NULL,
  `is_used` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Structure de la table `reports`
--

CREATE TABLE `reports` (
  `id` int(11) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `report_date` date NOT NULL,
  `comments` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- --------------------------------------------------------

--
-- Structure de la table `report_activities`
--

CREATE TABLE `report_activities` (
  `id` int(11) NOT NULL,
  `report_id` int(11) NOT NULL,
  `description` varchar(255) NOT NULL,
  `objectives` text DEFAULT NULL,
  `category` varchar(100) NOT NULL,
  `status` varchar(36) NOT NULL DEFAULT 'pending',
  `obsevations` text DEFAULT NULL,
  `hours` decimal(3,1) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- --------------------------------------------------------

--
-- Structure de la table `report_issues`
--

CREATE TABLE `report_issues` (
  `id` varchar(36) NOT NULL,
  `report_id` varchar(36) NOT NULL,
  `issue_description` text NOT NULL,
  `proposed_solution` text DEFAULT NULL,
  `needs_manager_help` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Structure de la table `report_tasks`
--

CREATE TABLE `report_tasks` (
  `id` varchar(36) NOT NULL,
  `report_id` varchar(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `category` varchar(50) NOT NULL,
  `duration_hours` decimal(4,2) NOT NULL,
  `task_status` varchar(20) NOT NULL CHECK (`task_status` in ('completed','in_progress','blocked')),
  `description` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Structure de la table `users`
--

CREATE TABLE `users` (
  `id` varchar(36) NOT NULL,
  `last_name` varchar(50) NOT NULL,
  `username` varchar(50) NOT NULL,
  `email` varchar(120) NOT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` varchar(20) DEFAULT '''agent''',
  `department` varchar(100) NOT NULL,
  `job_title` varchar(100) DEFAULT NULL,
  `bio` text DEFAULT NULL,
  `avatar_url` text DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `two_factor_secret` varchar(64) DEFAULT NULL,
  `is_2fa_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `backup_codes` text DEFAULT NULL,
  `two_factor_code` varchar(255) DEFAULT NULL,
  `two_factor_expires` datetime DEFAULT NULL,
  `password_resets` varchar(100) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

--
