import * as zlib from 'node:zlib'
import * as core from '@actions/core'
import * as github from '@actions/github'

// Report is the request payload for GitHub's code coverage API.
// See https://github.com/actions/upload-code-coverage for the reference
// implementation of this contract.
export type Report = {
  commit_oid: string
  // coverage_report is the Cobertura XML, gzip-compressed and base64-encoded.
  coverage_report: string
  language_name: string
  label: string
  // Exactly one of pull_request_number or ref is set, keying the report to a
  // pull request or a pushed branch.
  pull_request_number?: number
  ref?: string
}

// Target identifies the commit, pull request or ref, and repository a
// coverage report applies to. A non-empty skip means the upload should not
// happen, and holds the reason.
export type Target = {
  commitOID: string
  // pullRequestNumber keys the report to a pull request (0 = not a PR).
  pullRequestNumber: number
  // ref keys the report to a branch for non-PR events (empty for PRs).
  ref: string
  repo: {owner: string; repo: string}
  skip: string
}

// Context is the subset of the GitHub Actions context used to resolve an
// upload target.
export interface Context {
  eventName: string
  sha: string
  ref: string
  repo: {owner: string; repo: string}
  payload: {
    pull_request?: {
      number?: number
      head?: {sha?: string; repo?: {full_name?: string}}
    }
  }
}

// resolveTarget determines which commit, pull request, or ref a coverage
// report should be attached to, mirroring actions/upload-code-coverage:
// merge queue runs and fork PRs are skipped, PR events use the head SHA and
// PR number, and other events use the triggering commit and ref.
export function resolveTarget(ctx: Context = github.context): Target {
  const none: Target = {
    commitOID: '',
    pullRequestNumber: 0,
    ref: '',
    repo: {owner: '', repo: ''},
    skip: ''
  }
  if (ctx.eventName === 'merge_group') {
    return {...none, skip: 'merge queue run'}
  }
  const repo = ctx.repo
  if (ctx.eventName === 'pull_request' || ctx.eventName === 'pull_request_target') {
    const pr = ctx.payload.pull_request
    const headRepo = pr?.head?.repo?.full_name ?? ''
    if (headRepo && headRepo !== `${repo.owner}/${repo.repo}`) {
      return {...none, skip: `fork pull request from ${headRepo}`}
    }
    return {
      ...none,
      commitOID: pr?.head?.sha ?? ctx.sha,
      pullRequestNumber: pr?.number ?? 0,
      repo
    }
  }
  return {...none, commitOID: ctx.sha, ref: ctx.ref, repo}
}

// Options describes a coverage report upload.
export interface Options {
  token: string
  baseURL: string
  repo: {owner: string; repo: string}
  // xml is the Cobertura XML report body.
  xml: string
  // language is the Linguist language name (e.g. "TypeScript").
  language: string
  // label identifies the report (e.g. "code-coverage/vitest").
  label: string
  commitOID: string
  // pullRequestNumber keys the report to a pull request (0 = use ref).
  pullRequestNumber: number
  // ref keys the report to a branch when pullRequestNumber is 0.
  ref: string
}

// buildReport builds the API payload from upload options: the XML is
// gzip-compressed and base64-encoded, and the report is keyed to either the
// pull request or the ref.
export function buildReport(opts: Options): Report {
  const report: Report = {
    commit_oid: opts.commitOID,
    coverage_report: zlib.gzipSync(Buffer.from(opts.xml)).toString('base64'),
    language_name: opts.language,
    label: opts.label
  }
  if (opts.pullRequestNumber > 0) {
    report.pull_request_number = opts.pullRequestNumber
  } else if (opts.ref) {
    report.ref = opts.ref
  } else {
    throw new Error('either a pull request number or a ref is required')
  }
  return report
}

// FetchLike is the subset of fetch used to call the coverage API.
export type FetchLike = (
  url: string,
  init: {method: string; headers: Record<string, string>; body: string}
) => Promise<{status: number; text(): Promise<string>}>

// Upload sends a coverage report to GitHub's code coverage API.
export type Upload = (opts: Options) => Promise<void>

// upload PUTs the report to GitHub's code coverage API and throws on any
// non-2xx response, surfacing the API's error message when one is present.
// A 404 is the API's answer when code quality is not enabled on the
// repository (currently org-only, in public preview), so it logs at info
// level and returns instead of throwing.
export async function upload(opts: Options, fetcher: FetchLike = fetch): Promise<void> {
  const report = buildReport(opts)
  const url = `${opts.baseURL.replace(/\/+$/, '')}/repos/${opts.repo.owner}/${opts.repo.repo}/code-coverage/report`
  const response = await fetcher(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(report)
  })
  const body = await response.text()
  if (response.status === 404) {
    core.info(
      'Coverage API upload skipped: code quality is not enabled on this repository (HTTP 404).'
    )
    return
  }
  if (response.status < 200 || response.status >= 300) {
    const hint =
      response.status === 403
        ? " Ensure the job has 'code-quality: write' permission and the repository has code quality enabled."
        : ''
    throw new Error(`coverage API returned HTTP ${response.status}: ${message(body)}.${hint}`)
  }
  const id = (parseJSONObject(body) as {id?: string}).id ?? ''
  core.info(`Coverage report uploaded to GitHub coverage API${id ? ` (id: ${id})` : ''}`)
}

// message extracts the human-readable message from an API JSON response,
// falling back to the (truncated) raw body.
function message(body: string): string {
  const msg = (parseJSONObject(body) as {message?: string}).message
  if (msg) return msg
  return body.length > 200 ? `${body.slice(0, 197)}...` : body
}

// parseJSONObject parses body as a JSON object, returning {} on any failure.
function parseJSONObject(body: string): object {
  try {
    const data: unknown = JSON.parse(body)
    return typeof data === 'object' && data !== null ? data : {}
  } catch {
    return {}
  }
}

// In-source tests for private helper functions
if (import.meta.vitest) {
  const {test, expect} = import.meta.vitest

  test.each([
    {body: '{"message": "Not Found"}', expected: 'Not Found'},
    {body: '{"id": "123"}', expected: '{"id": "123"}'},
    {body: 'plain text', expected: 'plain text'},
    {body: '[1,2]', expected: '[1,2]'},
    {body: `{"message": ""} ${'x'.repeat(300)}`, expectedLength: 200}
  ])('message($body)', ({body, expected, expectedLength}) => {
    const got = message(body)
    if (expected !== undefined) expect(got).toBe(expected)
    if (expectedLength !== undefined) expect(got.length).toBe(expectedLength)
  })
}
