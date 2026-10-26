# Connect the mobile app downloads

The upload/download screens are implemented. A private bucket in your own
Cloudflare account is still required before an APK can be published there.

1. Sign in to [Cloudflare](https://dash.cloudflare.com/), open **R2 Object
   Storage**, and complete any account/billing activation yourself. Review the
   account's pricing and free allowance before accepting billing terms.
2. Create a bucket named `minsu-attendance-apps`. Keep public access and its
   development public URL disabled.
3. Create an R2 API credential with **Object Read & Write** access restricted to
   that bucket. Record the account ID, access key ID and secret access key
   privately. Do not paste the secret into chat or put it in website variables.
4. In the attendance project's [Supabase Edge Function Secrets](https://supabase.com/dashboard/project/fgfmhpqjokmpplpdaqtn/functions/secrets), set:

   | Secret | Value |
   | --- | --- |
   | `R2_ACCOUNT_ID` | Your Cloudflare account ID |
   | `R2_BUCKET` | `minsu-attendance-apps` |
   | `R2_ACCESS_KEY_ID` | The bucket-scoped access key ID |
   | `R2_SECRET_ACCESS_KEY` | The bucket-scoped secret access key |

5. Add this bucket CORS policy for the deployed website:

   ```json
   [
     {
       "AllowedOrigins": ["https://ionic-school-attendance.vercel.app"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["Content-Type", "x-amz-*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

6. Add an object lifecycle rule that removes abandoned `staging/` objects after
   seven days. Do not apply that rule to the published `releases/` prefix.
7. Sign in as administrator, open **Mobile apps**, and upload the latest trusted
   Android APK with its version. Wait for upload and verification to finish.
   Other signed-in roles can then use **Get mobile app**.

For iPhone installation, publish a real TestFlight/App Store link after Apple
distribution is ready. Uploading an IPA archive does not make it installable on
ordinary iPhones. The prepared iOS project requires Mac/Xcode and signing; the
website's Safari Home Screen option is available meanwhile.

See [Cloudflare R2 token permissions](https://developers.cloudflare.com/r2/api/tokens/),
[CORS](https://developers.cloudflare.com/r2/buckets/cors/), and the
[server implementation notes](../supabase/functions/app-releases/README.md).
