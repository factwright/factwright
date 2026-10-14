#!/usr/bin/env bash
# Publishes one computer's installers for a release to downloads.factwright.com, as the release
# workflow does once that computer's build has passed. It never replaces a version that's out or a
# file that's up, keeps each version's files for good, and puts the update feed up last, so an
# installed copy finds a version only once its files are there. If it stops partway, running it
# again with the same files finishes the job.
#
#   publish.sh mac|windows <version> <folder with that computer's built files>
#
# It needs R2's credentials as AWS_* variables, BUCKET and ENDPOINT, as the workflow sets them.
set -euo pipefail

computer="$1"
version="$2"
dist="$3"

case "$computer" in
  mac)
    feed=latest-mac.yml
    installer="Factwright-$version.dmg"
    newest=Factwright.dmg
    files=("$dist"/*.dmg "$dist"/*.zip "$dist"/*.blockmap)
    ;;
  windows)
    feed=latest.yml
    installer="Factwright-Setup-$version.exe"
    newest=Factwright-Setup.exe
    files=("$dist"/*.exe "$dist"/*.blockmap)
    ;;
  *)
    echo "Publishes mac or windows, not $computer." >&2
    exit 2
    ;;
esac

upload() { aws s3 cp "$1" "s3://$BUCKET/$2" --endpoint-url "$ENDPOINT" --no-progress "${@:3}"; }

# A file's sha256, which each version's files are uploaded with.
digest() {
  if command -v sha256sum > /dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

# The sha256 a file is up with: nothing if it isn't up, or None if it went up without one. Any other
# problem asking stops the publish, rather than taking the file for missing and replacing it.
stored() {
  local answer
  if answer=$(aws s3api head-object --bucket "$BUCKET" --key "$1" --endpoint-url "$ENDPOINT" \
    --query Metadata.sha256 --output text 2>&1); then
    printf '%s' "$answer"
  elif [[ "$answer" == *"(404)"* ]]; then
    printf ''
  else
    echo "::error::Couldn't check whether $1 is up: $answer" >&2
    return 1
  fi
}

# The version the live update feed names, read from R2 itself: nothing if there's no feed yet. Any
# other problem reading it stops the publish, as there'd be no telling what's out.
live_version() {
  local answer named
  if answer=$(aws s3 cp "s3://$BUCKET/$feed" - --endpoint-url "$ENDPOINT" 2>&1); then
    named=$(printf '%s\n' "$answer" | tr -d '\r' | sed -n 's/^version: //p')
    if [ -z "$named" ]; then
      echo "::error::$feed is up, but names no version." >&2
      return 1
    fi
    printf '%s' "$named"
  elif [[ "$answer" == *"(404)"* ]]; then
    printf ''
  else
    echo "::error::Couldn't read $feed to see what's out: $answer" >&2
    return 1
  fi
}

live=$(live_version)
# The update feed goes up last, so once it names this version, there's nothing left to do.
if [ "$live" = "$version" ]; then
  echo "Factwright $version for $computer is out already."
  exit 0
fi
# The release's check did this when the run began, but re-running its failed jobs can come much
# later: a newer version that went out since mustn't be replaced by this one.
if [ -n "$live" ] && [ "$(printf '%s\n%s\n' "$live" "$version" | sort -V | tail -1)" != "$version" ]; then
  echo "::error::Factwright $live is out already, so $version can't go out after it."
  exit 1
fi

# A version's files never change once up, as browsers and Cloudflare keep them for good. So every
# file is checked before any goes up: one that's up already with the same sha256 is left as it is,
# as after a publish that stopped partway, and one that's up with other contents stops it all, as
# after "Re-run all jobs", which builds new files.
missing=()
for file in "${files[@]}"; do
  key=$(basename "$file")
  sum=$(digest "$file")
  up=$(stored "$key")
  if [ -z "$up" ]; then
    missing+=("$file")
  elif [ "$up" = "$sum" ]; then
    echo "$key is up already."
  else
    echo "::error::$key is up already, with other contents. Release the next version instead."
    exit 1
  fi
done
for file in ${missing[@]+"${missing[@]}"}; do
  upload "$file" "$(basename "$file")" --cache-control "public, max-age=31536000, immutable" \
    --metadata "sha256=$(digest "$file")"
done
# The version's update feed, kept, to put back if a later version has to be taken back.
upload "$dist/$feed" "feeds/$version/$feed" --cache-control no-cache --content-type text/yaml
# The website's link: the newest installer, under a name that never changes.
upload "$dist/$installer" "$newest" --cache-control no-cache
# The update feed goes last.
upload "$dist/$feed" "$feed" --cache-control no-cache --content-type text/yaml

# What installed copies will see, through Cloudflare.
curl --fail --silent --max-time 30 --retry 2 \
  "https://downloads.factwright.com/$feed?check=${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}" |
  grep -q "^version: $version$"
echo "Factwright $version for $computer is out."
