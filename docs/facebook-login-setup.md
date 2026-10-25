# Facebook Login setup for this student project

These are the values prepared for the current Vercel deployment. Deploy the changes first, then open both public information URLs in a private browser window. Each page must show its complete text without signing in or enabling JavaScript. The repository changes do not submit the Meta app, change its mode, or guarantee approval.

## Settings → Basic

| Field | Value |
| --- | --- |
| Display name | `MinSU Attendance` |
| Contact email | `support.attendanceminsu@gmail.com` |
| App domain | `ionic-school-attendance.vercel.app` |
| Website URL, if requested | `https://ionic-school-attendance.vercel.app/` |
| Privacy policy URL | `https://ionic-school-attendance.vercel.app/privacy-policy.html` |
| User data deletion | Choose **Data deletion instructions URL**, if that option is offered, and use `https://ionic-school-attendance.vercel.app/data-deletion.html` |
| Category | Choose **Education** if the dashboard offers it. This is a recommendation based on the app's attendance and student-planning purpose; available choices depend on the current dashboard. |
| App icon | Upload `public/facebook-app-icon-1024.png` from this repository. It is a verified 1024 × 1024 PNG based on the supplied MinSU seal. |

The contact email belongs to the student project administrator. It is not an official university email. The public pages explicitly identify the deployment as a student project and do not claim university operation, endorsement, or legal certification.

The deletion page provides real instructions for an email request and a manual review. It does not automatically delete accounts and cannot be used as a **Data deletion callback URL**. Do not substitute it into a callback field. If a different app type requires an automated callback rather than instructions, that would require a separate verified implementation.

## Facebook Login → Settings

Use this exact **Valid OAuth Redirect URI** for the connected Supabase project:

```text
https://fgfmhpqjokmpplpdaqtn.supabase.co/auth/v1/callback
```

This is Supabase's callback, not the website's `/auth/callback` route. Confirm the value in **Supabase → Authentication → Sign In / Providers → Facebook** before saving. The provider's App ID and secret belong in Supabase; never place the app secret in browser code or these public pages.

For the website redirect after Supabase finishes authentication, keep `https://ionic-school-attendance.vercel.app/auth/callback` in Supabase's authentication redirect allowlist. Local website testing can separately use `http://127.0.0.1:5173/auth/callback` in that allowlist.

Check that the Facebook authentication use case includes `public_profile` and `email`. In Development mode, only accepted app-role users can authenticate; public access depends on the setup/review steps currently shown by Meta for this app. Follow the dashboard's remaining requirements rather than assuming the icon and URLs alone publish the app.

## Keeping the pages current

The source wording is in `src/content/publicPolicies.mjs`; shared styling is in `src/content/publicPolicy.css`. The build runs `scripts/generate-public-policies.mjs` to create `public/privacy-policy.html` and `public/data-deletion.html`. Vue aliases `/privacy-policy` and `/data-deletion` use the same content, but the `.html` links are suitable for reading without application JavaScript.

The project administrator must actually monitor the published contact inbox and handle verified requests. There is no general automatic purge or invented fixed deletion deadline. Any retained academic records need a documented justification and explanation to the requester. Institutional use still requires the responsible school to establish its controller details, processing basis, retention policy, and safeguards.

## Primary references checked

- [Supabase: Facebook sign-in](https://supabase.com/docs/guides/auth/social-sign-in/auth-facebook) supports the provider callback, email permission, and development/live setup above.
- [Meta: Basic settings](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/basic-settings/) and [Meta: Data deletion](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/) returned HTTP 429 to the documentation browser on October 25, 2026. Exact current category choices, image validation, and deletion-field labels must therefore be confirmed in the app's dashboard; no claim is made that these pages have been accepted by Meta.
- [Philippine National Privacy Commission: Data Privacy Act](https://privacy.gov.ph/data-privacy-act/) informs the notice and rights information. These pages describe the project's actual data flows and do not certify legal compliance.
