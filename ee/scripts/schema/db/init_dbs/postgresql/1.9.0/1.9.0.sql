DO
$$
    DECLARE
        previous_version CONSTANT text := 'v1.8.1-ee';
        next_version     CONSTANT text := 'v1.9.0-ee';
    BEGIN
        IF (SELECT openreplay_version()) = previous_version THEN
            raise notice 'valid previous DB version';
        ELSEIF (SELECT openreplay_version()) = next_version THEN
            raise notice 'new version detected, nothing to do';
        ELSE
            RAISE EXCEPTION 'upgrade to % failed, invalid previous version, expected %, got %', next_version,previous_version,(SELECT openreplay_version());
        END IF;
    END ;
$$
LANGUAGE plpgsql;

BEGIN;
CREATE OR REPLACE FUNCTION openreplay_version()
    RETURNS text AS
$$
SELECT 'v1.9.0-ee'
$$ LANGUAGE sql IMMUTABLE;

ALTER TABLE IF EXISTS public.tenants
    ADD COLUMN IF NOT EXISTS last_telemetry bigint NOT NULL DEFAULT CAST(EXTRACT(epoch FROM date_trunc('day', now())) * 1000 AS BIGINT),
    DROP COLUMN IF EXISTS version_number;

CREATE TABLE IF NOT EXISTS sessions_notes
(
    note_id    integer generated BY DEFAULT AS IDENTITY PRIMARY KEY,
    message    text                        NOT NULL,
    created_at timestamp without time zone NOT NULL default (now() at time zone 'utc'),
    user_id    integer                     NULL REFERENCES users (user_id) ON DELETE SET NULL,
    deleted_at timestamp without time zone NULL     DEFAULT NULL,
    tag        text                        NULL,
    session_id bigint                      NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
    project_id integer                     NOT NULL REFERENCES projects (project_id) ON DELETE CASCADE,
    timestamp  integer                     NOT NULL DEFAULT -1,
    is_public  boolean                     NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS errors_tags
(
    key        text                        NOT NULL,
    value      text                        NOT NULL,
    created_at timestamp without time zone NOT NULL default (now() at time zone 'utc'),
    error_id   text                        NOT NULL REFERENCES errors (error_id) ON DELETE CASCADE,
    session_id bigint                      NOT NULL,
    message_id bigint                      NOT NULL,
    FOREIGN KEY (session_id, message_id) REFERENCES events.errors (session_id, message_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS errors_tags_error_id_idx ON errors_tags (error_id);
CREATE INDEX IF NOT EXISTS errors_tags_session_id_idx ON errors_tags (session_id);
CREATE INDEX IF NOT EXISTS errors_tags_message_id_idx ON errors_tags (message_id);

UPDATE metrics
SET default_config=default_config || '{"col":4}'
WHERE metric_type = 'funnel';

UPDATE dashboard_widgets
SET config=config || '{"col":4}'
WHERE metric_id IN (SELECT metric_id FROM metrics WHERE metric_type = 'funnel');

CREATE OR REPLACE FUNCTION notify_integration() RETURNS trigger AS
$$
BEGIN
    IF NEW IS NULL THEN
        PERFORM pg_notify('integration',
                          jsonb_build_object('project_id', OLD.project_id, 'provider', OLD.provider, 'options',
                                             null)::text);
    ELSIF (OLD IS NULL) OR (OLD.options <> NEW.options) THEN
        PERFORM pg_notify('integration', row_to_json(NEW)::text);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE IF EXISTS sessions
    ADD COLUMN IF NOT EXISTS file_key BYTEA DEFAULT NULL;

UPDATE users
SET role_id=NULL
WHERE deleted_at IS NOT NULL;

UPDATE roles
SET permissions=array_remove(permissions, 'ERRORS');

DROP INDEX IF EXISTS events_common.requests_url_idx;
DROP INDEX IF EXISTS events_common.requests_url_gin_idx;
DROP INDEX IF EXISTS events_common.requests_url_gin_idx2;

DROP INDEX IF EXISTS events.resources_url_gin_idx;
DROP INDEX IF EXISTS events.resources_url_idx;

UPDATE metrics
SET default_config=default_config || '{
  "col": 4
}'::jsonb
WHERE NOT is_predefined
  AND (metric_type = 'funnel' OR (metric_type = 'table' AND metric_of IN ('SESSIONS', 'js_exception')));

COMMIT;

CREATE INDEX CONCURRENTLY IF NOT EXISTS requests_session_id_status_code_nn_idx ON events_common.requests (session_id, status_code) WHERE status_code IS NOT NULL;