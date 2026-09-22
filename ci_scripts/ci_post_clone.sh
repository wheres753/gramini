#!/bin/sh
# Xcode Cloud runs this right after cloning, before it looks for the project.
# The .xcodeproj is not committed (XcodeGen generates it from project.yml).
set -eu

cd "$CI_PRIMARY_REPOSITORY_PATH"

echo "== Installing XcodeGen"
brew install xcodegen

echo "== Stamping build number ${CI_BUILD_NUMBER:-<unset>}"
if [ -n "${CI_BUILD_NUMBER:-}" ]; then
  # project.yml keeps "1" for local builds; Xcode Cloud's build number goes in here.
  sed -i '' "s/^\( *CURRENT_PROJECT_VERSION: \)\"[0-9]*\"/\1\"${CI_BUILD_NUMBER}\"/" project.yml
  grep -n "CURRENT_PROJECT_VERSION" project.yml
fi

echo "== Generating Gramini.xcodeproj"
xcodegen generate

echo "== Checking chrome/ is in sync with shared/"
scripts/sync-filter.sh --check
