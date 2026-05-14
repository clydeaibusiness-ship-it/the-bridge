-- Migration 004: Add community service programs field to grant radar intake
ALTER TABLE grant_radar_intake ADD COLUMN IF NOT EXISTS community_service_programs TEXT;
