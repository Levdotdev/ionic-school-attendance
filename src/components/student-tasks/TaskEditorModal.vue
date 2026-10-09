<template>
  <ion-modal :is-open="isOpen" :can-dismiss="!saving" @didDismiss="$emit('dismiss')">
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button :disabled="saving" @click="$emit('dismiss')">Cancel</ion-button>
        </ion-buttons>
        <ion-title>{{ task ? 'Edit task' : 'New task' }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="editor-content">
      <form id="student-task-form" class="editor-form" @submit.prevent="submit">
        <div class="form-section">
          <p class="section-label">Task details</p>
          <ion-input
            v-model="title"
            label="Title"
            label-placement="stacked"
            fill="outline"
            :maxlength="160"
            :disabled="saving"
            required
          />
          <ion-textarea
            v-model="description"
            label="Notes"
            label-placement="stacked"
            fill="outline"
            :maxlength="5000"
            :auto-grow="true"
            :disabled="saving"
            placeholder="Instructions, steps, or anything you need to remember"
          />
        </div>

        <div class="form-grid">
          <label class="native-field">
            <span>Due date and time</span>
            <input v-model="dueAtInput" type="datetime-local" :disabled="saving" required />
          </label>

          <ion-select
            v-model="priority"
            label="Priority"
            label-placement="stacked"
            fill="outline"
            interface="popover"
            :disabled="saving"
          >
            <ion-select-option
              v-for="option in STUDENT_TASK_PRIORITY_OPTIONS"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </ion-select-option>
          </ion-select>
        </div>

        <div class="form-section">
          <p class="section-label">Course or category</p>
          <ion-select
            v-model="grouping"
            label="Organize under"
            label-placement="stacked"
            fill="outline"
            interface="popover"
            :disabled="saving"
          >
            <ion-select-option value="none">No course or category</ion-select-option>
            <ion-select-option v-for="course in courses" :key="course.id" :value="`course:${course.id}`">
              {{ course.name }}{{ course.section ? ` · ${course.section}` : '' }}
            </ion-select-option>
            <ion-select-option
              v-for="category in categories"
              :key="category.id"
              :value="`category:${category.id}`"
            >
              {{ category.name }}
            </ion-select-option>
          </ion-select>
          <p class="field-help">Courses come from your class enrollments. Custom categories are managed from the Tasks page.</p>
        </div>

        <div class="form-section">
          <p class="section-label">Repeat and reminders</p>
          <div class="form-grid">
            <ion-select
              v-model="recurrence"
              label="Repeat"
              label-placement="stacked"
              fill="outline"
              interface="popover"
              :disabled="saving"
            >
              <ion-select-option
                v-for="option in STUDENT_TASK_RECURRENCE_OPTIONS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </ion-select-option>
            </ion-select>

            <label v-if="recurrence !== 'none'" class="native-field">
              <span>Repeat until <small>(optional)</small></span>
              <input v-model="recurrenceUntilInput" type="datetime-local" :min="dueAtInput" :disabled="saving" />
            </label>
          </div>

          <fieldset class="reminder-fieldset" :disabled="saving">
            <legend>Remind me before the due time</legend>
            <label v-for="option in STUDENT_TASK_REMINDER_OPTIONS" :key="option.value" class="check-option">
              <ion-checkbox
                :checked="reminderMinutes.includes(option.value)"
                @ionChange="toggleReminder(option.value, $event.detail.checked)"
              />
              <span>{{ option.label }}</span>
            </label>
          </fieldset>
        </div>

        <div class="form-section">
          <div class="section-heading">
            <div>
              <p class="section-label">Links</p>
              <p class="field-help">Add webpages, references, or submission links.</p>
            </div>
            <ion-button type="button" fill="outline" size="small" :disabled="saving" @click="addLink">
              <ion-icon slot="start" :icon="addOutline" /> Add link
            </ion-button>
          </div>

          <div v-if="links.length" class="link-list">
              <div v-for="(taskLink, linkIndex) in links" :key="taskLink.id" class="link-row">
                <label class="native-field">
                  <span>Link name</span>
                  <input v-model="taskLink.title" :disabled="saving" placeholder="Reference" />
                </label>
                <label class="native-field">
                  <span>URL</span>
                  <input v-model="taskLink.url" type="url" :disabled="saving" placeholder="https://..." />
                </label>
                <ion-button
                  type="button"
                  fill="clear"
                  color="danger"
                  :disabled="saving"
                  :aria-label="`Remove ${taskLink.title || 'link'}`"
                  @click="links.splice(linkIndex, 1)"
                >
                  <ion-icon slot="icon-only" :icon="trashOutline" />
                </ion-button>
              </div>
          </div>
        </div>

        <div class="form-section">
          <p class="section-label">Attachments</p>
          <p class="field-help">Images, PDF, Office, or text files up to 5 MB each.</p>

          <div v-if="keptFiles.length" class="file-list">
            <div v-for="file in keptFiles" :key="file.id" class="file-row">
              <ion-icon :icon="documentAttachOutline" />
              <span>{{ file.file_name }}</span>
              <ion-button
                type="button"
                fill="clear"
                color="danger"
                :disabled="saving"
                :aria-label="`Remove ${file.file_name}`"
                @click="removeExistingFile(file.id)"
              >
                <ion-icon slot="icon-only" :icon="closeOutline" />
              </ion-button>
            </div>
          </div>

          <div v-if="newFiles.length" class="file-list">
            <div v-for="(file, index) in newFiles" :key="`${file.name}:${file.lastModified}`" class="file-row is-new">
              <ion-icon :icon="documentAttachOutline" />
              <span>{{ file.name }}</span>
              <small>New</small>
              <ion-button
                type="button"
                fill="clear"
                color="danger"
                :disabled="saving"
                :aria-label="`Remove ${file.name}`"
                @click="newFiles.splice(index, 1)"
              >
                <ion-icon slot="icon-only" :icon="closeOutline" />
              </ion-button>
            </div>
          </div>

          <label class="file-picker" :class="{ 'is-disabled': saving }">
            <ion-icon :icon="cloudUploadOutline" />
            <span>Choose files</span>
            <input
              type="file"
              multiple
              :disabled="saving"
              accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
              @change="selectFiles"
            />
          </label>
        </div>

        <div v-if="validationMessage" class="form-error" role="alert">
          <ion-icon :icon="alertCircleOutline" />
          <span>{{ validationMessage }}</span>
        </div>

        <ion-button class="save-button" expand="block" size="large" type="submit" :disabled="saving">
          <ion-spinner v-if="saving" name="crescent" />
          <template v-else>{{ task ? 'Save changes' : 'Create task' }}</template>
        </ion-button>
      </form>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonModal,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import {
  addOutline,
  alertCircleOutline,
  closeOutline,
  cloudUploadOutline,
  documentAttachOutline,
  trashOutline,
} from 'ionicons/icons'
import { computed, ref, watch } from 'vue'

import type {
  StudentCourse,
  StudentTask,
  StudentTaskCategory,
  StudentTaskLinkDraft,
  StudentTaskPriority,
  StudentTaskRecurrence,
  StudentTaskReminderMinutes,
  StudentTaskSaveInput,
} from '@/types/studentTasks'
import {
  STUDENT_TASK_PRIORITY_OPTIONS,
  STUDENT_TASK_RECURRENCE_OPTIONS,
  STUDENT_TASK_REMINDER_OPTIONS,
} from '@/types/studentTasks'
import { fromLocalDateTimeInput, toLocalDateTimeInput } from '@/utils/studentTasks'

const props = defineProps<{
  isOpen: boolean
  task: StudentTask | null
  courses: StudentCourse[]
  categories: StudentTaskCategory[]
  saving: boolean
}>()

const emit = defineEmits<{
  dismiss: []
  save: [input: StudentTaskSaveInput]
}>()

const title = ref('')
const description = ref('')
const dueAtInput = ref('')
const priority = ref<StudentTaskPriority>('medium')
const recurrence = ref<StudentTaskRecurrence>('none')
const recurrenceUntilInput = ref('')
const reminderMinutes = ref<StudentTaskReminderMinutes[]>([])
const grouping = ref('none')
const links = ref<StudentTaskLinkDraft[]>([])
const newFiles = ref<File[]>([])
const removedFileIds = ref<string[]>([])
const validationMessage = ref('')

const keptFiles = computed(() =>
  (props.task?.files ?? []).filter((file) => !removedFileIds.value.includes(file.id)),
)

function freshDueDate(): string {
  const date = new Date()
  date.setHours(date.getHours() + 1, 0, 0, 0)
  return toLocalDateTimeInput(date)
}

function resetForm() {
  title.value = props.task?.title ?? ''
  description.value = props.task?.description ?? ''
  dueAtInput.value = props.task ? toLocalDateTimeInput(props.task.due_at) : freshDueDate()
  priority.value = props.task?.priority ?? 'medium'
  recurrence.value = props.task?.recurrence ?? 'none'
  recurrenceUntilInput.value = props.task?.recurrence_until
    ? toLocalDateTimeInput(props.task.recurrence_until)
    : ''
  reminderMinutes.value = [...(props.task?.reminder_minutes ?? [])]
  grouping.value = props.task?.class_id
    ? `course:${props.task.class_id}`
    : props.task?.category_id
      ? `category:${props.task.category_id}`
      : 'none'
  links.value = (props.task?.links ?? []).map((link) => ({
    id: link.id,
    title: link.title,
    url: link.url,
  }))
  newFiles.value = []
  removedFileIds.value = []
  validationMessage.value = ''
}

watch(() => props.isOpen, (isOpen) => {
  if (isOpen) resetForm()
})

function addLink() {
  links.value.push({ id: crypto.randomUUID(), title: '', url: '' })
}

function toggleReminder(value: StudentTaskReminderMinutes, checked: boolean) {
  reminderMinutes.value = checked
    ? [...new Set([...reminderMinutes.value, value])]
    : reminderMinutes.value.filter((item) => item !== value)
}

function removeExistingFile(fileId: string) {
  removedFileIds.value.push(fileId)
}

function selectFiles(event: Event) {
  const input = event.target as HTMLInputElement
  newFiles.value.push(...Array.from(input.files ?? []))
  input.value = ''
}

function submit() {
  validationMessage.value = ''
  const cleanTitle = title.value.trim()
  if (!cleanTitle) {
    validationMessage.value = 'Enter a task title.'
    return
  }

  let dueAt: string
  let recurrenceUntil: string | null = null
  try {
    dueAt = fromLocalDateTimeInput(dueAtInput.value)
    if (recurrence.value !== 'none' && recurrenceUntilInput.value) {
      recurrenceUntil = fromLocalDateTimeInput(recurrenceUntilInput.value)
      if (new Date(recurrenceUntil).getTime() <= new Date(dueAt).getTime()) {
        validationMessage.value = 'The repeat-until time must be later than the first due time.'
        return
      }
    }
  } catch (error) {
    validationMessage.value = error instanceof Error ? error.message : 'Choose a valid due date.'
    return
  }

  const incompleteLink = links.value.find((link) => Boolean(link.title.trim()) !== Boolean(link.url.trim()))
  if (incompleteLink) {
    validationMessage.value = 'Each link needs both a name and a URL.'
    return
  }
  const invalidLink = links.value.find((link) => link.url.trim() && !/^https?:\/\/\S+$/i.test(link.url.trim()))
  if (invalidLink) {
    validationMessage.value = 'Links must begin with http:// or https://.'
    return
  }

  const classId = grouping.value.startsWith('course:') ? grouping.value.slice(7) : null
  const categoryId = grouping.value.startsWith('category:') ? grouping.value.slice(9) : null

  emit('save', {
    title: cleanTitle,
    description: description.value,
    due_at: dueAt,
    priority: priority.value,
    recurrence: recurrence.value,
    recurrence_until: recurrenceUntil,
    reminder_minutes: reminderMinutes.value,
    class_id: classId,
    category_id: categoryId,
    links: links.value.filter((link) => link.title.trim() && link.url.trim()),
    newFiles: newFiles.value,
    removedFileIds: removedFileIds.value,
  })
}
</script>

<style scoped>
.editor-content {
  --background: var(--campus-bg);
}

.editor-form {
  display: grid;
  width: min(100% - 2rem, 720px);
  gap: 1rem;
  margin: 0 auto;
  padding: 1.25rem 0 max(2rem, env(safe-area-inset-bottom));
}

.form-section {
  display: grid;
  gap: 0.8rem;
  padding: 1rem;
  border: 1px solid var(--campus-border);
  border-radius: var(--campus-radius-sm);
  background: var(--campus-surface);
}

.section-label {
  margin: 0;
  color: var(--campus-text);
  font-size: 0.86rem;
  font-weight: 750;
}

.section-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
}

.field-help {
  margin: 0;
  color: var(--campus-muted);
  font-size: 0.75rem;
  line-height: 1.45;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.8rem;
}

.native-field {
  display: grid;
  gap: 0.45rem;
  color: var(--campus-text);
  font-size: 0.74rem;
}

.native-field span {
  padding-inline: 0.2rem;
  font-weight: 600;
}

.native-field small {
  color: var(--campus-muted);
  font-weight: 500;
}

.native-field input {
  min-height: 54px;
  padding: 0 0.9rem;
  border: 1px solid var(--campus-border);
  border-radius: 12px;
  outline: none;
  background: var(--campus-surface);
  color: var(--campus-text);
  font: inherit;
  font-size: 0.88rem;
}

.native-field input:focus {
  border-color: var(--ion-color-primary);
  box-shadow: 0 0 0 1px var(--ion-color-primary);
}

.reminder-fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  margin: 0;
  padding: 0.2rem 0 0;
  border: 0;
}

.reminder-fieldset legend {
  width: 100%;
  margin-bottom: 0.55rem;
  color: var(--campus-muted);
  font-size: 0.74rem;
}

.check-option {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--campus-border);
  border-radius: 10px;
  color: var(--campus-text);
  font-size: 0.77rem;
}

.check-option ion-checkbox {
  --size: 17px;
}

.link-list,
.file-list {
  display: grid;
  gap: 0.55rem;
}

.link-row {
  display: grid;
  grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.25fr) auto;
  gap: 0.55rem;
  align-items: center;
}

.file-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border-radius: 10px;
  background: var(--campus-surface-soft);
  color: var(--campus-muted);
  font-size: 0.78rem;
}

.file-row > span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--campus-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-row small {
  color: var(--campus-success);
  font-weight: 700;
}

.file-row ion-button {
  min-height: 32px;
  margin: 0;
}

.file-picker {
  position: relative;
  display: flex;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px dashed var(--ion-color-primary);
  border-radius: 11px;
  color: var(--ion-color-primary);
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
}

.file-picker input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.file-picker.is-disabled {
  cursor: default;
  opacity: 0.5;
}

.form-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 11px;
  background: var(--campus-danger-soft);
  color: var(--campus-danger);
  font-size: 0.8rem;
}

.save-button {
  margin: 0;
}

@media (max-width: 600px) {
  .editor-form {
    width: min(100% - 1rem, 720px);
  }

  .form-grid,
  .link-row {
    grid-template-columns: 1fr;
  }

  .link-row ion-button {
    justify-self: end;
  }
}
</style>
