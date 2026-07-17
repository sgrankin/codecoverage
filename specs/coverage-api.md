# GitHub Coverage API Upload

Optional upload of coverage reports to GitHub's native code coverage API
(part of GitHub Code Quality, public preview). Once uploaded, GitHub shows
coverage results directly on pull requests via the `github-code-quality[bot]`
comment and compares PRs against the default-branch baseline.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `coverage_api` | `false` | Enable the upload |
| `coverage_api_language` | - | Linguist language name (e.g. `TypeScript`, `Go`). Required when enabled. |
| `coverage_api_label` | `code-coverage` | Label identifying the report (e.g. `code-coverage/vitest`) |

The upload requires the `code-quality: write` workflow permission and the
repository to have code quality enabled.

## API Contract

The contract mirrors the official
[actions/upload-code-coverage](https://github.com/actions/upload-code-coverage)
action:

```
PUT {github_base_url}/repos/{owner}/{repo}/code-coverage/report
Authorization: Bearer {github_token}
Accept: application/vnd.github+json
```

Payload:

```json
{
  "commit_oid": "<sha>",
  "coverage_report": "<base64(gzip(cobertura xml))>",
  "language_name": "TypeScript",
  "label": "code-coverage",
  "pull_request_number": 42
}
```

Exactly one of `pull_request_number` or `ref` is set:

| Event | `commit_oid` | Keyed by |
|-------|--------------|----------|
| `pull_request` / `pull_request_target` | PR head SHA (not the merge commit) | `pull_request_number` |
| Everything else (push, dispatch, ...) | Triggering commit SHA | `ref` |

Skipped entirely (with an info log) for:

- `merge_group` events — GitHub's coverage feature expects PR and
  default-branch uploads only
- Fork PRs — the workflow token lacks write permission, so the upload would
  always fail

## Report Generation

The API only accepts Cobertura XML. The report is regenerated from the
normalized internal representation (`cobertura.generate`) rather than passing
the input file through, so:

- Any input format works (lcov, go, simplecov, cobertura)
- Multiple files merged from globs upload as one report
- Paths match the repository layout (parsers already normalize them relative
  to the workspace, including `working_directory` prefixing for Go)

Generated XML groups files into packages by the entry's package name, falling
back to the file's directory. Output is deterministic: `timestamp="0"`, input
order preserved. Only line coverage is emitted (branch attributes are zeroed;
Go statement blocks are not representable in Cobertura).

## Error Handling

Upload failures emit a `core.warning` and do not fail the run: the upload is
auxiliary to the action's primary job (annotations), and the API is in public
preview so repositories may not have it enabled. A 403 response appends a
hint about the `code-quality: write` permission. A 404 — the API's answer
when code quality is not enabled on the repository (currently org-only during
the preview) — logs at info level rather than warning, so repos that opt in
before they have access don't get a warning annotation on every run.

Unlike the official action, there is no post-upload processing-status polling;
the action logs the report id returned by the API and moves on.

## Design Decisions

- **Regenerate, don't pass through**: even for `coverage_format: cobertura`
  input, the report is regenerated from parsed data. One code path, and glob
  merges/path normalization come for free.
- **Upload before mode-specific logic**: runs for both PR events and pushes;
  pushes to the default branch establish GitHub's comparison baseline.
- **Warn, don't fail**: the action's own delta/annotation features must keep
  working for repos without code quality enabled.
