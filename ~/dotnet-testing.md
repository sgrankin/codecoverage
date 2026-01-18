# .NET Code Coverage: Fast Iteration & Test Optimization

Strategies for improving code coverage quickly and reducing test runtime in .NET projects.

## The Problem

- Slow build times
- Tests take 10 minutes to run
- Only 24% coverage
- Need to iterate quickly, one file at a time

---

## Part 1: Fast Coverage Iteration

### Use Native .NET Coverage (No Extra Packages)

.NET 8+ has built-in coverage support:

```bash
dotnet test --collect:"Code Coverage;Format=cobertura"
```

No need for Coverlet, ReportGenerator, or XPlat packages.

### Speed Up the Inner Loop

```bash
# Skip rebuild when only tests changed
dotnet test --no-build --collect:"Code Coverage;Format=cobertura"

# Run only tests for the file you're working on
dotnet test --filter "FullyQualifiedName~MyClass" --collect:"Code Coverage;Format=cobertura"

# Continuous feedback
dotnet watch test --filter "FullyQualifiedName~MyClass"
```

### Isolate Build Scope

- Create a solution filter (`.slnf`) with only the projects you're working on
- Build/run only the specific test project targeting your code
- Disable unnecessary build steps in `Directory.Build.props` for dev iteration

---

## Part 2: Per-Test Coverage (The Direct Approach)

Microsoft's native coverage tooling supports **per-test coverage attribution**:

```bash
dotnet test --collect:"Code Coverage;Format=cobertura;PerTestCodeCoverage=true"
```

Or via `.runsettings`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<RunSettings>
  <DataCollectionRunSettings>
    <DataCollectors>
      <DataCollector friendlyName="Code Coverage">
        <Configuration>
          <Format>cobertura</Format>
          <PerTestCodeCoverage>True</PerTestCodeCoverage>
        </Configuration>
      </DataCollector>
    </DataCollectors>
  </DataCollectionRunSettings>
</RunSettings>
```

This generates a coverage matrix showing which lines each test covers:

| Test | Lines Covered |
|------|---------------|
| TestA | {line1, line5, line10} |
| TestB | {line1, line5, line12} |
| TestC | {line10, line15} |

### What You Can Compute From This

1. **Redundant tests**: If TestB covers a strict subset of TestA, TestB adds no coverage value
2. **Minimal covering set**: Apply greedy set-cover to find smallest test set maintaining coverage
3. **High-value tests**: Tests that uniquely cover certain lines
4. **Test overlap**: Identify duplicate coverage effort

---

## Part 3: Hash-Based Bisect (When Per-Test Is Too Slow)

Inspired by Russ Cox's hash-based bisect approach: instead of running each test individually, use binary search over hash-selected subsets.

### The Idea

Hash each test name. Filter tests by bit suffix:

```csharp
bool ShouldRun(string testName)
{
    var suffix = Environment.GetEnvironmentVariable("TEST_HASH_SUFFIX");
    if (string.IsNullOrEmpty(suffix)) return true;
    
    var hash = Convert.ToString(testName.GetHashCode(), 2); // binary
    return hash.EndsWith(suffix);
}
```

### Bisect Process

```bash
# Baseline
dotnet test --collect:"Code Coverage"  # → 24%, 10 min

# Split by hash suffix
TEST_HASH_SUFFIX=0 dotnet test ...     # → 22%, ~5 min  
TEST_HASH_SUFFIX=1 dotnet test ...     # → 18%, ~5 min

# If coverage(suffix=0) ≈ coverage(all), tests matching suffix=1 are redundant
# Recurse to find minimal essential set
```

### Finding Redundant Tests

```
coverage(all) = 24%
coverage(all except suffix=1) = 24%  → suffix=1 tests are redundant
  → recurse: coverage(all except suffix=11) still 24%? 
  → recurse: coverage(all except suffix=10) drops to 23%? Keep these.
```

### Why Hash-Based?

- No coordination needed - each test computes its own hash
- Works with any test runner supporting filters
- O(log N) test runs instead of N individual runs
- Implicit binary tree structure without maintaining indices

### Trade-offs

| Approach | Test Runs | Analysis |
|----------|-----------|----------|
| Per-test coverage | 1 (slower due to tracking) | Full matrix, optimal minimal set |
| Hash bisect | O(log N) | Approximate, iterative discovery |

Use per-test coverage when tooling supports it well. Use bisect when per-test tracking is too expensive or unavailable.

---

## Recommended Workflow

### Phase 1: Understand Current State

```bash
# Full coverage baseline with per-test attribution
dotnet test --settings:coverage.runsettings

# Analyze: which tests are redundant? which are essential?
```

### Phase 2: Reduce Test Runtime

1. Parse per-test coverage data
2. Identify tests that add no unique coverage
3. Mark as "redundant" or move to nightly-only suite
4. Create "fast" test category for CI

### Phase 3: Improve Coverage (Per-File Iteration)

```bash
# Pick lowest-coverage critical file
# Run only related tests with coverage
dotnet test --filter "FullyQualifiedName~TargetClass" \
  --collect:"Code Coverage;Format=cobertura" \
  --no-build

# Write tests for uncovered lines
# Verify coverage increase
# Commit and repeat
```

---

## References

### Microsoft Code Coverage Documentation

**URL**: https://github.com/microsoft/codecoverage

**Key findings**:
- Native .NET coverage with `--collect:"Code Coverage;Format=cobertura"`
- `PerTestCodeCoverage` setting (v17.14+) enables per-test attribution
- Configuration via `.runsettings` or inline parameters
- Disable native instrumentation for pure .NET projects to improve performance:
  ```xml
  <EnableStaticNativeInstrumentation>False</EnableStaticNativeInstrumentation>
  <EnableDynamicNativeInstrumentation>False</EnableDynamicNativeInstrumentation>
  ```

### Configuration Reference

**URL**: https://github.com/microsoft/codecoverage/blob/main/docs/configuration.md

**Key settings**:
- `PerTestCodeCoverage`: Collect coverage per test (enables redundancy analysis)
- `Format`: Output format (`coverage`, `cobertura`, `xml`)
- `IncludeTestAssembly`: Whether to include test project in coverage
- `ModulePaths`, `Sources`, `Functions`: Include/exclude filters

### Hash-Based Bisect Debugging

**URL**: https://research.swtch.com/bisect

**Key concepts**:
- Binary search over hash-selected subsets instead of explicit partitioning
- Each item computes its own hash - no coordination needed
- Suffix matching creates implicit binary tree: `suffix=0` vs `suffix=1`, then `00`/`01`/`10`/`11`
- Originally for compiler debugging (finding which optimization broke a test)
- Generalizes to any "find essential subset" problem
- Handles multiple culprits, not just single-cause problems
- O(log N) iterations to find essential elements

**Applicable insight**: Instead of "which change caused the bug?", ask "which tests are essential for coverage?" - same algorithm, inverted question.

### .NET Test Filtering

**URL**: https://learn.microsoft.com/en-us/dotnet/core/testing/selective-unit-tests

**Useful for**:
- `--filter` syntax for running test subsets
- Combining with coverage for fast per-file iteration
- Examples: `--filter "FullyQualifiedName~Namespace.Class"`, `--filter "Category=Unit"`
