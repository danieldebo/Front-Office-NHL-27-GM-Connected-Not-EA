-- ============================================================================
-- Front Office — alternate hockey league clubs in the catalog
-- Target: PostgreSQL 15+  |  Depends on: schema.sql (>= 1.0.1)
-- Schema version: 2.19.0
--
-- nhl_club has always held exactly the 32 current NHL clubs, keyed by a
-- global-unique abbrev. Season provisioning (seasonProvisioning.ts) still
-- provisions ONLY from those 32 — that invariant is untouched here.
--
-- This adds league_source so the catalog can also hold a small, curated set
-- of well-known, long-standing clubs from four other real leagues (SHL, DEL,
-- Liiga, ECHL), so a commissioner can replace any franchise seat's club with
-- one of them. This is a best-effort reference list of stable, storied
-- franchises — not a live or exhaustive roster of any league's current
-- membership.
-- ============================================================================

INSERT INTO schema_version (version, notes)
VALUES ('2.19.0', 'nhl_club.league_source + a curated SHL/DEL/Liiga/ECHL club catalog, for team add/remove/rename');

ALTER TABLE nhl_club
    ADD COLUMN league_source TEXT NOT NULL DEFAULT 'NHL';

ALTER TABLE nhl_club
    ADD CONSTRAINT nhl_club_league_source_check
    CHECK (league_source IN ('NHL', 'SHL', 'DEL', 'LIIGA', 'ECHL'));

CREATE INDEX ON nhl_club (league_source);

-- Belt-and-suspenders: every row inserted before this migration is NHL, but
-- make that explicit rather than relying only on the column default.
UPDATE nhl_club SET league_source = 'NHL' WHERE league_source IS DISTINCT FROM 'NHL';

INSERT INTO nhl_club (abbrev, name, conference, division, league_source) VALUES
    ('FHC',  'Frölunda HC',       NULL, NULL, 'SHL'),
    ('DIF',  'Djurgårdens IF',    NULL, NULL, 'SHL'),
    ('FBK',  'Färjestad BK',      NULL, NULL, 'SHL'),
    ('HV71', 'HV71',              NULL, NULL, 'SHL'),
    ('LHF',  'Luleå HF',          NULL, NULL, 'SHL'),
    ('SAIK', 'Skellefteå AIK',    NULL, NULL, 'SHL'),
    ('BIF',  'Brynäs IF',         NULL, NULL, 'SHL'),
    ('LHC',  'Linköping HC',      NULL, NULL, 'SHL'),
    ('EBB',  'Eisbären Berlin',       NULL, NULL, 'DEL'),
    ('MAN',  'Adler Mannheim',        NULL, NULL, 'DEL'),
    ('KEC',  'Kölner Haie',           NULL, NULL, 'DEL'),
    ('ERC',  'ERC Ingolstadt',        NULL, NULL, 'DEL'),
    ('WOB',  'Grizzlys Wolfsburg',    NULL, NULL, 'DEL'),
    ('STR',  'Straubing Tigers',      NULL, NULL, 'DEL'),
    ('NIT',  'Nürnberg Ice Tigers',   NULL, NULL, 'DEL'),
    ('DEG',  'Düsseldorfer EG',       NULL, NULL, 'DEL'),
    ('TAP',  'Tappara',           NULL, NULL, 'LIIGA'),
    ('KAR',  'Kärpät Oulu',       NULL, NULL, 'LIIGA'),
    ('HIFK', 'HIFK',              NULL, NULL, 'LIIGA'),
    ('JYP',  'JYP Jyväskylä',     NULL, NULL, 'LIIGA'),
    ('ILV',  'Ilves Tampere',     NULL, NULL, 'LIIGA'),
    ('TPS',  'TPS Turku',         NULL, NULL, 'LIIGA'),
    ('LUK',  'Lukko Rauma',       NULL, NULL, 'LIIGA'),
    ('PEL',  'Pelicans Lahti',    NULL, NULL, 'LIIGA'),
    ('TOL',  'Toledo Walleye',        NULL, NULL, 'ECHL'),
    ('WHL',  'Wheeling Nailers',      NULL, NULL, 'ECHL'),
    ('FLE',  'Florida Everblades',    NULL, NULL, 'ECHL'),
    ('CIN',  'Cincinnati Cyclones',   NULL, NULL, 'ECHL'),
    ('NFL',  'Newfoundland Growlers', NULL, NULL, 'ECHL'),
    ('IDH',  'Idaho Steelheads',      NULL, NULL, 'ECHL'),
    ('KAL',  'Kalamazoo Wings',       NULL, NULL, 'ECHL'),
    ('NOR',  'Norfolk Admirals',      NULL, NULL, 'ECHL')
ON CONFLICT (abbrev) DO UPDATE
    SET name = EXCLUDED.name,
        league_source = EXCLUDED.league_source;
