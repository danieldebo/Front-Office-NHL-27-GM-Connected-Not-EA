INSERT INTO schema_version (version, notes)
VALUES ('2.14.0', 'waitlist_entry records who resolved a waitlist-only applicant, matching league_signup decided_by');

ALTER TABLE waitlist_entry
    ADD COLUMN decided_by UUID REFERENCES app_user(id);
