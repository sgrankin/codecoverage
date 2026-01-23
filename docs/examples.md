# Examples

Detailed workflow examples for the codecoverage action.

## GitHub Enterprise Server or Cloud

Set `github_base_url` to point to your API endpoint:

```yaml
# GitHub Enterprise Server
with:
  github_base_url: https://github.acme-inc.com/api/v3

# GitHub Enterprise Cloud
with:
  github_base_url: https://api.acme-inc.ghe.com
```

## Multiple Coverage Files

Use glob patterns or newline-separated paths:

```yaml
# Using glob pattern
- name: Code Coverage
  uses: sgrankin/codecoverage@v1
  with:
    github_token: ${{secrets.GITHUB_TOKEN}}
    coverage_file_path: "**/coverage.out"
    coverage_format: go

# Using multiple paths
- name: Code Coverage
  uses: sgrankin/codecoverage@v1
  with:
    github_token: ${{secrets.GITHUB_TOKEN}}
    coverage_file_path: |
      packages/frontend/coverage/lcov.info
      packages/backend/coverage/lcov.info
    coverage_format: lcov
```

## Language-Specific Setup

### Go

```yaml
- name: Run tests with coverage
  run: go test -v ./... -coverprofile coverage.out

- name: Code Coverage
  uses: sgrankin/codecoverage@v1
  with:
    github_token: ${{secrets.GITHUB_TOKEN}}
    coverage_file_path: coverage.out
    coverage_format: go
```

### JavaScript/TypeScript (Jest)

Set up `npm run test:cov` to run `jest --coverage`, which outputs lcov to `coverage/lcov.info`.

```yaml
- name: Run tests with coverage
  run: npm run test:cov

- name: Code Coverage
  uses: sgrankin/codecoverage@v1
  with:
    github_token: ${{secrets.GITHUB_TOKEN}}
    coverage_file_path: coverage/lcov.info
```

### C++

GCC Gcov can output lcov format. See [this blog post](https://shenxianpeng.github.io/2021/07/gcov-example/) for setup.

### Ruby (SimpleCov)

SimpleCov JSON output is supported directly:

```ruby
# test_helper.rb
require 'simplecov'
require 'simplecov_json_formatter'
SimpleCov.formatter = SimpleCov::Formatter::JSONFormatter
SimpleCov.start
```

```yaml
- name: Run tests
  run: bundle exec rspec

- name: Code Coverage
  uses: sgrankin/codecoverage@v1
  with:
    github_token: ${{secrets.GITHUB_TOKEN}}
    coverage_file_path: coverage/coverage.json
    coverage_format: simplecov
```

Alternatively, you can use SimpleCov's internal `.resultset.json` directly (useful when merging coverage from parallel test runs):

```yaml
coverage_file_path: coverage/.resultset.json
coverage_format: simplecov
```

Or convert to LCOV format with [`simplecov-lcov`](https://github.com/fortissimo1997/simplecov-lcov):

```ruby
# test_helper.rb
require 'simplecov'
require 'simplecov-lcov'
SimpleCov::Formatter::LcovFormatter.config.report_with_single_file = true
SimpleCov.formatter = SimpleCov::Formatter::LcovFormatter
SimpleCov.start
```

## Coverage Delta Workflow

Full workflow with baseline tracking:

```yaml
name: Tests
on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: write      # Required for git notes
      pull-requests: write # Required for PR comments
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # Full history for merge-base detection

      - name: Run tests with coverage
        run: npm test -- --coverage

      - name: Code Coverage
        uses: sgrankin/codecoverage@v1
        with:
          github_token: ${{secrets.GITHUB_TOKEN}}
          coverage_file_path: coverage/lcov.info
          pr_comment: "true"
```

## Mode Override

Manually control the operating mode:

```yaml
# Force pr-check mode (useful for debugging)
- uses: sgrankin/codecoverage@v1
  with:
    mode: pr-check
    # ...

# Force store-baseline mode (useful for scheduled runs)
- uses: sgrankin/codecoverage@v1
  with:
    mode: store-baseline
    # ...
```

## Monorepo: Multiple Coverage Histories

For monorepos with multiple independent codebases, use `note_namespace` to track coverage history separately for each project:

```yaml
name: Tests
on:
  pull_request:
  push:
    branches: [main]

jobs:
  frontend:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run frontend tests
        run: npm test --workspace=frontend -- --coverage

      - name: Frontend Coverage
        uses: sgrankin/codecoverage@v1
        with:
          github_token: ${{secrets.GITHUB_TOKEN}}
          coverage_file_path: packages/frontend/coverage/lcov.info
          note_namespace: coverage-frontend
          report_header: Frontend Coverage
          pr_comment: "true"

  backend:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run backend tests
        run: npm test --workspace=backend -- --coverage

      - name: Backend Coverage
        uses: sgrankin/codecoverage@v1
        with:
          github_token: ${{secrets.GITHUB_TOKEN}}
          coverage_file_path: packages/backend/coverage/lcov.info
          note_namespace: coverage-backend
          report_header: Backend Coverage
          pr_comment: "true"
```

Each project gets:
- Separate git notes namespace (`refs/notes/coverage-frontend/main`, etc.)
- Independent baseline tracking and delta calculation
- Its own PR comment (with distinct header)
- Dedicated annotations for uncovered lines
