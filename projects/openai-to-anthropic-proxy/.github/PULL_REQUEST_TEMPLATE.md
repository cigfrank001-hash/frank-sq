## Summary

<!-- One or two sentences. What does this PR change and why? -->

## Type of change

<!-- Check one or more -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing behavior to change)
- [ ] Documentation update

## How was this tested?

<!-- Be specific. "It works" is not a test. -->

- [ ] `node --check proxy.js` passes
- [ ] `node test-integration.js` reports 39+ passed, 0 failed (or describes new tests)
- [ ] `node test-concurrency.js` still passes
- [ ] Manual curl smoke test against mock upstream
- [ ] (If applicable) Manual test against real MiniMax endpoint

## Checklist

- [ ] I have read `CONTRIBUTING.md`
- [ ] My change matches the existing code style
- [ ] I have updated `README.md` if user-facing behavior changed
- [ ] I have updated `CHANGELOG.md` under the unreleased / next version section
- [ ] I have NOT added any npm runtime dependencies (zero-deps is a project constraint)

## Screenshots / logs

If relevant, paste the proxy log showing the new behavior.