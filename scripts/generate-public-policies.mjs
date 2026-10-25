import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { getPublicPolicy, publicPolicyKinds } from '../src/content/publicPolicies.mjs'

/** Content remains readable without JavaScript, Auth, or SPA routing. The small
 * optional theme bootstrap carries the app's saved appearance into static HTML. */
export async function renderPublicPolicyDocument(kind) {
  const policy = getPublicPolicy(kind)
  const css = await readFile(new URL('../src/content/publicPolicy.css', import.meta.url), 'utf8')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="${policy.description}">
  <title>${policy.title} | MinSU Attendance student project</title>
  <link rel="icon" href="/minsu-logo.png" type="image/png">
  <script>(function(){try{var theme=localStorage.getItem('minsu-attendance-theme');if(theme==='light'||theme==='dark'){document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;}}catch(error){}})();</script>
  <style>${css}</style>
</head>
<body class="policy-page">${policy.html}</body>
</html>
`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const kind of publicPolicyKinds) {
    const policy = getPublicPolicy(kind)
    await writeFile(new URL(`../public/${policy.fileName}`, import.meta.url), await renderPublicPolicyDocument(kind))
  }
}
