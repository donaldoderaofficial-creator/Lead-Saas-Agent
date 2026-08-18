# Automatic Commit Message System

## Overview

Dispatch Pro includes an intelligent automatic commit message generation system that follows the **Conventional Commits** specification. This ensures consistent, well-formatted commit messages across the project.

---

## Features

✅ **Automatic Detection** - Analyzes staged changes to determine commit type  
✅ **Conventional Format** - Follows industry-standard commit message format  
✅ **Scope Support** - Automatically adds scope based on changed files  
✅ **Statistics** - Includes file change statistics in commit body  
✅ **Interactive Mode** - Review and edit generated messages before committing  
✅ **Git Hooks** - Automatic message generation on `git commit`  
✅ **npm Scripts** - Easy commands for different commit workflows  

---

## Quick Start

### Automatic Commit (Recommended)
```bash
# Stage your changes
git add .

# Auto-generate and commit
npm run commit

# OR use the git hook (commits immediately with auto-generated message)
git commit
```

### Interactive Mode
```bash
# Preview generated message (no commit)
npm run commit:preview

# Analyze staged changes
npm run commit:analyze

# Interactive: Review, edit, and commit
npm run commit:interactive
```

---

## Available npm Scripts

### `npm run commit`
**Auto-generate and commit immediately**
```bash
npm run commit
```
Perfect for quick commits when you're confident in the generated message.

### `npm run commit:preview`
**Preview generated message without committing**
```bash
npm run commit:preview
```
Review the message before deciding whether to commit.

### `npm run commit:analyze`
**Analyze staged changes**
```bash
npm run commit:analyze
```
Detailed breakdown of what changed (file types, counts, statistics).

### `npm run commit:interactive`
**Interactive commit with review options**
```bash
npm run commit:interactive
```
1. Accept and commit
2. Edit message
3. Cancel

---

## Conventional Commits Format

All commit messages follow this format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Commit Types

| Type | Purpose | Example |
|------|---------|---------|
| **feat** | New feature | `feat(auth): Add TOTP 2FA support` |
| **fix** | Bug fix | `fix(api): Resolve rate limit error` |
| **docs** | Documentation | `docs: Update API documentation` |
| **style** | Code style (formatting, semicolons) | `style: Format code` |
| **refactor** | Code refactoring | `refactor(server): Improve error handling` |
| **perf** | Performance improvement | `perf(cache): Add TTL-based caching` |
| **test** | Add/update tests | `test: Add integration tests` |
| **chore** | Build, CI, dependencies | `chore: Update dependencies` |
| **ci** | CI/CD configuration | `ci: Add GitHub Actions workflow` |
| **revert** | Revert previous commit | `revert: Revert "add feature X"` |

### Examples

**Feature:**
```
feat(config): Add centralized configuration system

- Centralized config.js for environment management
- Feature flags for conditional functionality
- Multi-tier pricing configuration
- Performance and security settings

Closes #42
```

**Documentation:**
```
docs: Add comprehensive API documentation

- Complete endpoint reference (API.md)
- Request/response examples
- Error handling guide
- Rate limiting information
```

**Refactoring:**
```
refactor(server): Improve error handling middleware

- Centralized error handling
- Structured error logging
- Graceful shutdown support

BREAKING CHANGE: Error response format changed
```

---

## How Automatic Detection Works

### File Type Analysis
The system analyzes staged files to determine the commit type:

- **JavaScript files** (`.js`, `.json`) → `feat` or `refactor`
- **Markdown files** (`.md`) → `docs`
- **Config files** (`.env`, `config.*`) → `config`
- **HTML files** (`.html`) → `style` or `feat`

### Change Detection
```bash
NEW FILES only      → "Add new modules/features"
MODIFIED files      → "Update/improve existing code"
DELETED files       → "Remove files"
Config changes      → "Update configuration"
Documentation       → "Add/update docs"
```

### Scope Assignment
Scopes are automatically assigned based on file types:
- JavaScript/JSON → `core` or `api`
- Documentation → `docs`
- Configuration → `config`

---

## Manual Scope/Type Override

If you want to override the automatic detection:

```bash
# Force a specific type
bash scripts/generate-commit-message.sh --type feat --scope auth --preview

# Then commit
npm run commit
```

---

## Git Hook Integration

### Auto-Generate on `git commit`
The `.git/hooks/prepare-commit-msg` hook automatically runs when you use `git commit`:

```bash
# This automatically generates a commit message if one isn't provided
git commit

# OR specify a message (hook won't override it)
git commit -m "Your custom message"
```

### Setup Hook (if needed)
```bash
chmod +x .git/hooks/prepare-commit-msg
```

---

## Integration with IDE

### VS Code
Edit `.vscode/settings.json`:
```json
{
  "git.confirmSync": false,
  "git.ignoreRebaseWarning": true
}
```

Then use the Source Control panel and select "Commit" → messages auto-fill.

### GitHub Desktop
1. Stage changes in GitHub Desktop
2. Use "Commit to main" → generates message automatically

### Command Line
```bash
# Simple workflow
git add .
npm run commit

# Or with preview
git add .
npm run commit:preview
# Review, then decide
```

---

## Benefits

✅ **Consistency** - All team members use the same commit message format  
✅ **Readability** - Easy to scan and understand commit history  
✅ **Automation** - Reduces manual typing and formatting  
✅ **Semantics** - Commit types are meaningful and searchable  
✅ **Changelog** - Can auto-generate changelog from conventional commits  
✅ **CI/CD** - Enables semantic versioning and automated releases  

---

## Best Practices

### ✅ Do
- **Commit related changes** - Don't mix refactoring with new features
- **Use npm scripts** - Makes committing consistent across team
- **Review messages** - Use `--preview` before final commit
- **Keep subjects short** - 50 characters or less
- **Be specific** - "Add cache system" not "Add stuff"

### ❌ Don't
- **Commit too much at once** - Smaller, logical commits are better
- **Force wrong types** - Let the system auto-detect
- **Mix concerns** - Keep features, docs, and chores separate
- **Skip message review** - Always check your commit messages

---

## Troubleshooting

### Messages not auto-generating on `git commit`?
Check if hook is executable:
```bash
chmod +x .git/hooks/prepare-commit-msg
ls -la .git/hooks/prepare-commit-msg  # Should have 'x' permission
```

### Wrong commit type detected?
Override it:
```bash
npm run commit:interactive
# Then choose "Edit message" and fix the type
```

### Want to use custom message without hook?
Pass it explicitly:
```bash
git commit -m "Your custom message"
# Hook won't override explicit messages
```

### Script not found?
Make sure you're in the project root:
```bash
cd /workspaces/Lead-Saas-Agent
npm run commit:preview
```

---

## Integration with CI/CD

### GitHub Actions
Use conventional commits to trigger semantic versioning:

```yaml
- name: Semantic Release
  uses: cycjimmy/semantic-release-action@v3
  # Automatically versions based on commit messages
```

### Commit Lint
Validate commits in CI:

```bash
# In GitHub Actions
npx commitlint --from HEAD~1 --to HEAD
```

### Changelog Generation
Generate changelog from commits:

```bash
npx standard-changelog
```

---

## Migration from Manual Commits

If you have old manual commits, you can:

1. **Keep them as-is** - No migration needed
2. **Rewrite selectively** - `git rebase --interactive`
3. **Update going forward** - Start using new system for all new commits

```bash
# Example: Interactive rebase last 5 commits
git rebase -i HEAD~5
```

---

## Statistics

### Enabled by Default
- ✅ Git hook: `.git/hooks/prepare-commit-msg`
- ✅ npm scripts in `package.json`
- ✅ Message template: `.gitmessage`
- ✅ Generator script: `scripts/generate-commit-message.sh`

### Zero Configuration
The system works immediately after `npm install`. No additional setup required!

---

## Example Workflow

```bash
# 1. Make changes to code
echo "new feature" >> file.js

# 2. Stage changes
git add file.js

# 3. Preview generated message (optional)
npm run commit:preview
# Output:
# feat(core): Add new modules and features
# 
# file.js                                            | 1 +
# 1 file changed, 1 insertion(+)

# 4. Commit with generated message
npm run commit
# ✅ Commit successful!
# Message: feat(core): Add new modules and features

# 5. View commit history
git log --oneline
# 3a1b2c3 feat(core): Add new modules and features
# 9e8d7c6 docs: Update API documentation
# 5f4e3d2 refactor(server): Improve error handling
```

---

## Support

For issues or suggestions:
- Check `.git/hooks/prepare-commit-msg` is executable
- Review `scripts/generate-commit-message.sh` for customization
- Ensure git is properly configured: `git config --global user.email`

---

**Last Updated:** August 18, 2026  
**Dispatch Pro v2.0**  
**Automatic Commit Message System**
