#!/usr/bin/env bash
# One-shot iOS packaging for GeoTag Photo.
# Prerequisites: Xcode installed + its command-line tools selected.
# Run from the project root:  bash scripts/setup-ios.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ Checking Xcode…"
if ! xcodebuild -version >/dev/null 2>&1; then
  echo "✗ Xcode not found. Install it from the App Store, then run:"
  echo "    sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer"
  echo "    sudo xcodebuild -license accept"
  exit 1
fi

echo "▶ Ensuring CocoaPods…"
if ! command -v pod >/dev/null 2>&1; then
  brew install --formula cocoapods || sudo gem install cocoapods
fi

echo "▶ Installing JS deps…"
npm install

echo "▶ Adding the iOS platform (if missing)…"
if [ ! -d ios ]; then
  npx cap add ios
fi

echo "▶ Injecting camera / location / photo permission strings into Info.plist…"
PLIST="ios/App/App/Info.plist"
add_plist() { # key, value
  /usr/libexec/PlistBuddy -c "Delete :$1" "$PLIST" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$PLIST"
}
add_plist NSCameraUsageDescription      "GeoTag Photo uses the camera to take geotagged photos."
add_plist NSLocationWhenInUseUsageDescription "GeoTag Photo stamps your location onto photos."
add_plist NSPhotoLibraryAddUsageDescription   "GeoTag Photo saves geotagged photos to your library."
add_plist NSPhotoLibraryUsageDescription      "GeoTag Photo saves geotagged photos to your library."

echo "▶ Marking app exempt from export-compliance encryption docs (standard HTTPS only)…"
/usr/libexec/PlistBuddy -c "Delete :ITSAppUsesNonExemptEncryption" "$PLIST" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PLIST"

echo "▶ Restricting target to iPhone-only (v1 ships without iPad support)…"
sed -i '' 's/TARGETED_DEVICE_FAMILY = "1,2";/TARGETED_DEVICE_FAMILY = 1;/g' ios/App/App.xcodeproj/project.pbxproj

echo "▶ Syncing web assets into the native project…"
npx cap sync ios

echo "▶ Opening Xcode…"
npx cap open ios

cat <<'NEXT'

✅ Done. In Xcode:
  1. Select the "App" target → Signing & Capabilities → pick your Team
     (your free Apple ID works; set a unique Bundle Identifier if prompted).
  2. Plug in your iPhone (trust the Mac) and choose it in the device dropdown,
     or pick a Simulator.
  3. Press ▶ (Run). First run on a real device: on the iPhone go to
     Settings → General → VPN & Device Management → trust your developer cert.
  4. Launch GeoTag Photo, allow Camera + Location when prompted.

To push new web changes later:  npx cap sync ios   (then Run again)
NEXT
