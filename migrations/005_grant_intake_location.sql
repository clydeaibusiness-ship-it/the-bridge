-- Migration 005: Add city/state/county to grant_radar_intake for edit mode round-trip
ALTER TABLE grant_radar_intake ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE grant_radar_intake ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE grant_radar_intake ADD COLUMN IF NOT EXISTS county TEXT;
