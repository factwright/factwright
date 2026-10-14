#!/usr/bin/env bash
# Publishes one computer's installers for a release to downloads.factwright.com, as the release
# workflow does once that computer's build has passed. It never puts out a version that's been taken
# back or is older than the one out, never changes a version's files once they're up, and puts the
# update feed up last, so an installed copy finds a version only once its files are there. If it
# stops partway, running it again with the same files finishes the job.
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

# R2 needs the AWS CLI's classic transfer client: the CRT one, the default from version 2.38, can
# fail R2's signature checks on downloads.
AWS_CONFIG_FILE=$(mktemp)
export AWS_CONFIG_FILE
trap 'rm -f "$AWS_CONFIG_FILE"' EXIT
printf '[default]\ns3 =\n  preferred_transfer_client = classic\n' > "$AWS_CONFIG_FILE"

upload() { aws s3 cp "$1" "s3://$BUCKET/$2" --endpoint-url "$ENDPOINT" --no-progress "${@:3}"; }

# A file's sha256, which each version's files are uploaded with.
digest() {
  if command -v sha256sum > /dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

# What R2 has under a key: its sha256, None if it's up without one, or nothing if it isn't up. Any
# other problem asking stops the publish, rather than taking the file for missing and replacing it.
stored() {
  local answer
  if answer=$(aws s3api head-object --bucket "$BUCKET" --key "$1" --endpoint-url "$ENDPOINT" \
    --query Metadata.sha256 --output text 2>&1); then
    printf '%s' "${answer:-None}"
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

# Stops unless the update feed installed copies read, through Cloudflare, names this version.
check_live() {
  local served
  served=$(curl --fail --silent --max-time 30 --retry 2 \
    "https://downloads.factwright.com/$feed?check=${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}" || true)
  if ! printf '%s\n' "$served" | tr -d '\r' | grep -q "^version: $version$"; then
    echo "::error::downloads.factwright.com doesn't give $feed for Factwright $version yet."
    exit 1
  fi
}

# The folder must hold this version's files: its update feed names it, and its installer is there.
if [ "$(tr -d '\r' < "$dist/$feed" | sed -n 's/^version: //p')" != "$version" ] || [ ! -f "$dist/$installer" ]; then
  echo "::error::$dist doesn't hold Factwright $version's $feed and $installer."
  exit 1
fi

# A version taken back, as docs/releasing.md says under "If a release goes wrong", never goes out
# again: re-running its run would otherwise find its files up, and put its feed back.
refuse_if_withdrawn() {
  local withdrawn
  withdrawn=$(stored "feeds/$version/withdrawn")
  if [ -n "$withdrawn" ]; then
    echo "::error::Factwright $version was taken back, so it can't go out again. Release the next version instead."
    exit 1
  fi
}
refuse_if_withdrawn

live=$(live_version)
# The update feed goes up last, so once it names this version, there's nothing left to put up.
if [ "$live" = "$version" ]; then
  check_live
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
# as after a publish that stopped partway, and one that's up with other contents, or none to check
# by, stops it all, as after "Re-run all jobs", which builds new files.
missing=()
sums=()
for file in "${files[@]}"; do
  key=$(basename "$file")
  sum=$(digest "$file")
  up=$(stored "$key")
  if [ -z "$up" ]; then
    missing+=("$file")
    sums+=("$sum")
  elif [ "$up" = "$sum" ]; then
    echo "$key is up already."
  elif [ "$up" = None ]; then
    echo "::error::$key is up already, without a sha256 to check it by. Release the next version instead."
    exit 1
  else
    echo "::error::$key is up already, with other contents. Release the next version instead."
    exit 1
  fi
done
for i in ${missing[@]+"${!missing[@]}"}; do
  upload "${missing[$i]}" "$(basename "${missing[$i]}")" \
    --cache-control "public, max-age=31536000, immutable" --metadata "sha256=${sums[$i]}"
done
# The version's update feed, kept, to put back if a later version has to be taken back.
upload "$dist/$feed" "feeds/$version/$feed" --cache-control no-cache --content-type text/yaml
# The website's link: the newest installer, under a name that never changes.
upload "$dist/$installer" "$newest" --cache-control no-cache
# Once more, as taking the version back while this ran must win.
refuse_if_withdrawn
# The update feed goes last.
upload "$dist/$feed" "$feed" --cache-control no-cache --content-type text/yaml

check_live
echo "Factwright $version for $computer is out."
