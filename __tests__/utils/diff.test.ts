import {test, expect} from 'vitest'
import {parseGitDiff} from '../../src/utils/diff'
import {getFixturePath} from '../fixtures/util'
import * as fs from 'fs'

test('should parse Git diff', async function () {
  const path = getFixturePath('test.diff')
  const diffOutput = fs.readFileSync(path, 'utf8')
  const output = parseGitDiff(diffOutput)

  expect(output).toMatchSnapshot()
})

test('should handle malformed header line', function () {
  const diffOutput = `diff --git a/file.txt b/file.txt
index abcdefg..1234567 100644
--- a/file.txt
+++ b/file.txt
@@ malformed header @@
+added line`

  const output = parseGitDiff(diffOutput)

  // With malformed header, line numbers default to 0
  expect(output).toEqual([
    {
      filename: 'file.txt',
      addedLines: [0],
      deletedLines: []
    }
  ])
})

test('should handle empty diff', function () {
  const output = parseGitDiff('')
  expect(output).toEqual([])
})

test('should handle diff with only deletions', function () {
  const diffOutput = `diff --git a/file.txt b/file.txt
index abcdefg..1234567 100644
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,1 @@
 line1
-deleted line 1
-deleted line 2`

  const output = parseGitDiff(diffOutput)

  expect(output).toEqual([
    {
      filename: 'file.txt',
      addedLines: [],
      deletedLines: [2, 3]
    }
  ])
})

test('should handle multiple files in diff', function () {
  const diffOutput = `diff --git a/file1.txt b/file1.txt
index abcdefg..1234567 100644
--- a/file1.txt
+++ b/file1.txt
@@ -1,2 +1,3 @@
 line1
+added in file1
 line2
diff --git a/file2.txt b/file2.txt
index abcdefg..1234567 100644
--- a/file2.txt
+++ b/file2.txt
@@ -5,2 +5,3 @@
 line5
+added in file2
 line6`

  const output = parseGitDiff(diffOutput)

  expect(output).toEqual([
    {
      filename: 'file1.txt',
      addedLines: [2],
      deletedLines: []
    },
    {
      filename: 'file2.txt',
      addedLines: [6],
      deletedLines: []
    }
  ])
})
