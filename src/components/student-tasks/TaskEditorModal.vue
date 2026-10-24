<template>
  <task-dialog :is-open="isOpen" :title="task ? 'Make a few adjustments.' : 'A new task, a fresh start.'" :description="task ? 'Update the details and keep your plans on track.' : 'Add the details now. Your future self will thank you.'" :icon="createOutline" :busy="saving || takingPhoto" wide hide-footer @dismiss="$emit('dismiss')">
    <form class="task-form" @submit.prevent="submit">
      <label class="field"><span>Task title</span><input v-model="title" maxlength="160" placeholder="What needs to get done?" required :disabled="saving" /></label>
      <label class="field"><span>Notes</span><textarea v-model="description" rows="3" maxlength="5000" placeholder="A few details to help you get started…" :disabled="saving" /></label>
      <div class="form-row">
        <label class="field"><span>Due date &amp; time</span><day-date-input v-model="dueAtInput" type="datetime-local" required :disabled="saving" /></label>
        <label class="field"><span>Priority</span><select v-model="priority" :disabled="saving"><option v-for="option in STUDENT_TASK_PRIORITY_OPTIONS" :key="option.value" :value="option.value">{{ option.label }} priority</option></select></label>
      </div>
      <div class="form-row">
        <label class="field"><span>Course / category <small>Optional</small></span><select v-model="grouping" :disabled="saving"><option value="none">No course or category</option><optgroup label="Your enrolled courses"><option v-for="course in courses" :key="course.id" :value="'course:' + course.id">{{ course.name }}{{ course.section ? ' · ' + course.section : '' }}</option></optgroup><optgroup label="Custom categories"><option v-for="category in categories" :key="category.id" :value="'category:' + category.id">{{ category.name }}</option></optgroup></select></label>
        <label class="field"><span>Repeat</span><select v-model="recurrence" :disabled="saving"><option v-for="option in STUDENT_TASK_RECURRENCE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
      </div>
      <button type="button" class="inline-button" :disabled="saving" @click="$emit('create-category')">Manage custom categories</button>
      <p v-if="recurrence !== 'none'" class="field-hint">Repeats appear automatically in your calendar. Complete each date separately. Editing updates the recurring schedule.</p>
      <label v-if="recurrence !== 'none'" class="field"><span>Repeat until <small>Optional</small></span><day-date-input v-model="recurrenceUntilInput" type="datetime-local" :min="dueAtInput" :disabled="saving" /></label>
      <fieldset class="reminder-section" :disabled="saving">
        <legend><ion-icon :icon="notificationsOutline" />Remind me before it’s due</legend>
        <div class="reminder-options"><label v-for="option in STUDENT_TASK_REMINDER_OPTIONS" :key="option.value" :class="{ checked: reminderMinutes.includes(option.value) }"><input v-model="reminderMinutes" type="checkbox" :value="option.value" /><span>{{ option.label }}</span></label></div>
        <p class="field-hint">Saved with this task. Delivered as device notifications in the installed mobile app.</p>
      </fieldset>
      <section class="attachment-section" aria-label="Task attachments">
        <div class="section-label"><ion-icon :icon="attachOutline" /><span>A little extra context</span><small>Optional</small></div>
        <div v-for="(link, index) in links" :key="link.id" class="link-entry">
          <div class="link-heading"><strong>Link {{ index + 1 }}</strong><button class="remove-button" type="button" :disabled="saving" :aria-label="'Remove link ' + (index + 1)" @click="links.splice(index, 1)"><ion-icon :icon="closeOutline" /></button></div>
          <label class="field"><span>Link title</span><input v-model="link.title" maxlength="160" placeholder="Project brief, useful article…" :disabled="saving" /></label>
          <label class="field"><span>URL</span><input v-model="link.url" maxlength="2048" type="url" placeholder="https://…" :disabled="saving" /></label>
        </div>
        <button class="secondary-button add-link" type="button" :disabled="saving" @click="addLink"><ion-icon :icon="addOutline" />Add {{ links.length ? 'another' : 'a' }} link</button>
        <div class="attachment-controls">
          <button class="upload-button" type="button" :disabled="saving || takingPhoto" @click="fileInput?.click()"><ion-icon :icon="documentAttachOutline" /><span>Attach files</span></button>
          <button class="upload-button" type="button" :disabled="saving || takingPhoto" @click="takePhoto"><ion-icon :icon="cameraOutline" /><span>{{ takingPhoto ? 'Opening camera…' : 'Take a photo' }}</span></button>
          <input ref="fileInput" type="file" multiple hidden accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,.doc,.docx,.ppt,.pptx,.xls,.xlsx" @change="selectFiles" />
        </div>
        <p class="field-hint">Up to 5 MB per file · 10 MB total for files and photos.</p>
        <ul v-if="keptFiles.length || newFiles.length" class="file-list">
          <li v-for="file in keptFiles" :key="file.id"><ion-icon :icon="documentAttachOutline" /><span><strong>{{ file.file_name }}</strong><small>{{ formatFileSize(file.size_bytes) }}</small></span><button class="remove-button" type="button" :disabled="saving" :aria-label="'Remove ' + file.file_name" @click="removedFileIds.push(file.id)"><ion-icon :icon="closeOutline" /></button></li>
          <li v-for="(file, index) in newFiles" :key="file.name + ':' + index"><ion-icon :icon="documentAttachOutline" /><span><strong>{{ file.name }}</strong><small>{{ formatFileSize(file.size) }} · New</small></span><button class="remove-button" type="button" :disabled="saving" :aria-label="'Remove ' + file.name" @click="removeNewFile(index)"><ion-icon :icon="closeOutline" /></button></li>
        </ul>
        <div v-if="photoPreview" class="photo-preview"><img :src="photoPreview" alt="Task photo preview" /><span><ion-icon :icon="cameraOutline" />Photo attached</span></div>
      </section>
      <p v-if="validationMessage || error" class="form-error" role="alert">{{ validationMessage || error }}</p>
      <div class="form-footer"><button class="primary-button" type="submit" :disabled="saving || takingPhoto || !title.trim() || !dueAtInput"><ion-spinner v-if="saving" name="crescent" /><ion-icon v-else :icon="checkmarkOutline" />{{ saving ? 'Saving…' : task ? 'Save changes' : 'Create task' }}</button><button class="cancel-button" type="button" :disabled="saving || takingPhoto" @click="$emit('dismiss')">Cancel</button></div>
    </form>
  </task-dialog>
</template>

<script setup lang="ts">
import { IonIcon, IonSpinner } from '@ionic/vue'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { addOutline, attachOutline, cameraOutline, checkmarkOutline, closeOutline, createOutline, documentAttachOutline, notificationsOutline } from 'ionicons/icons'
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import TaskDialog from './TaskDialog.vue'
import DayDateInput from '@/components/DayDateInput.vue'
import type { StudentCourse, StudentTask, StudentTaskCategory, StudentTaskLinkDraft, StudentTaskPriority, StudentTaskRecurrence, StudentTaskReminderMinutes, StudentTaskSaveInput } from '@/types/studentTasks'
import { STUDENT_TASK_PRIORITY_OPTIONS, STUDENT_TASK_RECURRENCE_OPTIONS, STUDENT_TASK_REMINDER_OPTIONS } from '@/types/studentTasks'
import { fromLocalDateTimeInput, toLocalDateTimeInput } from '@/utils/studentTasks'
import { toUserFacingErrorMessage } from '@/utils/errors'
import { validateStudentTaskFiles } from '@/utils/studentTaskAttachments'
const props = defineProps<{ isOpen: boolean; task: StudentTask | null; courses: StudentCourse[]; categories: StudentTaskCategory[]; saving: boolean; error?: string; defaultDueAt?: string }>()
const emit = defineEmits<{ dismiss: []; save: [input: StudentTaskSaveInput]; 'create-category': [] }>()
const title = ref(''), description = ref(''), dueAtInput = ref(''), recurrenceUntilInput = ref(''), grouping = ref('none')
const priority = ref<StudentTaskPriority>('medium'), recurrence = ref<StudentTaskRecurrence>('none'), reminderMinutes = ref<StudentTaskReminderMinutes[]>([])
const links = ref<StudentTaskLinkDraft[]>([]), newFiles = ref<File[]>([]), removedFileIds = ref<string[]>([])
const validationMessage = ref(''), takingPhoto = ref(false), photoPreview = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const keptFiles = computed(() => (props.task?.files ?? []).filter(file => !removedFileIds.value.includes(file.id)))
function formatFileSize(size: number) { return size >= 1024 * 1024 ? (size / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(1, Math.round(size / 1024)) + ' KB' }
function addLink() { links.value.push({ id: crypto.randomUUID(), title: '', url: '' }) }
function clearPreview() { if (photoPreview.value) URL.revokeObjectURL(photoPreview.value); photoPreview.value = '' }
function resetForm() {
  title.value = props.task?.title ?? ''; description.value = props.task?.description ?? ''
  dueAtInput.value = props.task ? toLocalDateTimeInput(props.task.due_at) : props.defaultDueAt || toLocalDateTimeInput(new Date(Date.now() + 3_600_000))
  priority.value = props.task?.priority ?? 'medium'; recurrence.value = props.task?.recurrence ?? 'none'
  recurrenceUntilInput.value = props.task?.recurrence_until ? toLocalDateTimeInput(props.task.recurrence_until) : ''
  reminderMinutes.value = [...(props.task?.reminder_minutes ?? [])]
  grouping.value = props.task?.class_id ? 'course:' + props.task.class_id : props.task?.category_id ? 'category:' + props.task.category_id : 'none'
  links.value = (props.task?.links ?? []).map(link => ({ id: link.id, title: link.title, url: link.url }))
  newFiles.value = []; removedFileIds.value = []; validationMessage.value = ''; clearPreview()
}
watch(() => props.isOpen, open => { if (open) resetForm(); else clearPreview() })
onBeforeUnmount(clearPreview)
function selectFiles(event: Event) {
  const input = event.target as HTMLInputElement, files = Array.from(input.files ?? [])
  input.value = ''; validationMessage.value = ''
  try { validateStudentTaskFiles([...newFiles.value, ...files], keptFiles.value) }
  catch (error) { validationMessage.value = toUserFacingErrorMessage(error, 'These attachments could not be added.'); return }
  newFiles.value.push(...files)
}
function removeNewFile(index: number) { newFiles.value.splice(index, 1); clearPreview() }
async function takePhoto() {
  takingPhoto.value = true; validationMessage.value = ''
  try {
    const photo = await Camera.getPhoto({ source: CameraSource.Camera, resultType: CameraResultType.Uri, quality: 80, width: 1600, correctOrientation: true })
    if (!photo.webPath) throw new Error('No camera photo was returned.')
    const response = await fetch(photo.webPath), blob = await response.blob()
    const file = new File([blob], 'task-photo-' + Date.now() + '.jpg', { type: blob.type || 'image/jpeg' })
    validateStudentTaskFiles([...newFiles.value, file], keptFiles.value)
    newFiles.value.push(file); clearPreview(); photoPreview.value = URL.createObjectURL(file)
  } catch (error) {
    const message = toUserFacingErrorMessage(error, 'The camera could not be opened.')
    if (!/cancel/i.test(message)) validationMessage.value = message
  } finally { takingPhoto.value = false }
}
function submit() {
  if (props.saving || takingPhoto.value) return
  validationMessage.value = ''
  try {
    if (!title.value.trim()) throw new Error('Enter a task title.')
    const due = fromLocalDateTimeInput(dueAtInput.value)
    const until = recurrence.value !== 'none' && recurrenceUntilInput.value ? fromLocalDateTimeInput(recurrenceUntilInput.value) : null
    if (until && new Date(until) <= new Date(due)) throw new Error('The repeat-until time must be later than the first due time.')
    const cleanLinks = links.value.filter(link => link.title.trim() || link.url.trim()).map(link => {
      let url: URL
      try { url = new URL(link.url.trim()) } catch { throw new Error('Give each link a valid URL beginning with https:// or http://.') }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Links must use https:// or http://.')
      return { ...link, title: link.title.trim() || url.hostname, url: url.href }
    })
    emit('save', { title: title.value.trim(), description: description.value, due_at: due, priority: priority.value, recurrence: recurrence.value, recurrence_until: until, reminder_minutes: reminderMinutes.value, class_id: grouping.value.startsWith('course:') ? grouping.value.slice(7) : null, category_id: grouping.value.startsWith('category:') ? grouping.value.slice(9) : null, links: cleanLinks, newFiles: [...newFiles.value], removedFileIds: [...removedFileIds.value] })
  } catch (error) { validationMessage.value = error instanceof Error ? error.message : 'Please review the task details.' }
}
</script>
<style scoped>
.task-form { display: flex; flex-direction: column; gap: 20px; }
.form-row { display: grid; grid-template-columns: 1.3fr 1fr; gap: 14px; }
.field small { color: var(--campus-muted); font-weight: 400; }
.field-hint { margin: -6px 0 0; color: var(--campus-muted); font-size: 11px; line-height: 1.7; }
.field-hint.warning { color: var(--campus-warning); }
.reminder-section { display: flex; flex-direction: column; gap: 14px; margin: 0; padding: 18px; border: 1px solid var(--campus-border); border-radius: 13px; background: var(--campus-bg); }
.reminder-section legend { padding: 0 7px; font-size: 12px; font-weight: 600; }
.reminder-section legend ion-icon { margin-right: 6px; vertical-align: middle; font-size: 16px; }
.reminder-options { display: flex; flex-wrap: wrap; gap: 8px; }
.reminder-options label { display: flex; align-items: center; gap: 7px; min-height: 42px; padding: 8px 10px; border: 1px solid var(--campus-border); border-radius: 9px; font-size: 12px; background: var(--campus-surface); cursor: pointer; }
.reminder-options label.checked { color: var(--ion-color-primary); border-color: var(--ion-color-primary); background: var(--campus-green-soft); }
.reminder-options input { width: 15px; height: 15px; accent-color: var(--ion-color-primary); }
.attachment-section { display: flex; flex-direction: column; gap: 16px; padding-top: 21px; border-top: 1px solid var(--campus-border); }
.section-label { display: flex; align-items: center; gap: 7px; color: var(--campus-text); font-size: 12px; font-weight: 600; }
.section-label > ion-icon { font-size: 18px; color: var(--campus-muted); }
.section-label small { margin-left: auto; color: var(--campus-muted); font-size: 10px; font-weight: 400; }
.link-entry { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px 16px; border: 1px solid var(--campus-border); border-radius: 12px; }
.link-heading { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--campus-muted); }
.add-link { align-self: flex-start; }
.attachment-controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: start; }
.upload-button { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 46px; padding: 12px; border: 1px dashed var(--campus-border); border-radius: 12px; background: var(--campus-bg); color: var(--campus-muted); font-size: 12px; }
.upload-button span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.upload-button ion-icon { font-size: 18px; flex-shrink: 0; }
.upload-button:hover:not(:disabled) { border-color: var(--ion-color-primary); color: var(--ion-color-primary); }
.file-list { display: flex; flex-direction: column; gap: 7px; margin: 0; padding: 0; list-style: none; }
.file-list li { display: flex; align-items: center; gap: 9px; padding: 5px 8px 5px 12px; border: 1px solid var(--campus-border); border-radius: 10px; font-size: 12px; }
.file-list li > ion-icon { flex-shrink: 0; color: var(--campus-muted); }
.file-list li > span { flex: 1; min-width: 0; }
.file-list strong { display: block; overflow-wrap: anywhere; font-weight: 500; }
.file-list small { display: block; margin-top: 3px; color: var(--campus-muted); font-size: 10px; }
.remove-button { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: var(--campus-muted); font-size: 19px; }
.remove-button:hover:not(:disabled) { color: var(--campus-danger); background: var(--campus-danger-soft); }
.photo-preview { position: relative; }
.photo-preview img { width: 100%; max-height: 200px; object-fit: cover; border: 1px solid var(--campus-border); border-radius: 13px; }
.photo-preview > span { position: absolute; display: inline-flex; align-items: center; gap: 5px; bottom: 12px; left: 12px; padding: 7px 10px; border-radius: 8px; background: var(--campus-surface); color: var(--campus-text); font-size: 10px; }
.photo-preview .remove-button { position: absolute; right: 10px; top: 10px; background: var(--campus-surface); }
.form-footer { position: sticky; bottom: -28px; z-index: 1; display: flex; flex-direction: column; gap: 6px; margin: 4px -28px -28px; padding: 16px 28px 18px; border-top: 1px solid var(--campus-border); background: var(--campus-surface); }
.form-footer p { margin: 0 0 10px; color: var(--campus-muted); font-size: 11px; text-align: center; line-height: 1.6; }
.form-footer ion-spinner { width: 18px; height: 18px; }
@media (max-width: 440px) { .form-row { grid-template-columns: 1fr; } .reminder-section { padding: 14px; } }
@media (max-width: 480px) { .form-footer { bottom: -24px; margin: 4px -20px -24px; padding: 14px 20px 16px; } }

.field { display: flex; flex-direction: column; min-width: 0; gap: 8px; }
.field > span { color: var(--campus-text); font-size: 13px; font-weight: 600; }
.field input, .field textarea, .field select { width: 100%; min-width: 0; min-height: 46px; padding: 12px 14px; color: var(--campus-text); background: var(--campus-surface); border: 1px solid var(--campus-border); border-radius: 12px; font: inherit; font-size: 14px; }
.field textarea { resize: vertical; line-height: 1.6; }
.primary-button, .secondary-button, .cancel-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 12px 20px; border: 1px solid transparent; border-radius: 12px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.primary-button { background: var(--ion-color-primary); color: var(--ion-color-primary-contrast); }
.secondary-button { background: var(--campus-surface); border-color: var(--campus-border); color: var(--campus-text); }
.cancel-button { color: var(--campus-muted); background: transparent; }
.inline-button { align-self: start; margin-top: -10px; padding: 8px 0; border: 0; background: transparent; color: var(--ion-color-primary); font: inherit; font-size: 12px; cursor: pointer; }
.form-error { padding: 12px 14px; border-radius: 12px; color: var(--campus-danger); background: var(--campus-danger-soft); font-size: 13px; line-height: 1.6; }
button:disabled { opacity: .55; cursor: wait; }
@media (max-width: 600px) { .field input, .field textarea, .field select { font-size: 16px; } }
</style>
