# Contributing

> First, you'll need to have a reasonably modern version of `node` handy, ideally 16 or newer. Older versions will change the format of `package-lock.json`.

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

You can validate the action while developing by referencing `./` in a workflow in your repo (see [test.yml](.github/workflows/test.yml)):

```yaml
uses: ./
with:
  GITHUB_TOKEN: ${{secrets.GITHUB_TOKEN}}
  COVERAGE_FILE_PATH: "./coverage/lcov.info"
```
