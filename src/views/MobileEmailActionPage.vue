<template>
  <ion-page>
    <ion-content :fullscreen="true" class="email-action-content">
      <main class="email-action-shell">
        <section class="email-action-card">
          <img src="/minsu-logo.png" alt="Mindoro State University seal" />
          <h1>{{ title }}</h1>
          <template v-if="appLink">
            <p>Choose where to finish this account request. The link can be used once and expires 30 minutes after it was requested.</p>
            <ion-button expand="block" :href="appLink" rel="noreferrer">Open app</ion-button>
            <ion-button expand="block" fill="outline" :href="browserLink" rel="noreferrer">Continue in browser</ion-button>
            <p class="email-action-help">If the app does not open, continue in your browser. Your account and school records stay the same.</p>
          </template>
          <template v-else>
            <p role="alert">This account link is incomplete. Return to sign in and request a new email.</p>
            <ion-button expand="block" href="/login">Return to sign in</ion-button>
          </template>
        </section>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonButton, IonContent, IonPage } from '@ionic/vue'
import { nativeEmailActionLink } from '@/services/oauth'
const url = new URL(window.location.href)
const appLink = nativeEmailActionLink(url.toString())
const browserUrl = new URL('/auth/callback', url.origin)
if (appLink) {
  browserUrl.searchParams.set('token_hash', url.searchParams.get('token_hash')!)
  browserUrl.searchParams.set('type', url.searchParams.get('type')!)
}
const browserLink = browserUrl.toString()
const title = ({ recovery: 'Reset your password', email: 'Confirm your account', email_change: 'Confirm your new email', invite: 'Accept your parent invitation' } as Record<string, string>)[url.searchParams.get('type') ?? ''] ?? 'Continue to MinSU Attendance'
</script>

<style scoped>
.email-action-content { --background: var(--campus-bg); }
.email-action-shell { display: grid; place-items: center; min-height: 100%; padding: max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom)); }
.email-action-card { display: grid; gap: 16px; width: min(100%, 440px); padding: 30px; border: 1px solid var(--campus-border); border-radius: 20px; background: var(--campus-surface); }
img { width: 64px; height: 64px; }
h1 { margin: 0; color: var(--campus-text); font: 30px/1.2 Georgia, serif; }
p { margin: 0; color: var(--campus-muted); font-size: 14px; line-height: 1.65; }
.email-action-help { font-size: 12px; }
ion-button { margin: 0; min-height: 44px; text-transform: none; }
</style>
