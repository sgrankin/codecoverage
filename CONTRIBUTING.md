# Contributing

> First, you'll need to have Node.js 24 or newer (matching the action's runtime).

Install the dependencies:
```bash
npm install
```

Run formatting and linting, build the typescript and package it for distribution, and run tests:
```bash
npm run all
```

Make sure you commit the `dist/` folder or CI will fail.

## Validate

You can validate the action while developing by referencing `./` in a workflow in your repo (see [ci.yml](.github/workflows/ci.yml)):

```yaml
uses: ./
with:
  GITHUB_TOKEN: ${{secrets.GITHUB_TOKEN}}
  COVERAGE_FILE_PATH: "./coverage/lcov.info"
```
