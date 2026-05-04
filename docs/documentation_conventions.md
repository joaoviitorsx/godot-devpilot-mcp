# Documentation Conventions

Date: 2026-05-03

## Canonical filenames

This repository uses lowercase Markdown filenames under `docs/`.

Canonical examples:

```text
docs/architecture.md
docs/roadmap.md
docs/security.md
docs/tool_specification.md
docs/development_guide.md
docs/contributing.md
docs/api_reference.md
docs/installation.md
docs/examples.md
docs/troubleshooting.md
```

## Historical uppercase references

Some planning documents mention uppercase names such as:

```text
docs/ARCHITECTURE.md
docs/ROADMAP.md
docs/SECURITY.md
docs/TOOL_SPECIFICATION.md
```

Those references are historical naming examples, not the current canonical filenames.

## Link rule

New documentation and scripts should link to lowercase filenames only. This avoids case-sensitive path issues on Linux and macOS.

## README rule

`README.md` is the only repository root README. The old lowercase `readme.md` was removed to avoid conflicting project status and installation instructions.
