#!/bin/bash

# Dispatch Pro - Commit Message Generator Utility
# Usage: ./scripts/generate-commit-message.sh [--help]
# 
# This script analyzes staged changes and generates a meaningful commit message
# following the Conventional Commits specification.

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Help message
show_help() {
  cat << EOF
${BLUE}Dispatch Pro - Commit Message Generator${NC}

${GREEN}USAGE:${NC}
  ./scripts/generate-commit-message.sh [options]

${GREEN}OPTIONS:${NC}
  --help, -h      Show this help message
  --type TYPE     Force commit type (feat, fix, docs, etc.)
  --scope SCOPE   Add scope to commit message
  --analyze       Show analysis of staged changes
  --preview       Preview generated message without committing
  --commit        Auto-generate and commit immediately

${GREEN}EXAMPLES:${NC}
  # Analyze staged changes
  ./scripts/generate-commit-message.sh --analyze

  # Preview generated message
  ./scripts/generate-commit-message.sh --preview

  # Generate and commit with custom type
  ./scripts/generate-commit-message.sh --type feat --scope api --commit

${GREEN}CONVENTIONAL COMMITS FORMAT:${NC}
  feat(scope): Add new feature
  fix(scope): Fix a bug
  docs: Update documentation
  style: Code style changes (formatting, semicolons, etc.)
  refactor(scope): Refactor code
  perf(scope): Performance improvements
  test: Add or update tests
  chore: Maintenance tasks
  ci: CI/CD configuration changes
  revert: Revert previous commit

EOF
}

# Parse arguments
FORCE_TYPE=""
FORCE_SCOPE=""
ACTION="auto"

while [[ $# -gt 0 ]]; do
  case $1 in
    --help|-h)
      show_help
      exit 0
      ;;
    --type)
      FORCE_TYPE="$2"
      shift 2
      ;;
    --scope)
      FORCE_SCOPE="$2"
      shift 2
      ;;
    --analyze)
      ACTION="analyze"
      shift
      ;;
    --preview)
      ACTION="preview"
      shift
      ;;
    --commit)
      ACTION="commit"
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      show_help
      exit 1
      ;;
  esac
done

# Check if there are staged changes
STAGED_COUNT=$(git diff --cached --name-only | wc -l)
if [ $STAGED_COUNT -eq 0 ]; then
  echo -e "${RED}❌ No staged changes found. Use 'git add' to stage files.${NC}"
  exit 1
fi

# Analyze staged changes
echo -e "${BLUE}📊 Analyzing staged changes...${NC}\n"

STAGED_FILES=$(git diff --cached --name-only)
STAGED_STATS=$(git diff --cached --stat)

echo -e "${YELLOW}Staged files:${NC}"
echo "$STAGED_FILES" | head -5
if [ $(echo "$STAGED_FILES" | wc -l) -gt 5 ]; then
  echo "... and $(($(echo "$STAGED_FILES" | wc -l) - 5)) more files"
fi

echo -e "\n${YELLOW}Statistics:${NC}"
echo "$STAGED_STATS" | tail -1

# Count file types
NEW_FILES=$(git diff --cached --name-only --diff-filter=A | wc -l)
MODIFIED_FILES=$(git diff --cached --name-only --diff-filter=M | wc -l)
DELETED_FILES=$(git diff --cached --name-only --diff-filter=D | wc -l)
RENAMED_FILES=$(git diff --cached --name-only --diff-filter=R | wc -l)

echo -e "\n${YELLOW}Change summary:${NC}"
[ $NEW_FILES -gt 0 ] && echo "  + New files: $NEW_FILES"
[ $MODIFIED_FILES -gt 0 ] && echo "  ✏️  Modified: $MODIFIED_FILES"
[ $DELETED_FILES -gt 0 ] && echo "  ✗ Deleted: $DELETED_FILES"
[ $RENAMED_FILES -gt 0 ] && echo "  ➜ Renamed: $RENAMED_FILES"

# File type analysis
HAS_JS=$(git diff --cached --name-only | grep -cE '\.js$|\.json$' || true)
HAS_MD=$(git diff --cached --name-only | grep -cE '\.md$' || true)
HAS_HTML=$(git diff --cached --name-only | grep -cE '\.html$' || true)
HAS_CONFIG=$(git diff --cached --name-only | grep -cE 'config|\.env|\.yaml|\.yml' || true)

echo -e "\n${YELLOW}File types:${NC}"
[ $HAS_JS -gt 0 ] && echo "  JavaScript: $HAS_JS files"
[ $HAS_MD -gt 0 ] && echo "  Markdown: $HAS_MD files"
[ $HAS_HTML -gt 0 ] && echo "  HTML: $HAS_HTML files"
[ $HAS_CONFIG -gt 0 ] && echo "  Config: $HAS_CONFIG files"

if [ "$ACTION" = "analyze" ]; then
  exit 0
fi

# Generate commit message
echo -e "\n${BLUE}🔍 Generating commit message...${NC}\n"

COMMIT_TYPE="$FORCE_TYPE"
COMMIT_SCOPE="$FORCE_SCOPE"
COMMIT_SUBJECT=""

# Auto-detect type if not forced
if [ -z "$COMMIT_TYPE" ]; then
  if [ $NEW_FILES -gt 0 ] && [ $MODIFIED_FILES -eq 0 ] && [ $DELETED_FILES -eq 0 ]; then
    if [ $HAS_MD -gt 0 ]; then
      COMMIT_TYPE="docs"
      COMMIT_SUBJECT="Add comprehensive documentation"
    elif [ $HAS_JS -gt 0 ]; then
      COMMIT_TYPE="feat"
      COMMIT_SUBJECT="Add new modules and features"
    else
      COMMIT_TYPE="feat"
      COMMIT_SUBJECT="Add new files"
    fi
  elif [ $MODIFIED_FILES -gt 0 ]; then
    if [ $HAS_MD -gt 0 ] && [ $HAS_JS -eq 0 ]; then
      COMMIT_TYPE="docs"
      COMMIT_SUBJECT="Update documentation"
    elif [ $HAS_CONFIG -gt 0 ]; then
      COMMIT_TYPE="config"
      COMMIT_SUBJECT="Update configuration"
    elif [ $HAS_JS -gt 0 ]; then
      COMMIT_TYPE="refactor"
      COMMIT_SUBJECT="Improve and optimize code"
    else
      COMMIT_TYPE="chore"
      COMMIT_SUBJECT="Update files"
    fi
  else
    COMMIT_TYPE="chore"
    COMMIT_SUBJECT="Update repository"
  fi
fi

# Auto-detect scope if not forced
if [ -z "$COMMIT_SCOPE" ]; then
  if [ $HAS_JS -gt 0 ]; then
    COMMIT_SCOPE="core"
  elif [ $HAS_MD -gt 0 ]; then
    COMMIT_SCOPE="docs"
  fi
fi

# Add scope to subject if present
if [ ! -z "$COMMIT_SCOPE" ]; then
  COMMIT_MSG="${COMMIT_TYPE}(${COMMIT_SCOPE}): ${COMMIT_SUBJECT}"
else
  COMMIT_MSG="${COMMIT_TYPE}: ${COMMIT_SUBJECT}"
fi

# Add statistics as body
COMMIT_BODY=$(echo "$STAGED_STATS" | head -15)

# Display preview
echo -e "${GREEN}Generated commit message:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$COMMIT_MSG"
echo ""
echo "$COMMIT_BODY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$ACTION" = "preview" ]; then
  exit 0
fi

if [ "$ACTION" = "commit" ]; then
  # Commit with generated message
  git commit -m "$COMMIT_MSG" -m "$COMMIT_BODY"
  echo -e "\n${GREEN}✅ Commit successful!${NC}"
  echo -e "${BLUE}Message:${NC} $COMMIT_MSG"
else
  # Interactive - ask for confirmation or modification
  echo -e "\n${YELLOW}Options:${NC}"
  echo "  1) Accept and commit"
  echo "  2) Edit message"
  echo "  3) Cancel"
  read -p "Choose option (1-3): " CHOICE

  case $CHOICE in
    1)
      git commit -m "$COMMIT_MSG" -m "$COMMIT_BODY"
      echo -e "\n${GREEN}✅ Commit successful!${NC}"
      ;;
    2)
      TEMP_FILE=$(mktemp)
      echo "$COMMIT_MSG" > "$TEMP_FILE"
      echo "" >> "$TEMP_FILE"
      echo "$COMMIT_BODY" >> "$TEMP_FILE"
      ${EDITOR:-nano} "$TEMP_FILE"
      git commit -F "$TEMP_FILE"
      rm "$TEMP_FILE"
      echo -e "\n${GREEN}✅ Commit successful!${NC}"
      ;;
    3)
      echo -e "${YELLOW}⊘ Commit cancelled${NC}"
      exit 1
      ;;
    *)
      echo -e "${RED}Invalid option${NC}"
      exit 1
      ;;
  esac
fi
