# iPhone and iPad

## Use the website from the Home Screen now

Open the deployed website in Safari, open the Share menu, choose **Add to Home
Screen**, and add MinSU Attendance. When Safari offers **Open as Web App**, leave
it enabled. The supplied manifest, standalone metadata, and Apple touch icon
give the saved app its own name and the existing MinSU seal.

This is the online web application. It does not install an IPA, cache private
attendance for offline use, or register a native APNs token. This project does
not currently implement web push. Camera and location remain browser
permissions. See [Apple's Home Screen web-app instructions](https://support.apple.com/en-ph/guide/iphone/iph42ab2f3a7/ios).

## Native iOS project

The `ios/` project uses Capacitor 8.5.2 and Swift Package Manager. It includes:

- the original MinSU seal as its opaque 1024-pixel icon and launch artwork;
- purpose descriptions for student-ID/face/profile camera use, profile photos,
  and attendance location;
- `edu.minsu.attendance://auth/callback` registration and both scene/application
  URL forwarding for authentication;
- APNs success/failure forwarding to the Capacitor Push Notifications plugin;
- the Filesystem plugin's file-timestamp privacy reason (`C617.1`).

On a Mac with an appropriate Xcode version:

1. Install the pinned project dependencies and run `pnpm run build`.
2. Run `pnpm exec cap sync ios` so compiled web assets and local SPM dependency
   paths are regenerated on that machine. Do not copy `node_modules` from Windows.
3. Open `ios/App/App.xcodeproj`. Select the App target, select your real signing
   team, and use the `edu.minsu.attendance` bundle identifier registered to that
   team. Do not put a signing certificate or team credential in source control.
4. Run on a simulator or your provisioned device and verify camera, location,
   social/email callbacks, face verification, files, and notification permission.

No Mac, Apple signing team, certificate, provisioning profile, or signed IPA is
available in the Windows workspace. Creating this project does not establish a
successful Xcode build or an App Store release.

## Push notifications and distribution

Before native push delivery, enable **Push Notifications** under the Xcode
target's Signing & Capabilities for the real Apple team. Let Xcode generate the
matching entitlement and profile. `App.entitlements.example` illustrates the
development APNs entitlement only; it is deliberately not selected by the build.
Production signing must use the entitlement from the production profile.

The server must also be configured with the real Apple APNs authentication key,
key ID, team ID, bundle ID, and correct development/production environment.
Never upload an APNs private key, signing certificate, or provisioning profile as
an app download. The existing Firebase Android sender does not deliver to APNs
tokens. APNs transport and actual device delivery require separate verification.

Use an authorized App Store or TestFlight release for general iPhone installation.
An ad-hoc IPA works only on devices covered by its Apple provisioning profile;
placing an unsigned IPA in R2 does not make it installable on arbitrary iPhones.
Publish an iOS download only after the resulting signed distribution has been
tested and the matching installation instructions are available.

Before submission, review App Store privacy answers, school authorization,
biometric/location notices, and retention practices against the actual deployment.
The privacy reason manifest is a plugin requirement, not a claim of compliance.

## Regenerate icons

The native and Home Screen images are committed. On Windows, run
`pwsh -File scripts/generate-app-icons.ps1` to reproduce them from
`public/minsu-logo.png`. The script only resizes and pads that exact seal. It
does not redraw it. Android's foreground seal is centered in the 66dp safe area
inside a 108dp adaptive layer, with a white launcher background. The iOS and
Apple touch images use an opaque white background; no rounded corners are baked
into the iOS icon.

References: [Capacitor iOS configuration](https://capacitorjs.com/docs/ios/configuration),
[Camera](https://capacitorjs.com/docs/apis/camera),
[Geolocation](https://capacitorjs.com/docs/apis/geolocation),
[Push Notifications](https://capacitorjs.com/docs/apis/push-notifications),
[Filesystem privacy manifest](https://capacitorjs.com/docs/apis/filesystem),
[Android adaptive icons](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive),
[Apple app-icon assets](https://developer.apple.com/documentation/xcode/configuring-your-app-icon).
