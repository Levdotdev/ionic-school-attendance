<template>
  <app-modal :open="open" title="Publish app version" :busy="busy" wide @close="close">
    <form class="release-form" @submit.prevent="save">
      <div class="release-fields"><ion-input v-model="version" label="App version" label-placement="stacked" fill="outline" placeholder="1.0.0" :maxlength="40" :disabled="busy" required /><ion-input v-model="minimumOs" label="Minimum Android version (optional)" label-placement="stacked" fill="outline" placeholder="Android 9" :maxlength="80" :disabled="busy" /></div>
      <ion-textarea v-model="notes" label="What changed? (optional)" label-placement="stacked" fill="outline" auto-grow :maxlength="2000" :disabled="busy" />
      <p v-if="!storageConfigured" class="notice">Cloudflare R2 is not configured yet. Set up the private app bucket and protected R2 credentials before uploading packages.</p>
      <label>Android APK<input type="file" accept=".apk" :disabled="busy || !storageConfigured" @change="selectFile" /></label>
      <p class="help">Up to 200 MB. Publishing replaces the current Android download after the APK is uploaded and verified.</p>
      <div v-if="busy" class="upload-progress" role="status"><progress :value="progress" max="100" />{{ progress >= 96 ? 'Verifying and publishing…' : progress ? `Uploading ${progress}%` : 'Preparing app package…' }}</div>
      <p v-if="message" class="error" role="alert">{{ message }}</p>
      <div class="release-actions"><ion-button fill="outline" :disabled="busy && progress >= 96" @click="busy ? cancelUpload() : close()">{{ busy ? 'Cancel upload' : 'Cancel' }}</ion-button><ion-button type="submit" :disabled="busy || !version.trim() || !file || !storageConfigured">{{ busy ? 'Publishing…' : 'Publish version' }}</ion-button></div>
    </form>
  </app-modal>
</template>
<script setup lang="ts">
import { IonButton,IonInput,IonTextarea } from '@ionic/vue'
import { onBeforeUnmount,ref,watch } from 'vue'
import AppModal from '@/components/AppModal.vue'
import { uploadAppRelease } from '@/services/appDownloads'
import { toUserFacingErrorMessage } from '@/utils/errors'
const props=defineProps<{open:boolean;storageConfigured:boolean}>()
const emit=defineEmits<{close:[];published:[]}>()
const version=ref(''),minimumOs=ref(''),notes=ref(''),file=ref<File|null>(null)
const busy=ref(false),progress=ref(0),message=ref('')
let controller:AbortController|undefined
watch(()=>props.open,open=>{if(open){version.value='';minimumOs.value='';notes.value='';file.value=null;message.value='';progress.value=0}})
function selectFile(event:Event){file.value=(event.target as HTMLInputElement).files?.[0]??null}
function cancelUpload(){controller?.abort()}
function close(){if(!busy.value)emit('close')}
async function save(){
  if(busy.value)return
  busy.value=true;message.value='';progress.value=0
  controller=new AbortController()
  try{
    const draft={version:version.value.trim(),minimum_os:minimumOs.value.trim(),notes:notes.value.trim()}
    if(!file.value)throw new Error('Choose an Android APK.')
    await uploadAppRelease(file.value,{platform:'android',...draft},value=>{progress.value=value},controller.signal)
    emit('published');emit('close')
  }catch(error){message.value=toUserFacingErrorMessage(error)}finally{busy.value=false;controller=undefined}
}
onBeforeUnmount(()=>controller?.abort())
</script>
<style scoped>
.release-form{display:grid;gap:18px}.release-form label{display:grid;gap:8px;font-size:13px;color:var(--campus-text)}input[type=file]{width:100%;min-height:44px;padding:10px;border:1px solid var(--campus-border);border-radius:10px;background:var(--campus-surface);color:var(--campus-text);font:inherit}.release-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}.help,.notice{margin:0;color:var(--campus-muted);font-size:13px;line-height:1.65}.notice{padding:12px;border:1px solid var(--campus-border);border-radius:10px;background:var(--campus-surface-soft)}.release-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px}.release-actions ion-button{margin:0}.upload-progress{display:grid;gap:8px;color:var(--campus-muted);font-size:13px}progress{width:100%;accent-color:var(--campus-green)}.error{margin:0;color:var(--campus-danger);font-size:13px;line-height:1.6}@media(max-width:600px){.release-fields{grid-template-columns:1fr}}
</style>
