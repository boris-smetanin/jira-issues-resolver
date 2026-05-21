-- Slice 16a (foundations): schema + dispatcher plumbing for the upcoming
-- prompt hardening work. Behaviour-neutral: existing buildPrompt continues
-- to render the same content; only the *resolved shape* gets persisted on
-- each attempt row, and the JQL filter starts excluding unrecognised
-- issuetypes + the agent-escalated label.

-- ─────────────────────────────────────────────────────────────────────────
-- settings: issue-type → prompt-shape map (editable via /settings UI)
-- ─────────────────────────────────────────────────────────────────────────
-- Defaults match a standard Atlassian Jira schema. A team using non-
-- standard issuetype names (e.g. "Defect" instead of "Bug") can adapt by
-- editing the lists in the UI; no code change required.
ALTER TABLE settings
  ADD COLUMN bug_issue_types TEXT[]
    NOT NULL DEFAULT ARRAY['Bug', 'Support'],
  ADD COLUMN code_improvement_issue_types TEXT[]
    NOT NULL DEFAULT ARRAY['Task', 'Change request'],
  ADD COLUMN feature_issue_types TEXT[]
    NOT NULL DEFAULT ARRAY['Feature', 'New Feature', 'Customer Request'];

-- ─────────────────────────────────────────────────────────────────────────
-- resolve_attempts: scaffolding columns for 16b (escalation + dep-install
-- observability + which prompt shape was used).
-- ─────────────────────────────────────────────────────────────────────────
-- escalation_md   — populated by 16b's escalation handler when the agent
--                   writes .jir/escalation.md and commits zero files.
-- deps_installed_for_attempt — set true by 16b's orchestrator-driven
--                   dep-install step (code-improvement-shape only).
-- prompt_shape    — recorded by THIS slice's dispatcher; matches one of
--                   the three configured buckets, or null if the
--                   issuetype was unrecognised (defensive — JQL should
--                   prevent this case from reaching us).
ALTER TABLE resolve_attempts
  ADD COLUMN escalation_md TEXT,
  ADD COLUMN deps_installed_for_attempt BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN prompt_shape TEXT
    CHECK (prompt_shape IS NULL OR prompt_shape IN ('bug', 'code-improvement', 'feature'));

-- ─────────────────────────────────────────────────────────────────────────
-- AttemptStatus: ESCALATED joins the family. Recognised everywhere but no
-- transition path reaches it yet — 16b's escalation handler owns that.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE resolve_attempts
  DROP CONSTRAINT IF EXISTS resolve_attempts_status_check;

ALTER TABLE resolve_attempts
  ADD CONSTRAINT resolve_attempts_status_check CHECK (status IN (
    'QUEUED', 'PREPARING_REPO', 'AGENT_RUNNING', 'CHECKING_COMMITS',
    'PUSHING', 'OPENING_PR', 'TRANSITIONING_JIRA',
    'FINISHED', 'FINISHED_NO_CHANGES', 'FAILED', 'ESCALATED'
  ));
