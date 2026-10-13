#!/usr/bin/env bash
# Publishes one computer's installers for a release to downloads.factwright.com, as the release
# workflow does once that computer's build has passed. It never replaces a version that's out,
# keeps each version's files for good, and puts the update feed up last, so an installed copy
# finds a version only once its files are there.
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

# A version's files never change once out, as browsers and Cloudflare keep them for good.
if aws s3api head-object --bucket "$BUCKET" --key "$installer" --endpoint-url "$ENDPOINT" > /dev/null 2>&1; then
  echo "::error::$installer is out already. Release the next version instead."
  exit 1
fi

for file in "${files[@]}"; do
  upload "$file" "$(basename "$file")" --cache-control "public, max-age=31536000, immutable"
done
# The version's update feed, kept, to put back if a later version has to be taken back.
upload "$dist/$feed" "feeds/$version/$feed" --cache-control no-cache --content-type text/yaml
# The website's link: the newest installer, under a name that never changes.
upload "$dist/$installer" "$newest" --cache-control no-cache
# The update feed goes last.
upload "$dist/$feed" "$feed" --cache-control no-cache --content-type text/yaml

curl --fail --silent "https://downloads.factwright.com/$feed?check=${GITHUB_RUN_ID:-$$}" | grep -q "^version: $version$"
echo "Factwright $version for $computer is out."
