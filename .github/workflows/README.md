# GitHub Actions Workflows

This directory contains the GitHub Actions workflows for the `cenglu` logging library.

## Workflows

### 1. CI (`.github/workflows/ci.yml`)
- **Triggers**: Push to main, Pull requests
- **Purpose**: Validates code quality and tests
- **Checks**:
  - Linting with Biome
  - TypeScript type checking
  - Unit tests with Vitest
  - Build verification (ESM and CJS)
- **Node versions**: Tests against Node 18, 20, and 22

### 2. Release to NPM (`.github/workflows/release.yml`)
- **Triggers**: Push of version tags (v*.*.*)
- **Purpose**: Publishes the package to NPM
- **Features**:
  - Version validation (prevents duplicate publishes)
  - Tag and package.json version matching
  - NPM provenance attestation
  - Automatic GitHub release creation
- **Required Secret**: `NPM_TOKEN`

### 3. Security Audit (`.github/workflows/audit.yml`)
- **Triggers**: Push to main, PRs, Daily schedule (2 AM UTC)
- **Purpose**: Security and dependency management
- **Checks**:
  - NPM audit for vulnerabilities
  - Outdated dependency detection
  - License compatibility check
  - Dependency review on PRs

### 4. CodeQL Analysis (`.github/workflows/codeql.yml`)
- **Triggers**: Push to main, PRs, Weekly schedule (Monday 3 AM UTC)
- **Purpose**: Advanced code security analysis
- **Features**:
  - Detects security vulnerabilities
  - Code quality analysis
  - SARIF results upload

### 5. Size Limit (`.github/workflows/size.yml`)
- **Triggers**: Pull requests
- **Purpose**: Monitor package size
- **Features**:
  - Build size calculation
  - NPM package size check
  - PR comment with size report
  - Size limit warnings

## Setup Instructions

### 1. NPM Token Setup (Required for releases)

1. Generate an NPM access token:
   - Go to https://www.npmjs.com/
   - Sign in to your account
   - Click on your profile → Access Tokens
   - Generate New Token → Classic Token
   - Select "Automation" type
   - Copy the token

2. Add the token to GitHub:
   - Go to your repository on GitHub
   - Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Paste your NPM token
   - Click "Add secret"

### 2. Branch Protection (Recommended)

1. Go to Settings → Branches
2. Add rule for `main` branch
3. Enable:
   - "Require status checks to pass before merging"
   - Select: "Validate on Node 20" (or all Node versions)
   - "Require branches to be up to date before merging"

### 3. Release Process

To release a new version:

1. Update version in `package.json`:
   ```bash
   npm version patch  # or minor/major
   ```

2. Commit the version change:
   ```bash
   git add package.json
   git commit -m "chore: bump version to x.x.x"
   git push origin main
   ```

3. Create and push a version tag:
   ```bash
   git tag v1.2.3  # Replace with your version
   git push origin v1.2.3
   ```

The release workflow will automatically:
- Validate the version
- Run all tests
- Publish to NPM with provenance
- Create a GitHub release

## Workflow Status Badges

Add these badges to your README.md:

```markdown
[![CI](https://github.com/ayungavis/cenglu/actions/workflows/ci.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/ci.yml)
[![Security Audit](https://github.com/ayungavis/cenglu/actions/workflows/audit.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/audit.yml)
[![CodeQL](https://github.com/ayungavis/cenglu/actions/workflows/codeql.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/codeql.yml)
[![Release](https://github.com/ayungavis/cenglu/actions/workflows/release.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/release.yml)
[![Size Limit](https://github.com/ayungavis/cenglu/actions/workflows/size.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/size.yml)
```

## Troubleshooting

### Release fails with "version already exists"
- The version in package.json has already been published to NPM
- Bump the version and create a new tag

### CI fails on PRs
- Ensure your code passes:
  - `bun run lint`
  - `bun run check:types`
  - `bun run test`
  - `bun run build`

### NPM publish fails with 401/403
- Check that `NPM_TOKEN` secret is set correctly
- Ensure the token has publish permissions
- Token may have expired - generate a new one