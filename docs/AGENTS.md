# Docs DOX

## Purpose

Documentation in this subtree explains Prompt Paul architecture, development workflows, and skill usage examples for users and contributors.

## Ownership

- Owns Markdown files under `docs/`.
- Root AGENTS.md owns the canonical skill specification and top-level project contracts.
- README, changelog, and root-level public docs are owned by the root AGENTS.md.

## Local Contracts

- Keep docs aligned with the current extension behavior, available commands, and build/test scripts.
- `PRODUCTION_READINESS.md` includes the hidden-tab settlement gate: browser coverage must assert a genuinely hidden document, including verified input, scrolling, and a healthy follow-up inspection.
- Record manual UI delivery checks separately from model benchmark scores; local scripted providers verify interaction flows without measuring model task success.
- Link to root AGENTS.md for the canonical skill specification.
- Prefer concise operational docs over historical notes.

## Work Guidance

- Update `docs/ARCHITECTURE.md` when module responsibilities or data flow change.
- Update `docs/UX_JOURNEYS.md` when the representative journeys, verification axes, or WCAG best-effort checklist change.
- Update `docs/DEVELOPMENT.md` when setup, commands, testing, or workflow changes.
- Update `docs/PRODUCTION_READINESS.md` when production gates, security rules, or review requirements change.
- Update `docs/SKILL_EXAMPLES.md` when skill invocation behavior, supported patterns, or examples change.
- Update `docs/STORE_LISTING.md` whenever the Chrome Web Store listing changes; keep its "What's new" entry aligned with the latest release section in the root changelog.
- Keep relative links valid from the document being edited.

- Act value disclosure changes require aligned privacy text in `STORE_LISTING.md`; distinguish live model history from durable journal/checkpoint metadata.

## Verification

- For docs-only edits, review rendered Markdown and links.
- When docs describe commands or runtime behavior, run the referenced command when practical.

## Child DOX Index

- No child AGENTS.md files are currently needed under `docs/`.
