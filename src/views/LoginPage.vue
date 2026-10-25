<template>
  <ion-page class="auth-page">
    <ion-content :fullscreen="true" class="auth-content">
      <main class="auth-shell">
        <section class="auth-story" aria-labelledby="product-name">
          <div class="story-top">
            <div class="brand-lockup">
              <img
                src="/minsu-logo.png"
                alt="Mindoro State University seal"
                class="brand-logo"
              />
              <div>
                <strong id="product-name">MinSU Attendance</strong>
                <span>Mindoro State University</span>
              </div>
            </div>

            <ion-button
              class="theme-button theme-button-on-dark"
              fill="clear"
              shape="round"
              :aria-label="isDark ? 'Use light mode' : 'Use dark mode'"
              :title="isDark ? 'Use light mode' : 'Use dark mode'"
              @click="toggleTheme"
            >
              <ion-icon slot="icon-only" :icon="isDark ? sunnyOutline : moonOutline" />
            </ion-button>
          </div>

          <div class="story-copy">
            <p class="story-kicker"><span></span> Your campus. Connected.</p>
            <h1>One campus.<br /><em>Closer together.</em></h1>
            <p>From the first class to the last check-in, keep school days organized and families in the loop.</p>
          </div>

          <div class="campus-connection" aria-label="How your school day connects">
            <div class="connection-heading"><span>A connected school day</span><ion-icon :icon="shieldCheckmarkOutline" aria-hidden="true" /></div>
            <div class="campus-scene" aria-hidden="true">
              <span class="scene-orbit orbit-one"></span><span class="scene-orbit orbit-two"></span>
              <div class="campus-building"><span class="building-roof"></span><span class="building-name">M I N S U</span><div class="building-columns"><i></i><i></i><i></i><i></i></div><span class="building-steps"></span></div>
              <span class="scene-badge"><ion-icon :icon="checkmarkCircleOutline" /> A little more peace of mind</span>
            </div>
            <ol class="connection-steps">
              <li><span class="step-symbol"><ion-icon :icon="calendarOutline" /></span><strong>Classes planned</strong><small>A clear school week</small></li>
              <li><span class="step-symbol"><ion-icon :icon="scanOutline" /></span><strong>Check-ins verified</strong><small>Identity & attendance</small></li>
              <li><span class="step-symbol"><ion-icon :icon="peopleOutline" /></span><strong>Families informed</strong><small>Connected, wherever</small></li>
            </ol>
          </div>

          <p class="story-foot"><span aria-hidden="true"></span> Mindoro State University <span class="story-foot-divider">/</span> Attendance & student life</p>
        </section>

        <section class="auth-panel" aria-labelledby="auth-heading">
          <div class="mobile-top">
            <div class="mobile-brand">
              <img
                src="/minsu-logo.png"
                alt="Mindoro State University seal"
                class="brand-logo"
              />
              <div>
                <strong>MinSU Attendance</strong>
                <span>Mindoro State University</span>
              </div>
            </div>

            <ion-button
              class="theme-button"
              fill="clear"
              shape="round"
              :aria-label="isDark ? 'Use light mode' : 'Use dark mode'"
              :title="isDark ? 'Use light mode' : 'Use dark mode'"
              @click="toggleTheme"
            >
              <ion-icon slot="icon-only" :icon="isDark ? sunnyOutline : moonOutline" />
            </ion-button>
          </div>

          <div class="auth-card">
            <p v-if="signOutNotice" class="auth-notice" role="status">{{ signOutNotice }}</p>
            <div class="auth-heading">
              <p class="eyebrow">Welcome</p>
              <h2 id="auth-heading">{{ mode === 'signin' ? 'Sign in to your account' : 'Create your account' }}</h2>
              <p>
                {{ mode === 'signin'
                  ? 'Use your registered email and password to continue.'
                  : 'Start with your email and password. Set up your account after signing in.' }}
              </p>
            </div>

            <ion-segment v-model="mode" :disabled="authBusy" class="auth-mode" aria-label="Account action">
              <ion-segment-button value="signin">
                <ion-label>Sign in</ion-label>
              </ion-segment-button>
              <ion-segment-button value="signup">
                <ion-label>Register</ion-label>
              </ion-segment-button>
            </ion-segment>

            <div class="social-auth" aria-label="Social sign in options">
              <div class="social-grid">
                <ion-button
                  class="social-button"
                  fill="outline"
                  type="button"
                  :disabled="authBusy"
                  @click="signInWithProvider('google')"
                >
                  <ion-spinner v-if="socialBusy === 'google'" name="crescent" />
                  <template v-else>
                    <ion-icon slot="start" :icon="logoGoogle" aria-hidden="true" />
                    Google
                  </template>
                </ion-button>

                <ion-button
                  class="social-button"
                  fill="outline"
                  type="button"
                  :disabled="authBusy"
                  @click="signInWithProvider('facebook')"
                >
                  <ion-spinner v-if="socialBusy === 'facebook'" name="crescent" />
                  <template v-else>
                    <ion-icon slot="start" :icon="logoFacebook" aria-hidden="true" />
                    Facebook
                  </template>
                </ion-button>
              </div>

              <p class="social-role-note">For students, teachers, and parents / guardians.</p>
            </div>

            <div class="auth-divider"><span>or continue with email</span></div>

            <form class="auth-form" @submit.prevent="submit">
              <ion-input
                v-model="email"
                class="form-control"
                type="email"
                label="Email address"
                label-placement="stacked"
                fill="outline"
                autocomplete="email"
                :disabled="authBusy"
                required
              />

              <ion-input
                v-model="password"
                class="form-control"
                type="password"
                label="Password"
                label-placement="stacked"
                fill="outline"
                :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'"
                :disabled="authBusy"
                required
              />

              <ion-input
                v-if="mode === 'signup'"
                v-model="passwordConfirmation"
                class="form-control"
                type="password"
                label="Confirm password"
                label-placement="stacked"
                fill="outline"
                autocomplete="new-password"
                :disabled="authBusy"
                required
              />

              <ion-button v-if="mode === 'signin'" fill="clear" size="small" class="forgot-password" :disabled="authBusy" @click="openRecovery">Forgot password?</ion-button>

              <div
                v-if="message"
                class="form-message"
                :class="hasError ? 'is-error' : 'is-success'"
                :role="hasError ? 'alert' : 'status'"
              >
                <ion-icon :icon="hasError ? alertCircleOutline : checkmarkCircleOutline" aria-hidden="true" />
                <span>{{ message }}</span>
              </div>

              <ion-button expand="block" type="submit" :disabled="authBusy" class="submit-button">
                <ion-spinner v-if="busy" name="crescent" />
                <template v-else>
                  <span>{{ mode === 'signin' ? 'Sign in securely' : 'Create account' }}</span>
                  <ion-icon slot="end" :icon="arrowForwardOutline" aria-hidden="true" />
                </template>
              </ion-button>
            </form>

            <p class="privacy-note">
              <ion-icon :icon="lockClosedOutline" aria-hidden="true" />
              Your attendance information is protected and visible only to authorized users.
            </p>
            <nav class="policy-links" aria-label="Privacy information">
              <a href="/privacy-policy.html">Privacy policy</a>
              <span aria-hidden="true">·</span>
              <a href="/data-deletion.html">Data deletion</a>
            </nav>
          </div>
        </section>
      </main>
      <app-modal :open="recoveryOpen" title="Reset your password" :busy="recoveryBusy" @close="recoveryOpen = false">
          <form class="recovery-form" @submit.prevent="sendRecoveryEmail">
            <p>Enter your account email to request a password reset link. Check your inbox and spam folder, then open the link on this device and browser.</p>
            <ion-input v-model="recoveryEmail" type="email" label="Email address" label-placement="stacked" fill="outline" autocomplete="email" :disabled="recoveryBusy" required />
            <p v-if="recoveryMessage" :class="recoveryError ? 'recovery-error' : 'recovery-success'" :role="recoveryError ? 'alert' : 'status'">{{ recoveryMessage }}</p>
            <ion-button type="submit" expand="block" :disabled="recoveryBusy || recoveryCooldown > 0"><ion-spinner v-if="recoveryBusy" name="crescent" /><template v-else>{{ recoveryCooldown ? `Request again in ${recoveryCooldown}s` : 'Send reset link' }}</template></ion-button>
            <p v-if="recoveryRequested" class="recovery-help">No email? Confirm the address, check spam, or use your linked Google/Facebook sign-in. If it still does not arrive, contact the administrator to check email delivery.</p>
          </form>
      </app-modal>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonLabel,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
} from '@ionic/vue'
import {
  alertCircleOutline,
  arrowForwardOutline,
  checkmarkCircleOutline,
  calendarOutline,
  locationOutline,
  lockClosedOutline,
  logoFacebook,
  logoGoogle,
  moonOutline,
  peopleOutline,
  scanOutline,
  shieldCheckmarkOutline,
  sunnyOutline,
} from 'ionicons/icons'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { accountPathForProfile, useSession } from '@/composables/useSession'
import { useTheme } from '@/composables/useTheme'
import { supabase } from '@/lib/supabase'
import {
  beginSocialSignIn,
  initializeNativeOAuthCallback,
  oauthRedirectUrl,
  type SocialProvider,
} from '@/services/oauth'
import { toUserFacingErrorMessage } from '@/utils/errors'
import AppModal from '@/components/AppModal.vue'
import { authActionError, requestPasswordReset } from '@/services/account'

type AuthMode = 'signin' | 'signup'

const router = useRouter()
const { initializeSession, refreshProfile, profile, signOutNotice } = useSession()
const { isDark, toggleTheme } = useTheme()

const mode = ref<AuthMode>('signin')
const email = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const busy = ref(false)
const socialBusy = ref<SocialProvider | null>(null)
const message = ref('')
const hasError = ref(false)
const authBusy = computed(() => busy.value || socialBusy.value !== null)
const recoveryOpen = ref(false)
const recoveryEmail = ref('')
const recoveryBusy = ref(false)
const recoveryMessage = ref('')
const recoveryError = ref(false)
const recoveryCooldown = ref(0)
const recoveryRequested = ref(false)
let recoveryTimer: ReturnType<typeof setInterval> | undefined
onBeforeUnmount(() => { clearInterval(recoveryTimer) })

function openRecovery() {
  recoveryEmail.value = email.value
  recoveryMessage.value = ''
  recoveryError.value = false
  recoveryOpen.value = true
}

async function sendRecoveryEmail() {
  if (recoveryBusy.value || recoveryCooldown.value > 0) return
  recoveryBusy.value = true
  recoveryMessage.value = ''
  recoveryError.value = false
  try {
    await requestPasswordReset(recoveryEmail.value)
    recoveryRequested.value = true
    recoveryMessage.value = 'Reset request accepted. If an account uses this email, check its inbox and spam folder for the link. Authentication links expire after 30 minutes. This response does not confirm email delivery.'
    recoveryCooldown.value = 60
    clearInterval(recoveryTimer)
    recoveryTimer = setInterval(() => { recoveryCooldown.value--; if (recoveryCooldown.value <= 0) clearInterval(recoveryTimer) }, 1000)
  } catch (error) {
    recoveryError.value = true
    recoveryMessage.value = authActionError(error, 'The reset email could not be requested. Please try again.')
  } finally { recoveryBusy.value = false }
}

function validate(): string | null {
  if (!email.value.trim() || !email.value.includes('@')) return 'Enter a valid email address.'
  if (!password.value) return 'Enter your password.'

  if (mode.value === 'signup') {
    if (password.value.length < 8) return 'Password must contain at least 8 characters.'
    if (password.value !== passwordConfirmation.value) return 'The passwords do not match.'
  }

  return null
}

async function redirectSignedInUser() {
  const currentProfile = await refreshProfile()
  if (!currentProfile) {
    throw new Error('Your account profile is not ready. Please sign in again in a moment.')
  }
  await router.replace(accountPathForProfile(currentProfile))
}

async function submit() {
  if (authBusy.value) return
  const validationMessage = validate()
  if (validationMessage) {
    hasError.value = true
    message.value = validationMessage
    return
  }

  busy.value = true
  hasError.value = false
  message.value = ''

  try {
    if (mode.value === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.value.trim().toLowerCase(),
        password: password.value,
      })
      if (error) throw error

      await redirectSignedInUser()
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.value.trim().toLowerCase(),
      password: password.value,
      options: {
        emailRedirectTo: oauthRedirectUrl(),
      },
    })
    if (error) throw error

    if (data.session) {
      await redirectSignedInUser()
      return
    }

    message.value = 'Check your email to confirm your account within 30 minutes. After signing in, you can choose student, teacher, or parent and complete your information.'
    password.value = ''
    passwordConfirmation.value = ''
  } catch (error) {
    hasError.value = true
    message.value = toUserFacingErrorMessage(error, 'Authentication failed. Please try again.')
  } finally {
    busy.value = false
  }
}

async function signInWithProvider(provider: SocialProvider) {
  if (authBusy.value) return
  socialBusy.value = provider
  hasError.value = false
  message.value = ''

  try {
    await beginSocialSignIn(provider)
  } catch (error) {
    hasError.value = true
    message.value = toUserFacingErrorMessage(error, `Unable to continue with ${provider === 'google' ? 'Google' : 'Facebook'}. Please try again.`)
  } finally {
    socialBusy.value = null
  }
}

watch(mode, () => {
  hasError.value = false
  message.value = ''
})

onMounted(async () => {
  try {
    await initializeNativeOAuthCallback()
    await initializeSession()
    if (profile.value) await router.replace(accountPathForProfile(profile.value))
  } catch (error) {
    hasError.value = true
    message.value = toUserFacingErrorMessage(error, 'Unable to restore your account. Please sign in again.')
  }
})
</script>

<style scoped>
.policy-links { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin-top: 16px; font-size: 12px; color: var(--app-text-muted); }
.policy-links a { color: inherit; text-underline-offset: 3px; }
.auth-page {
  --campus-accent-local: var(--campus-green, #087443);
  --campus-navy-local: var(--campus-navy, #063f2a);
  --campus-gold-local: var(--campus-gold, #efb71b);
  --campus-gold-soft-local: var(--campus-gold-soft, #fff3c8);
  --campus-bg-local: var(--campus-bg, #f5f7f1);
  --campus-surface-local: var(--campus-surface, #ffffff);
  --campus-text-local: var(--campus-text, #1d2924);
  --campus-muted-local: var(--campus-muted, #65736b);
  --campus-border-local: var(--campus-border, #d8e1d9);
  --campus-success-local: var(--campus-success, #147a50);
  --campus-success-soft-local: var(--campus-success-soft, #e1f4eb);
  --campus-danger-local: var(--campus-danger, #bb3e45);
  --campus-danger-soft-local: var(--campus-danger-soft, #fae9ea);
  color: var(--campus-text-local);
}

.auth-content {
  --background: var(--campus-bg-local);
  --overflow: hidden;
}

.auth-content::part(scroll) {
  overflow: hidden;
}

.auth-shell {
  box-sizing: border-box;
  display: grid;
  height: 100dvh;
  overflow: hidden;
  grid-template-columns: minmax(340px, 0.88fr) minmax(500px, 1.12fr);
}

.auth-story {
  position: relative;
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  padding: clamp(32px, 5vw, 68px);
  background: var(--campus-navy-local);
  color: #f4f9fc;
}

.auth-story::before,
.auth-story::after {
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  content: '';
  pointer-events: none;
}

.auth-story::before {
  width: 380px;
  height: 380px;
  right: -210px;
  top: -130px;
}

.auth-story::after {
  width: 520px;
  height: 520px;
  left: -330px;
  bottom: -270px;
}

.story-top,
.mobile-top,
.brand-lockup,
.mobile-brand {
  display: flex;
  align-items: center;
}

.story-top,
.mobile-top {
  position: relative;
  z-index: 2;
  justify-content: space-between;
  gap: 18px;
}

.brand-lockup,
.mobile-brand {
  gap: 12px;
}

.brand-logo {
  display: block;
  width: 58px;
  height: 58px;
  flex: 0 0 auto;
  border: 3px solid rgba(255, 255, 255, 0.88);
  border-radius: 50%;
  background: #ffffff;
  object-fit: contain;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}

.brand-lockup strong,
.brand-lockup span,
.mobile-brand strong,
.mobile-brand span {
  display: block;
}

.brand-lockup strong,
.mobile-brand strong {
  font-size: 17px;
  font-weight: 700;
}

.brand-lockup span,
.mobile-brand span {
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.68;
}

ion-button.theme-button {
  --color: var(--campus-text-local);
  --padding-start: 0;
  --padding-end: 0;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  margin: 0;
  border: 1px solid var(--campus-border-local);
  border-radius: 50%;
  background: var(--campus-surface-local);
}

ion-button.theme-button-on-dark {
  --color: #e2e9e4;
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.08);
}

.story-copy {
  position: relative;
  z-index: 1;
  max-width: 560px;
  margin: auto 0 26px;
}
.story-kicker { display:flex; align-items:center; gap:9px; margin:0 0 16px; color:#c8d6ca; font-size:11px; letter-spacing:.11em; text-transform:uppercase; font-weight:650; }
.story-kicker > span { width:22px; height:1px; background:#d9bd77; }
.story-copy h1 em { color:#e0c785; font-weight:inherit; }
.campus-connection { position:relative; flex:0 1 auto; min-height:0; z-index:1; overflow:hidden; border:1px solid #ffffff24; border-radius:22px; background:#ffffff09; box-shadow:0 15px 40px #00000012; }
.connection-heading { display:flex; align-items:center; justify-content:space-between; padding:17px 20px 0; color:#d6e2d8; font-size:11px; letter-spacing:.02em; }
.connection-heading ion-icon { color:#e0c785; font-size:18px; }
.campus-scene { position:relative; height:148px; overflow:hidden; display:grid; place-items:center; }
.scene-orbit { position:absolute; width:210px; height:210px; border:1px solid #ffffff10; border-radius:50%; top:15px; left:calc(50% - 105px); }
.scene-orbit.orbit-two { width:290px; height:290px; top:-25px; left:calc(50% - 145px); border-style:dashed; }
.campus-building { position:relative; display:grid; justify-items:center; width:140px; height:95px; margin-top:10px; }
.building-roof { width:138px; height:24px; background:#d7c28c; clip-path:polygon(50% 0,100% 86%,100% 100%,0 100%,0 86%); }
.building-name { width:128px; padding:5px 0; color:#e7e8d9; border-bottom:1px solid #ffffff22; text-align:center; font-size:9px; font-weight:750; letter-spacing:3px; }
.building-columns { display:flex; align-items:stretch; justify-content:space-between; width:120px; height:34px; padding:0 7px; }
.building-columns i { display:block; width:11px; background:linear-gradient(90deg,#c4cbbd,#f0eee1 55%,#c4cbbd); border-radius:0 0 2px 2px; }
.building-steps { width:150px; height:9px; background:#b6c2af; box-shadow:0 5px 0 3px #899e89; }
.scene-badge { position:absolute; right:15px; bottom:12px; display:flex; align-items:center; gap:6px; padding:8px 10px; border:1px solid #ffffff25; border-radius:8px; background:#284b3a; color:#e3e9dd; font-size:9px; box-shadow:0 7px 18px #0002; transform:rotate(-3deg); }
.scene-badge ion-icon { color:#dfca8c; font-size:14px; }
.connection-steps { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; list-style:none; margin:0; padding:8px 16px 19px; }
.connection-steps li { position:relative; display:grid; justify-items:center; gap:7px; text-align:center; min-width:0; }
.connection-steps li:not(:last-child)::after { content:''; position:absolute; left:calc(50% + 22px); top:17px; width:calc(100% - 36px); height:1px; background:#ffffff25; }
.step-symbol { display:grid; place-items:center; width:35px; height:35px; border:1px solid #d7c28c55; border-radius:50%; background:#ffffff0a; color:#e0cb92; }
.step-symbol ion-icon { font-size:16px; }
.connection-steps strong { color:#e3eade; font-size:10px; font-weight:650; }
.connection-steps small { color:#b7c9bb; font-size:8px; line-height:1.4; }
.story-foot .story-foot-divider { width:auto; height:auto; border-radius:0; color:#94ab9b; background:none; box-shadow:none; margin:0 2px; }
.auth-notice { margin:0 0 20px; padding:13px 15px; border:1px solid var(--campus-border); border-radius:10px; color:var(--campus-muted); background:var(--campus-surface-soft); font-size:12px; line-height:1.6; }

.eyebrow {
  margin: 0 0 8px;
  color: var(--campus-muted-local);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.auth-story .eyebrow {
  color: rgba(244, 249, 252, 0.62);
}

.story-copy h1 {
  max-width: 520px;
  margin: 0;
  font-size: clamp(38px, 4.8vw, 66px);
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1.03;
}

.story-copy > p:last-child {
  max-width: 510px;
  margin: 22px 0 0;
  color: rgba(244, 249, 252, 0.73);
  font-size: 15px;
  line-height: 1.7;
}

.trust-list {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 10px;
  max-width: 540px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.trust-list li {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 13px 15px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.055);
}

.trust-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.1);
}

.trust-list strong,
.trust-list small {
  display: block;
}

.trust-list strong {
  font-size: 13px;
  font-weight: 600;
}

.trust-list small {
  margin-top: 3px;
  color: rgba(244, 249, 252, 0.64);
  font-size: 11px;
  line-height: 1.4;
}

.story-foot {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 28px 0 0;
  color: rgba(244, 249, 252, 0.64);
  font-size: 12px;
}

.story-foot span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #55d99b;
  box-shadow: 0 0 0 4px rgba(85, 217, 155, 0.11);
}

.auth-panel {
  display: grid;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  box-sizing: border-box;
  align-content: start;
  justify-items: center;
  padding: clamp(24px, 6vw, 84px);
  scrollbar-width: thin;
}

.auth-card {
  margin-block: auto;
}

@media (min-width: 901px) and (max-height: 800px) {
  .auth-story {
    padding: 28px 36px;
  }

  .story-copy {
    margin: auto 0 20px;
  }
  .campus-scene { height:120px; }
  .connection-steps { padding-bottom:14px; }
  .connection-heading { padding-top:12px; }

  .story-copy h1 {
    font-size: clamp(32px, 4vw, 48px);
  }

  .story-copy > p:last-child {
    margin-top: 16px;
    font-size: 14px;
    line-height: 1.5;
  }

  .trust-list li {
    padding: 10px 12px;
  }

  .story-foot {
    margin-top: 18px;
  }
}

@media (min-width: 901px) and (max-height: 560px) {
  .trust-list, .campus-connection,
  .story-foot {
    display: none;
  }

  .story-copy {
    margin: auto 0;
  }
}

.mobile-top {
  display: none;
}

.auth-card {
  width: min(100%, 510px);
  padding: clamp(26px, 4vw, 42px);
  border: 1px solid var(--campus-border-local);
  border-radius: var(--campus-radius, 22px);
  background: var(--campus-surface-local);
  box-shadow: 0 24px 70px rgba(6, 63, 42, 0.1);
}

.auth-heading h2 {
  margin: 0;
  color: var(--campus-text-local);
  font-size: clamp(26px, 3vw, 34px);
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1.12;
}

.auth-heading > p:last-child {
  margin: 12px 0 0;
  color: var(--campus-muted-local);
  font-size: 14px;
  line-height: 1.55;
}

.auth-mode {
  margin: 28px 0 22px;
  padding: 4px;
  border-radius: 13px;
  background: var(--campus-bg-local);
}

.auth-mode ion-segment-button {
  --border-radius: 10px;
  --indicator-color: var(--campus-surface-local);
  --color: var(--campus-muted-local);
  --color-checked: var(--campus-accent-local);
  min-height: 40px;
  font-size: 13px;
  font-weight: 600;
}

.social-auth {
  display: grid;
  gap: 10px;
}

.social-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.social-button {
  --background: var(--campus-surface-local);
  --background-hover: var(--campus-green-soft, #e4f2e9);
  --border-color: var(--campus-border-local);
  --border-radius: 12px;
  --color: var(--campus-text-local);
  --box-shadow: none;
  min-height: 46px;
  margin: 0;
  font-size: 13px;
  font-weight: 650;
  text-transform: none;
}

.social-button ion-icon {
  color: var(--campus-accent-local);
  font-size: 19px;
}

.social-button ion-spinner {
  width: 20px;
  height: 20px;
  color: var(--campus-accent-local);
}

.social-role-note {
  margin: 0;
  color: var(--campus-muted-local);
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
}

.auth-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 17px 0;
  color: var(--campus-muted-local);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.055em;
}

.auth-divider::before,
.auth-divider::after {
  height: 1px;
  flex: 1;
  background: var(--campus-border-local);
  content: '';
}

.auth-divider span {
  white-space: nowrap;
}

.auth-form {
  display: grid;
  gap: 15px;
}

.form-control {
  --border-color: var(--campus-border-local);
  --border-radius: 12px;
  --highlight-color-focused: var(--campus-accent-local);
  --padding-start: 14px;
  --padding-end: 14px;
  color: var(--campus-text-local);
}

.role-notice,
.privacy-note,
.form-message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: -3px 0 1px;
  font-size: 12px;
  line-height: 1.5;
}

.role-notice {
  padding: 11px 12px;
  border-radius: 11px;
  background: var(--campus-gold-soft-local);
  color: var(--campus-warning, #77500d);
}

.role-notice ion-icon,
.privacy-note ion-icon,
.form-message ion-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  font-size: 16px;
}

.form-message {
  padding: 11px 12px;
  border-radius: 11px;
}

.form-message.is-error {
  background: var(--campus-danger-soft-local);
  color: var(--campus-danger-local);
}

.form-message.is-success {
  background: var(--campus-success-soft-local);
  color: var(--campus-success-local);
}

.submit-button {
  --background: var(--campus-accent-local);
  --background-hover: var(--campus-navy-local);
  --border-radius: 12px;
  --box-shadow: none;
  min-height: 48px;
  margin: 4px 0 0;
  font-weight: 600;
  text-transform: none;
}

.privacy-note {
  justify-content: center;
  margin: 20px 0 0;
  color: var(--campus-muted-local);
  text-align: center;
}

.forgot-password { justify-self: end; margin: -8px 0 0; --padding-start: 0; --padding-end: 0; text-transform: none; font-size: 12px; }
.recovery-form { display: grid; gap: 18px; }
.recovery-form > p { margin: 0; color: var(--campus-muted); font-size: 14px; line-height: 1.6; }
.recovery-form .recovery-error { color: var(--campus-danger); }
.recovery-form .recovery-success { color: var(--campus-green); }
.recovery-form ion-button { min-height: 44px; margin: 0; text-transform: none; }
.recovery-form .recovery-help { font-size: 12px; }

@media (max-width: 900px) {
  .auth-content {
    --overflow: auto;
  }

  .auth-content::part(scroll) {
    overflow: auto;
  }

  .auth-shell {
    height: auto;
    min-height: 100%;
    overflow: visible;
    grid-template-columns: 1fr;
  }

  .auth-story {
    display: none;
  }

  .auth-panel {
    height: auto;
    min-height: 100%;
    overflow: visible;
    align-content: start;
    padding: 28px 20px 48px;
  }

  .mobile-top {
    display: flex;
    width: min(100%, 510px);
    margin-bottom: 24px;
    color: var(--campus-text-local);
  }

  .mobile-brand .brand-logo {
    width: 54px;
    height: 54px;
    border-color: var(--campus-surface-local);
  }

  .auth-card {
    padding: clamp(24px, 7vw, 38px);
  }
}

@media (max-width: 480px) {
  .auth-panel {
    padding: 20px 14px 36px;
  }

  .auth-card {
    border-radius: 18px;
    box-shadow: 0 15px 45px rgba(6, 63, 42, 0.08);
  }

  .social-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
