# Agent Rules

These rules apply to this repository and all agent sessions within it.

---

## Changelog

Maintain `CHANGELOG.md` in [Keep a Changelog](https://keepachangelog.com) format.

**After each commit**, add an entry under `## [Unreleased]` using the format:

```
- <what changed> — <why it was changed / what problem it solves>
```

Categories: `### Added` · `### Changed` · `### Fixed` · `### Removed`

The *why* is required. The diff shows what changed — the changelog records the
reasoning that won't survive in the code.

Skip entries for: whitespace-only commits, immediately reverted commits,
lock file bumps with no behavioral intent change.

Never promote `[Unreleased]` to a version block without an explicit instruction.

If `CHANGELOG.md` does not exist yet, create it:

```markdown
# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [Unreleased]
```

---

## Component Library

All finalized UI components must be built and committed in the `zenith-ui-deployment`
component library before zenith-hub work that depends on them can be committed.
Drafting and prototyping may be done directly in zenith-hub, but a component is
not considered finalized until it exists in zenith-ui.

**Workflow:**
1. Draft or prototype the component inline in zenith-hub if needed
2. Finalize the component and commit it to zenith-ui
3. Import the finalized component into zenith-hub from zenith-ui
4. Only then commit the zenith-hub changes
