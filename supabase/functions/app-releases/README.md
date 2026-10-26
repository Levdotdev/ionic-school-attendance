# Mobile app releases through Cloudflare R2

The admin's **Mobile apps** page uploads APK and signed IPA packages directly to a private R2 bucket, then verifies the actual bytes before publishing a download. Other completed, verified accounts use **Get mobile app**. iOS also supports an official TestFlight invitation or Apple App Store link. An IPA archive is explicitly not presented as a normal one-tap iPhone installer.

## External setup

Create a private R2 bucket in the intended Cloudflare account. R2 activation can require billing setup; do that in the Cloudflare dashboard. Do not enable a public bucket URL. Give the server an object read/write credential scoped to this one bucket. Set these protected Supabase Edge Function secrets:

- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- Existing optional `SITE_URL` (defaults to the production attendance website)

Never put these credentials in a `VITE_` variable or browser settings. The admin UI reports setup pending until all four R2 secrets exist. A TestFlight/App Store link can be published without R2.

Configure bucket CORS for the actual website origins (no wildcard):

```json
[
  {
    "AllowedOrigins": ["https://ionic-school-attendance.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Add a lifecycle rule for `staging/` objects (for example, removal after seven days) so abandoned uploads do not accumulate. Published `releases/` objects are retained when a download is replaced or removed; they are never exposed by a public bucket policy. Administrators can review retention separately.

Deploy `app-releases` with gateway JWT verification enabled. The handler also calls server-side `getUser` and reads the database profile; the client cannot grant itself administrator access.

## Upload integrity and privacy

Packages are limited to 200 MB. A 15-minute presigned PUT is scoped to a server-generated staging key and signed content type/length. Publishing rechecks the current verified administrator, upload owner and reservation expiry, validates HEAD size/type, computes SHA-256 from the actual streamed bytes with pinned `hash-wasm`, and checks the ZIP package signature. R2 currently does not implement SHA-256 `FULL_OBJECT`, so client metadata is not used as proof of content. The SDK uses `WHEN_REQUIRED` checksum options for R2 compatibility.

The worker conditionally copies the checked staging ETag to a separate immutable release key. A reused upload URL cannot overwrite an already published package. Publishing atomically replaces the active version for that platform. Signed-in downloads receive a five-minute R2 GET URL; there is no public binary URL and browser code never receives R2 credentials. A short-lived URL is a bearer link and remains usable until it expires.

This verifies package integrity, not an Apple/Android publisher signature or the safety of arbitrary app code. Upload only the project's trusted build outputs. Apple distribution still requires the correct signing identities and an eligible distribution method; uploading an IPA does not provide those.

References: [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [R2 S3/checksum compatibility](https://developers.cloudflare.com/r2/api/s3/api/), [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/), [Apple app distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).
