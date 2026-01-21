![Build Status](https://github.com/sgrankin/codecoverage/actions/workflows/ci.yml/badge.svg)

# Code Coverage Annotation

Annotate pull requests with lines missing test coverage. Catch gaps as they're introduced, right in the context of the PR.

All processing runs within GitHub Actions—no data is sent to external servers.

![Sample annotation](https://user-images.githubusercontent.com/23582455/175847244-dbed2fb3-70be-4bcd-a7d0-64197951c517.png)

## Quick Start

```yaml
- name: Code Coverage
  uses: sgrankin/codecoverage@v1
  with:
    github_token: ${{secrets.GITHUB_TOKEN}}
    coverage_file_path: coverage/lcov.info
```

See [docs/examples.md](docs/examples.md) for language-specific setup and advanced configurations.

## Inputs

| Input | Required | Default | Description |
| ----- | -------- | ------- | ----------- |
| `github_token` | **yes** | - | GitHub token from workflow (`${{secrets.GITHUB_TOKEN}}`) |
| `coverage_file_path` | **yes** | - | Path to coverage file(s). Supports globs and newline-separated paths. |
| `coverage_format` | no | `lcov` | Format: `lcov`, `cobertura`, `go`, or `simplecov` |
| `pr_comment` | no | `false` | Post coverage summary as PR comment |
| `step_summary` | no | `true` | Write summary to GitHub Actions step summary |
| `max_annotations` | no | `10` | Maximum annotations to emit |
| `max_lookback` | no | `50` | Max ancestor commits to search for baseline |
| `sparkline_count` | no | `10` | Historical data points in coverage sparkline (0 to disable) |
| `mode` | no | auto | `pr-check` or `store-baseline` (see below) |
| `calculate_delta` | no | `true` | Calculate coverage delta against baseline |
| `github_base_url` | no | `https://api.github.com` | API URL for GitHub Enterprise |

## Outputs

| Output | Description |
| ------ | ----------- |
| `coverage_percentage` | Overall coverage (e.g., `85.50`) |
| `coverage_delta` | Change vs baseline (e.g., `+2.50`) |
| `baseline_percentage` | Baseline coverage from git notes |
| `files_analyzed` | Number of files with coverage data |
| `annotation_count` | Annotations created for uncovered lines |
| `mode` | Operating mode used |

## Coverage Delta

Track coverage changes over time using git notes:

1. **Push to main** → stores coverage as baseline
2. **Pull request** → compares against baseline, shows delta

Requires `contents: write` permission and `fetch-depth: 0`:

```yaml
permissions:
  contents: write
  pull-requests: write
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

## Acknowledgements

Fork of [ggilder/codecoverage](https://github.com/ggilder/codecoverage), originally based on [shravan097/codecoverage](https://github.com/shravan097/codecoverage).
