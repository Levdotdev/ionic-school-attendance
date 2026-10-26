<template>
  <ion-page>
    <portal-header :portal="admin ? 'Administration' : 'App downloads'" :busy="signingOut" @logout="logout" />
    <ion-content class="downloads-content">
      <main class="downloads-shell">
        <header class="downloads-heading"><div><p class="eyebrow">MinSU Attendance</p><h1>{{ admin ? 'Manage mobile apps' : 'Get the mobile app' }}</h1><p>Use the mobile app for class reminders, attendance notifications, and camera check-ins.</p></div><ion-button v-if="admin" @click="uploadOpen = true"><ion-icon slot="start" :icon="cloudUploadOutline" />Publish app version</ion-button></header>
        <p v-if="admin && configurationChecked && !storageConfigured" class="setup-notice" role="status"><strong>Package uploads need Cloudflare R2 setup.</strong> Connect the private app bucket and protected credentials before uploading Android or iOS packages. You can still publish an existing Apple App Store or TestFlight link.</p>
        <p v-if="message" class="download-message" :class="{error:failed}" :role="failed ? 'alert' : 'status'">{{ message }}</p>
        <p v-if="loading" class="loading" role="status"><ion-spinner name="crescent" />Loading app versions…</p>
        <div v-else class="platform-grid">
          <article v-for="platform in platforms" :key="platform.id" class="platform-card">
            <div class="platform-title"><span class="platform-icon"><ion-icon :icon="platform.id === 'android' ? logoAndroid : logoApple" /></span><div><p class="eyebrow">{{ platform.id === 'android' ? 'Android phones and tablets' : 'iPhone and iPad' }}</p><h2>{{ platform.label }}</h2></div></div>
            <template v-if="releaseFor(platform.id)">
              <p class="version">Version {{ releaseFor(platform.id)!.version }}<span v-if="releaseFor(platform.id)!.file_size"> · {{ readableAppSize(releaseFor(platform.id)!.file_size) }}</span></p>
              <p v-if="releaseFor(platform.id)!.minimum_os" class="minimum-os">Requires {{ releaseFor(platform.id)!.minimum_os }}</p>
              <p v-if="releaseFor(platform.id)!.notes" class="release-notes">{{ releaseFor(platform.id)!.notes }}</p>
              <p v-if="releaseFor(platform.id)!.delivery === 'ios_archive'" class="archive-notice">This is an IPA archive. It must be signed and provisioned through an approved Apple distribution method before installation. Opening the file on an ordinary iPhone does not install the app. Use your administrator's TestFlight or App Store link when available.</p>
              <div class="platform-actions"><ion-button :disabled="Boolean(downloading)" @click="download(releaseFor(platform.id)!)"><ion-icon slot="start" :icon="downloadOutline" />{{ downloading === platform.id ? 'Preparing…' : releaseFor(platform.id)!.delivery === 'ios_store' ? 'Open iOS app link' : releaseFor(platform.id)!.delivery === 'ios_archive' ? 'Download IPA archive' : 'Download Android app' }}</ion-button><ion-button v-if="admin" fill="outline" color="danger" @click="unpublish(releaseFor(platform.id)!)">Remove download</ion-button></div>
              <details v-if="releaseFor(platform.id)!.sha256" class="checksum"><summary>Package checksum</summary><code>{{ releaseFor(platform.id)!.sha256 }}</code></details>
            </template>
            <template v-else><p class="empty-version">{{ platform.id === 'android' ? 'An Android installer has not been published yet.' : 'An iOS app invitation has not been published yet.' }}</p><p v-if="!admin" class="help">Your administrator will publish an app version here when it is ready.</p></template>
            <section v-if="platform.id === 'android'" class="install-help"><h3>Installing on Android</h3><ol><li>Open this website in your phone's browser and download the APK.</li><li>Open the downloaded file, allow installation from your browser or file manager if prompted, then install.</li><li>Sign in and allow notifications when requested.</li></ol></section>
            <section v-else class="install-help"><h3>Using an iPhone now</h3><p>Open this website in Safari, use Share, then Add to Home Screen. The website remains available while the signed iOS app is prepared.</p><p>For the native app, use your administrator's TestFlight invitation or App Store link once published.</p></section>
          </article>
        </div>
      </main>
    </ion-content>
    <app-release-modal v-if="admin" :open="uploadOpen" :storage-configured="storageConfigured" @close="uploadOpen = false" @published="published" />
  </ion-page>
</template>
<script setup lang="ts">
import { IonButton,IonContent,IonIcon,IonPage,IonSpinner,alertController,onIonViewWillEnter } from '@ionic/vue'
import { cloudUploadOutline,downloadOutline,logoAndroid,logoApple } from 'ionicons/icons'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { computed,onBeforeUnmount,ref,watch } from 'vue'
import { useRouter } from 'vue-router'
import PortalHeader from '@/components/PortalHeader.vue'
import AppReleaseModal from '@/components/AppReleaseModal.vue'
import { useSession } from '@/composables/useSession'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'
import { appDownloadUrl,appStorageConfigured,listAppReleases,readableAppSize,unpublishAppRelease,type AppRelease } from '@/services/appDownloads'
import { toUserFacingErrorMessage } from '@/utils/errors'
const {profile,signOut}=useSession(),router=useRouter()
const admin=computed(()=>profile.value?.role==='admin')
const platforms=[{id:'android' as const,label:'Android'},{id:'ios' as const,label:'iOS'}]
const releases=ref<AppRelease[]>([]),loading=ref(true),message=ref(''),failed=ref(false),downloading=ref(''),uploadOpen=ref(false),signingOut=ref(false)
const storageConfigured=ref(false),configurationChecked=ref(false)
let request=0,feedback:ReturnType<typeof setTimeout>|undefined
const releaseFor=(platform:'android'|'ios')=>releases.value.find(item=>item.platform===platform)
function show(text:string,error=false){clearTimeout(feedback);message.value=text;failed.value=error;feedback=setTimeout(()=>{message.value=''},6000)}
async function load(silent=false){
  const attempt=++request,actor=profile.value?.id
  if(!actor)return
  if(!silent)loading.value=true
  try{
    const rows=await listAppReleases()
    if(attempt!==request||actor!==profile.value?.id)return
    releases.value=rows
    if(admin.value){const configured=await appStorageConfigured().catch(()=>false);if(attempt!==request||actor!==profile.value?.id)return;storageConfigured.value=configured;configurationChecked.value=true}
  }catch(error){if(attempt===request)show(toUserFacingErrorMessage(error,'App versions could not be loaded.'),true)}
  finally{if(attempt===request)loading.value=false}
}
async function download(release:AppRelease){
  if(downloading.value)return
  const actor=profile.value?.id
  downloading.value=release.platform
  try{const url=await appDownloadUrl(release);if(actor!==profile.value?.id)return;if(Capacitor.isNativePlatform())await Browser.open({url});else window.location.assign(url)}
  catch(error){show(toUserFacingErrorMessage(error),true)}finally{downloading.value=''}
}
async function unpublish(release:AppRelease){
  const actor=profile.value?.id
  const confirmation=await alertController.create({header:`Remove ${release.platform === 'android' ? 'Android' : 'iOS'} download?`,message:'This version will no longer appear in app downloads. The stored package is retained.',buttons:[{text:'Cancel',role:'cancel'},{text:'Remove download',role:'confirm'}]})
  await confirmation.present()
  if((await confirmation.onDidDismiss()).role!=='confirm'||actor!==profile.value?.id)return
  try{await unpublishAppRelease(release.id);await load(true);show('App download removed.')}catch(error){show(toUserFacingErrorMessage(error),true)}
}
async function published(){await load(true);show('The new app version is available to signed-in users.')}
async function logout(){signingOut.value=true;try{await signOut();await router.replace('/login')}catch(error){show(toUserFacingErrorMessage(error),true)}finally{signingOut.value=false}}
watch(()=>profile.value?.id,()=>{request++;releases.value=[];configurationChecked.value=false;storageConfigured.value=false;uploadOpen.value=false;void load()})
onIonViewWillEnter(()=>{void load()})
useRealtimeRefresh({channel:'app-downloads',onChange:()=>load(true)})
onBeforeUnmount(()=>{request++;clearTimeout(feedback)})
</script>
<style scoped>
.downloads-content{--background:var(--campus-bg)}.downloads-shell{max-width:1200px;margin:auto;padding:30px 24px 50px}.downloads-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:24px}.eyebrow{margin:0 0 8px;color:var(--campus-muted);font-size:10px;text-transform:uppercase;letter-spacing:.12em;font-weight:700}h1{margin:0 0 10px;color:var(--campus-text);font:clamp(27px,3vw,36px)/1.15 Georgia,serif}.downloads-heading>div>p:last-child{margin:0;color:var(--campus-muted);font-size:14px;line-height:1.6}.platform-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.platform-card{padding:25px;border:1px solid var(--campus-border);border-radius:18px;background:var(--campus-surface);min-width:0}.platform-title{display:flex;align-items:center;gap:14px}.platform-icon{display:grid;place-items:center;width:54px;height:54px;border-radius:16px;background:var(--campus-green-soft);color:var(--campus-green);font-size:29px}.platform-title h2{margin:0;color:var(--campus-text);font-size:24px}.platform-title .eyebrow{margin-bottom:4px}.version{margin:22px 0 8px;color:var(--campus-text);font-size:15px;font-weight:650}.minimum-os,.help,.empty-version,.release-notes,.archive-notice{font-size:13px;line-height:1.7;color:var(--campus-muted)}.release-notes{white-space:pre-wrap}.platform-actions{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}.platform-actions ion-button{margin:0;text-transform:none}.install-help{margin-top:24px;padding-top:20px;border-top:1px solid var(--campus-border);font-size:13px;line-height:1.7;color:var(--campus-muted)}.install-help h3{margin:0 0 10px;font-size:14px;color:var(--campus-text)}.install-help ol{padding-left:20px;margin:0}.install-help li{padding:3px 0}.install-help p{margin:0 0 10px}.setup-notice,.archive-notice{padding:14px 16px;border:1px solid var(--campus-border);border-radius:12px;background:var(--campus-surface-soft)}.setup-notice{margin:0 0 20px;font-size:13px;color:var(--campus-muted);line-height:1.7}.setup-notice strong{display:block;color:var(--campus-text)}.download-message{padding:12px;border-radius:10px;color:var(--campus-green);background:var(--campus-green-soft);font-size:13px}.download-message.error{color:var(--campus-danger);background:var(--campus-danger-soft)}.loading{display:flex;align-items:center;gap:10px;color:var(--campus-muted)}.checksum{color:var(--campus-muted);font-size:11px;margin-top:18px}.checksum summary{cursor:pointer}.checksum code{display:block;padding-top:8px;overflow-wrap:anywhere}@media(max-width:760px){.platform-grid{grid-template-columns:1fr}.downloads-heading{flex-direction:column}.downloads-shell{padding:24px 16px 35px}.platform-card{padding:20px}}
</style>
