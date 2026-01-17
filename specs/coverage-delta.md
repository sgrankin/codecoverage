# Coverage Delta

## Overview

The coverage delta feature tracks how test coverage changes between commits, showing whether a pull request improves or degrades coverage compared to the base branch.

## Storage Mechanism

Coverage baselines are stored using **git notes**, which provide a way to attach metadata to commits without modifying commit history.

### Why Git Notes?

- **No extra branches** - Data is stored in refs/notes/*, not in the working tree
- **Tied to commits** - Baselines are attached to specific commit SHAs
- **No expiration** - Unlike artifacts, notes persist indefinitely
- **Natural concurrency** - Git's merge semantics handle concurrent updates
- **Clean separation** - Coverage data doesn't pollute source history

### Data Format

Baseline data is stored as JSONL (JSON Lines), one object per line:

```jsonl
{"timestamp": "2024-01-01T10:00:00Z", "coveragePercentage": "85.50", "totalLines": 1000, "coveredLines": 855, "commit": "abc123"}
```

The first line is used for delta calculation. Additional lines are reserved for future use (e.g., historical tracking).

### Namespace Strategy

Notes are stored under branch-specific namespaces to support multiple release branches:

- `refs/notes/coverage/main` - Baselines for main branch
- `refs/notes/coverage/release-v1` - Baselines for release-v1 branch

This allows PRs targeting different branches to have separate baselines.

## Operating Modes

### Mode Detection

The action automatically detects which mode to run in:

| Event | Branch | Mode |
|-------|--------|------|
| `pull_request` | any | `pr-check` |
| `push` | main | `store-baseline` |
| `push` | feature/* | `store-baseline` (no storage) |
| `workflow_dispatch` | any | `store-baseline` |
| `schedule` | any | `store-baseline` |

### PR Check Mode (`pr-check`)

1. Parse current coverage from test results
2. Fetch notes from origin: `git fetch origin refs/notes/coverage/main:refs/notes/coverage/main`
3. Find merge-base: `git merge-base HEAD origin/main`
4. Read baseline from merge-base commit
5. Calculate delta: `current - baseline`
6. Display in summary: `Coverage: 85.5% (↑2.1%)`
7. Create PR annotations for uncovered lines

### Store Baseline Mode (`store-baseline`)

1. Parse current coverage from test results
2. Create JSONL baseline data
3. Attach to HEAD: `git notes --ref=coverage/main add -m "$DATA" HEAD`
4. Push to origin: `git push origin refs/notes/coverage/main`
5. Report absolute coverage (no delta)

## Retry Logic

Concurrent pushes to the notes ref can cause conflicts. The action handles this with:

1. Attempt push
2. On non-fast-forward error, fetch latest notes (force)
3. Retry push (up to 3 attempts)
4. Exponential backoff between retries

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No baseline exists | Show absolute coverage only |
| Notes ref doesn't exist | Create on first push |
| Corrupted/invalid JSON | Treat as missing baseline |
| Network error on push | Warning, continue without storage |
| No merge-base found | Show absolute coverage only |

## Configuration

| Input | Default | Description |
|-------|---------|-------------|
| `mode` | auto | Force `pr-check` or `store-baseline` |
| `calculate_delta` | `true` | Enable/disable delta calculation |
| `note_namespace` | `coverage` | Base namespace for notes |
| `delta_precision` | `2` | Decimal places in delta display |

## Outputs

| Output | Example | Description |
|--------|---------|-------------|
| `coverage_delta` | `+2.50` | Signed delta string |
| `baseline_percentage` | `83.00` | Baseline coverage |
| `mode` | `pr-check` | Actual mode used |

## Required Permissions

```yaml
permissions:
  contents: write  # Push git notes
  pull-requests: write  # Create annotations
```

## Data Flow

```
┌─────────────────┐     ┌─────────────────┐
│ Push to main    │     │ Pull Request    │
│ (store-baseline)│     │ (pr-check)      │
└────────┬────────┘     └────────┬────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│ Parse Coverage  │     │ Parse Coverage  │
└────────┬────────┘     └────────┬────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│ Format JSONL    │     │ Fetch Notes     │
└────────┬────────┘     └────────┬────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│ git notes add   │     │ Find Merge-Base │
└────────┬────────┘     └────────┬────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│ git push notes  │     │ Read Baseline   │
└────────┬────────┘     └────────┬────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│ Report Absolute │     │ Calculate Delta │
│ Coverage        │     │ & Display       │
└─────────────────┘     └─────────────────┘
```

## Implementation

### Files

- `src/utils/gitnotes.ts` - Git notes operations (fetch, read, write, push)
- `src/utils/mode.ts` - Mode detection and namespace resolution
- `src/utils/baseline.ts` - Baseline formatting, parsing, delta calculation
- `src/action.ts` - Integration into main action flow
