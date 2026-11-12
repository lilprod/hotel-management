-- Hand-written: extensions required by later migrations.
-- btree_gist: exclusion constraints mixing "=" (uuid) and "&&" (tstzrange).
-- pg_trgm   : trigram indexes for fuzzy guest search.
-- Both are "trusted" extensions (PG 13+): the database owner can create them without superuser.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
