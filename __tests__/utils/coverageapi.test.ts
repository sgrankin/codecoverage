import * as zlib from 'node:zlib'
import {expect, test} from 'vitest'
import * as coverageapi from '../../src/utils/coverageapi.ts'
import {captureStdout} from '../fixtures/capture-stdout.ts'

// makeContext builds a Context with sensible defaults, overridable per test.
function makeContext(overrides: Partial<coverageapi.Context> = {}): coverageapi.Context {
  return {
    eventName: 'push',
    sha: 'pushsha',
    ref: 'refs/heads/main',
    repo: {owner: 'owner', repo: 'repo'},
    payload: {},
    ...overrides
  }
}

test.each([
  {
    name: 'push uses the commit SHA and ref',
    ctx: makeContext(),
    want: {commitOID: 'pushsha', pullRequestNumber: 0, ref: 'refs/heads/main', skip: ''}
  },
  {
    name: 'pull_request uses the head SHA and PR number',
    ctx: makeContext({
      eventName: 'pull_request',
      payload: {
        pull_request: {number: 42, head: {sha: 'headsha', repo: {full_name: 'owner/repo'}}}
      }
    }),
    want: {commitOID: 'headsha', pullRequestNumber: 42, ref: '', skip: ''}
  },
  {
    name: 'pull_request_target uses the head SHA and PR number',
    ctx: makeContext({
      eventName: 'pull_request_target',
      payload: {
        pull_request: {number: 7, head: {sha: 'headsha', repo: {full_name: 'owner/repo'}}}
      }
    }),
    want: {commitOID: 'headsha', pullRequestNumber: 7, ref: '', skip: ''}
  },
  {
    name: 'fork pull request is skipped',
    ctx: makeContext({
      eventName: 'pull_request',
      payload: {
        pull_request: {number: 42, head: {sha: 'headsha', repo: {full_name: 'fork/repo'}}}
      }
    }),
    want: {
      commitOID: '',
      pullRequestNumber: 0,
      ref: '',
      skip: 'fork pull request from fork/repo'
    }
  },
  {
    name: 'merge queue run is skipped',
    ctx: makeContext({eventName: 'merge_group'}),
    want: {commitOID: '', pullRequestNumber: 0, ref: '', skip: 'merge queue run'}
  },
  {
    name: 'workflow_dispatch uses the commit SHA and ref',
    ctx: makeContext({eventName: 'workflow_dispatch', ref: 'refs/heads/release'}),
    want: {commitOID: 'pushsha', pullRequestNumber: 0, ref: 'refs/heads/release', skip: ''}
  }
])('resolveTarget: $name', ({ctx, want}) => {
  const got = coverageapi.resolveTarget(ctx)
  expect(got).toMatchObject(want)
})

// makeOptions builds upload Options with sensible defaults.
function makeOptions(overrides: Partial<coverageapi.Options> = {}): coverageapi.Options {
  return {
    token: 'test-token',
    baseURL: 'https://api.github.com',
    repo: {owner: 'owner', repo: 'repo'},
    xml: '<coverage/>',
    language: 'TypeScript',
    label: 'code-coverage/vitest',
    commitOID: 'abc123',
    pullRequestNumber: 42,
    ref: '',
    ...overrides
  }
}

test('buildReport gzips and base64-encodes the XML', () => {
  const report = coverageapi.buildReport(makeOptions())
  const decoded = zlib.gunzipSync(Buffer.from(report.coverage_report, 'base64')).toString()
  expect(decoded).toBe('<coverage/>')
  expect(report.commit_oid).toBe('abc123')
  expect(report.language_name).toBe('TypeScript')
  expect(report.label).toBe('code-coverage/vitest')
})

test('buildReport keys the report to the PR when a number is set', () => {
  const report = coverageapi.buildReport(makeOptions({pullRequestNumber: 42, ref: 'refs/x'}))
  expect(report.pull_request_number).toBe(42)
  expect(report.ref).toBeUndefined()
})

test('buildReport keys the report to the ref when no PR number is set', () => {
  const report = coverageapi.buildReport(
    makeOptions({pullRequestNumber: 0, ref: 'refs/heads/main'})
  )
  expect(report.pull_request_number).toBeUndefined()
  expect(report.ref).toBe('refs/heads/main')
})

test('buildReport throws when neither PR number nor ref is set', () => {
  expect(() => coverageapi.buildReport(makeOptions({pullRequestNumber: 0, ref: ''}))).toThrow(
    'either a pull request number or a ref is required'
  )
})

// fakeFetch returns a FetchLike that records the request and responds with
// the given status and body.
function fakeFetch(
  status: number,
  body: string
): {
  fetcher: coverageapi.FetchLike
  requests: {url: string; init: {method: string; headers: Record<string, string>; body: string}}[]
} {
  const requests: {
    url: string
    init: {method: string; headers: Record<string, string>; body: string}
  }[] = []
  const fetcher: coverageapi.FetchLike = async (url, init) => {
    requests.push({url, init})
    return {status, text: async () => body}
  }
  return {fetcher, requests}
}

test('upload PUTs the report to the coverage endpoint', async () => {
  const capture = captureStdout()
  const {fetcher, requests} = fakeFetch(200, '{"id": "report-1"}')

  await coverageapi.upload(makeOptions(), fetcher)

  expect(requests).toHaveLength(1)
  const req = requests[0]!
  expect(req.url).toBe('https://api.github.com/repos/owner/repo/code-coverage/report')
  expect(req.init.method).toBe('PUT')
  expect(req.init.headers.Authorization).toBe('Bearer test-token')
  expect(req.init.headers.Accept).toBe('application/vnd.github+json')
  const payload = JSON.parse(req.init.body) as coverageapi.Report
  expect(payload.pull_request_number).toBe(42)
  expect(capture.output()).toContain(
    'Coverage report uploaded to GitHub coverage API (id: report-1)'
  )
})

test('upload strips trailing slashes from the base URL', async () => {
  const capture = captureStdout()
  const {fetcher, requests} = fakeFetch(201, '{}')

  await coverageapi.upload(makeOptions({baseURL: 'https://ghe.example.com/api/v3/'}), fetcher)
  expect(requests[0]!.url).toBe(
    'https://ghe.example.com/api/v3/repos/owner/repo/code-coverage/report'
  )
  void capture
})

test('upload throws with the API message on failure', async () => {
  const {fetcher} = fakeFetch(422, '{"message": "commit not found"}')

  await expect(coverageapi.upload(makeOptions(), fetcher)).rejects.toThrow(
    'coverage API returned HTTP 422: commit not found'
  )
})

test('upload includes a permission hint on 403', async () => {
  const {fetcher} = fakeFetch(403, '{"message": "not authorized"}')

  await expect(coverageapi.upload(makeOptions(), fetcher)).rejects.toThrow(/code-quality: write/)
})
