-- 0015: the review state of each result and view (offline devices spec §7.4, ADR 0019). The latest review decides;
-- with none, a result counts unless it was flagged because consent had been withdrawn. security_invoker: the base
-- tables' RLS applies to whoever reads the view.
CREATE VIEW app.game_session_review WITH (security_invoker = true) AS
SELECT g.id, g.patient_id, g.review_reason, r.decision,
       CASE WHEN r.decision = 'exclude' THEN false
            WHEN r.decision = 'accept' THEN true
            ELSE g.review_reason IS DISTINCT FROM 'consent_withdrawn' END AS counts
  FROM app.game_session g
  LEFT JOIN LATERAL (SELECT x.decision FROM app.result_review x WHERE x.game_session_id = g.id ORDER BY x.decided_at DESC, x.id DESC LIMIT 1) r ON true;

CREATE VIEW app.video_view_review WITH (security_invoker = true) AS
SELECT v.id, v.patient_id, v.review_reason, r.decision,
       CASE WHEN r.decision = 'exclude' THEN false
            WHEN r.decision = 'accept' THEN true
            ELSE v.review_reason IS DISTINCT FROM 'consent_withdrawn' END AS counts
  FROM app.video_view v
  LEFT JOIN LATERAL (SELECT x.decision FROM app.result_review x WHERE x.video_view_id = v.id ORDER BY x.decided_at DESC, x.id DESC LIMIT 1) r ON true;

GRANT SELECT ON app.game_session_review, app.video_view_review TO emb_app;
