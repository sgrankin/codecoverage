import {test, expect} from 'vitest'
import * as diff from '../../src/utils/diff'
import {getFixturePath} from '../fixtures/util'
import * as fs from 'fs'

test('should parse Git diff from fixture', async function () {
  const path = getFixturePath('test.diff')
  const diffOutput = fs.readFileSync(path, 'utf8')
  const output = diff.parse(diffOutput)

  expect(output).toMatchSnapshot()
})

const parseGitDiffTestCases = [
  {
    name: 'empty diff',
    input: '',
    expected: []
  },
  {
    name: 'malformed header line (line numbers default to 0)',
    input: `diff --git a/file.txt b/file.txt
index abcdefg..1234567 100644
--- a/file.txt
+++ b/file.txt
@@ malformed header @@
+added line`,
    expected: [{filename: 'file.txt', addedLines: [0], deletedLines: []}]
  },
  {
    name: 'diff with only deletions',
    input: `diff --git a/file.txt b/file.txt
index abcdefg..1234567 100644
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,1 @@
 line1
-deleted line 1
-deleted line 2`,
    expected: [{filename: 'file.txt', addedLines: [], deletedLines: [2, 3]}]
  },
  {
    name: 'multiple files in diff',
    input: `diff --git a/file1.txt b/file1.txt
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
 line6`,
    expected: [
      {filename: 'file1.txt', addedLines: [2], deletedLines: []},
      {filename: 'file2.txt', addedLines: [6], deletedLines: []}
    ]
  }
]

test.each(parseGitDiffTestCases)('parse: $name', ({input, expected}) => {
  expect(diff.parse(input)).toEqual(expected)
})
