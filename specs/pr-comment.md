# PR Comment

## Overview

The action can post a coverage summary as a comment on the pull request, providing visibility without navigating to the Actions UI.

## Configuration

- **Input**: `pr_comment` (default: `false`)
- Set to `true` to enable PR comments
- **Input**: `comment_id` (default: `''`) — namespaces the comment marker
- Requires `pull-requests: write` permission

## Behavior

### Comment Creation

1. On first run, creates a new comment with the coverage summary
2. On subsequent runs, updates the existing comment (no duplicate comments)

### Comment Identification

Comments are identified by a hidden HTML marker:

```html
<!-- codecoverage-action -->
## 🟢 Code Coverage Report
...
```

The action searches for this marker when deciding whether to create or update.

### Comment Namespacing

A non-empty `comment_id` namespaces the marker:

```html
<!-- codecoverage-action:go -->
```

Jobs with different ids maintain separate comments on the same PR (e.g. one
comment per coverage format in a multi-job workflow); re-runs with the same id
update their own comment in place. Marker matching is exact — the trailing
` -->` delimiter means one id can never match another's comment (`go` does not
match `go2`), and the default un-namespaced marker never matches a namespaced
one.

### Error Handling

The action handles errors gracefully:

| Error | Behavior |
|-------|----------|
| 403 Forbidden | Warning logged, action continues |
| 404 Not Found (PR closed) | Warning logged, action continues |
| 422 Unprocessable | Warning logged, action continues |
| Other errors | Re-thrown (action fails) |

This ensures that comment failures don't fail the entire workflow.

## Content

The comment uses the same markdown format as the step summary:

- Status emoji (🟢/🟡/🔴)
- Horizontal metrics table
- Annotation status
- Collapsible package breakdown

See [step-summary.md](step-summary.md) for format details.

## Implementation

### GitHub API

Uses the Issues API (PR comments are issue comments):

- `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` - List comments
- `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` - Create comment
- `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}` - Update comment

### Code

- `src/utils/github.ts` - `Client.upsertComment()` method
- `src/action.ts` - Integration, called after summary generation in PR mode

## Example

```yaml
- name: Code Coverage
  uses: sgrankin/codecoverage@v1
  with:
    github_token: ${{secrets.GITHUB_TOKEN}}
    coverage_file_path: coverage/lcov.info
    pr_comment: "true"
```

Result: A comment appears on the PR with the coverage report, updated on each push.
