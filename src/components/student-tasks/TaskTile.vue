<template>
  <article class="task-tile" :class="{ 'task-completed': item.status === 'completed' }">
    <div v-if="imageUrl" class="task-thumb"><img :src="imageUrl" :alt="`Photo for ${task.title}`" loading="lazy" /></div>
    <div class="task-body">
      <div class="badge-row"><span class="priority-badge" :class="task.priority"><span />{{ task.priority }} priority</span><span class="status-badge" :class="displayStatus.toLowerCase()">{{ displayStatus }}</span></div>
      <div v-if="groupLabel || (task.recurrence && task.recurrence !== 'none') || task.reminder_minutes?.length" class="task-meta"><span v-if="groupLabel" class="category-badge">{{ groupLabel }}</span><span v-if="task.recurrence && task.recurrence !== 'none'"><ion-icon :icon="repeatOutline" aria-hidden="true" />{{ recurrenceLabel(task.recurrence) }}</span><span v-if="task.reminder_minutes?.length" :title="reminderLabel"><ion-icon :icon="notificationsOutline" aria-hidden="true" />{{ task.reminder_minutes.length }} {{ task.reminder_minutes.length === 1 ? 'reminder' : 'reminders' }}</span></div>
      <h3 class="task-title">{{ task.title }}</h3>
      <p class="task-description">{{ task.description }}</p>
      <p class="task-due" :class="{ overdue: displayStatus === 'Missed' }"><ion-icon :icon="calendarOutline" aria-hidden="true" /><time :datetime="item.due_at">{{ formattedDue }}</time></p>
      <div v-if="links.length || files.length" class="attachments">
        <a v-for="link in links" :key="link.id" :href="safeLink(link.url)" :title="link.url" target="_blank" rel="noopener noreferrer" class="attachment-link"><ion-icon :icon="linkOutline" aria-hidden="true" /><span>{{ link.title || link.url }}</span><ion-icon :icon="arrowUpRight" aria-hidden="true" /></a>
        <button v-for="file in files" :key="file.id" type="button" class="attachment-link" :disabled="downloadingFile !== null" :aria-label="`Download ${file.file_name}`" :aria-busy="downloadingFile === file.id" @click="downloadAttachment(file)"><ion-icon :icon="documentAttachOutline" aria-hidden="true" /><span>{{ downloadingFile === file.id ? 'Saving…' : file.file_name }}</span></button>
      </div>
      <p v-if="downloadMessage" class="attachment-message" role="status">{{ downloadMessage }}</p>
      <p v-if="downloadError" class="attachment-message attachment-error" role="alert">{{ downloadError }}</p>
      <div v-if="manualOrder" class="order-controls"><button class="drag-handle" :draggable="!busy" @dragstart="$emit('drag', $event)" type="button" :disabled="busy" :aria-label="`Drag to reorder ${task.title}`" title="Drag to reorder"><ion-icon :icon="reorderThreeOutline" aria-hidden="true" />Drag to reorder</button><button type="button" :disabled="busy || !canMoveUp" :aria-label="`Move ${task.title} earlier`" @click="$emit('move', -1)"><ion-icon :icon="arrowUpOutline" aria-hidden="true" /></button><button type="button" :disabled="busy || !canMoveDown" :aria-label="`Move ${task.title} later`" @click="$emit('move', 1)"><ion-icon :icon="arrowDownOutline" aria-hidden="true" /></button></div>
      <div class="tile-actions">
        <button :disabled="busy" v-if="item.status === 'completed'" type="button" class="task-action" @click="$emit('revert')"><ion-icon :icon="arrowUndoOutline" aria-hidden="true" />Revert</button>
        <template v-else>
          <button :disabled="busy" type="button" class="task-action" @click="$emit('edit')"><ion-icon :icon="createOutline" aria-hidden="true" />Edit</button>
          <button :disabled="busy" type="button" class="task-action complete-action" @click="$emit('complete')"><ion-icon :icon="checkmarkOutline" aria-hidden="true" />Complete</button>
        </template>
        <button :disabled="busy" type="button" class="task-action delete-action" :aria-label="`Delete ${task.title}`" title="Delete task" @click="$emit('delete')"><ion-icon :icon="trashOutline" aria-hidden="true" /></button>
      </div>
    </div>
  </article>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IonIcon } from '@ionic/vue'
import { createOutline, trashOutline, checkmarkOutline, arrowUndoOutline, linkOutline, documentAttachOutline, calendarOutline, arrowForwardOutline, repeatOutline, notificationsOutline, reorderThreeOutline, arrowUpOutline, arrowDownOutline } from 'ionicons/icons'
import type { DisplayedStudentTask, StudentTaskFile } from '@/types/studentTasks'
import { STUDENT_TASK_REMINDER_OPTIONS } from '@/types/studentTasks'
import { recurrenceLabel, taskGroupLabel } from '@/utils/studentTasks'
import { createTaskFileDownloadUrl } from '@/services/studentTasks'
import { saveStudentTaskAttachment } from '@/services/studentTaskAttachments'
import { toUserFacingErrorMessage } from '@/utils/errors'

const props = defineProps<{ item: DisplayedStudentTask; manualOrder?: boolean; canMoveUp?: boolean; canMoveDown?: boolean; busy?: boolean }>()
defineEmits<{ edit: []; delete: []; complete: []; revert: []; move: [direction: number]; drag: [event: DragEvent] }>()
const task = computed(() => props.item.task)
const groupLabel = computed(() => taskGroupLabel(task.value))
const links = computed(() => task.value.links)
const files = computed(() => task.value.files)
const displayStatus = computed(() => props.item.status === 'overdue' ? 'Missed' : props.item.status === 'completed' ? 'Completed' : 'Pending')
const downloadingFile = ref<string | null>(null)
const downloadMessage = ref('')
const downloadError = ref('')
const imageUrl = ref('')
const arrowUpRight = arrowForwardOutline
const reminderLabel = computed(() => STUDENT_TASK_REMINDER_OPTIONS.filter(option => task.value.reminder_minutes.includes(option.value)).map(option => option.label).join(', ') + ' before due')
const formattedDue = computed(() => new Date(props.item.due_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))
watch(() => task.value.files.find(file => file.mime_type?.startsWith('image/'))?.storage_path, async (path, _previous, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  imageUrl.value = ''
  if (!path) return
  try { const url = await createTaskFileDownloadUrl(path); if (current) imageUrl.value = url } catch { /* Attachment button remains available if preview expires. */ }
}, { immediate: true })
function safeLink(value: string) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined } catch { return undefined }
}
async function downloadAttachment(file: StudentTaskFile) {
  if (downloadingFile.value) return
  downloadingFile.value = file.id
  downloadError.value = ''; downloadMessage.value = ''
  try {
    const result = await saveStudentTaskAttachment(file)
    downloadMessage.value = result === 'saved' ? 'Attachment saved.' : result === 'canceled' ? 'Save canceled.' : 'Your download has started.'
  } catch (error) {
    downloadError.value = toUserFacingErrorMessage(error, 'The attachment could not be saved.')
  } finally { downloadingFile.value = null }
}
</script>
<style scoped>
.task-tile { display: flex; flex-direction: column; min-width: 0; overflow: hidden; border: 1px solid var(--campus-border); border-radius: 18px; background: var(--campus-surface); box-shadow: var(--campus-shadow); }
.task-thumb { height: 170px; padding: 8px 8px 0; }
.task-thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 12px; }
.task-body { display: flex; flex-direction: column; flex: 1; padding: 21px; }
.badge-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
.priority-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; text-transform: capitalize; color: var(--campus-muted); }
.priority-badge > span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.priority-badge.high { color: var(--campus-danger); }
.priority-badge.medium { color: var(--campus-warning); }
.status-badge { padding: 5px 8px; border-radius: 7px; color: var(--campus-warning); background: var(--campus-warning-soft); font-size: 10px; font-weight: 600; }
.status-badge.missed { color: var(--campus-danger); background: var(--campus-danger-soft); }
.status-badge.completed { color: var(--ion-color-primary); background: var(--campus-green-soft); }
.task-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 15px; font-size: 10px; color: var(--campus-muted); }
.task-meta > span { display: inline-flex; align-items: center; gap: 4px; }
.category-badge { padding: 4px 7px; border-radius: 6px; background: var(--campus-green-soft); color: var(--ion-color-primary); overflow-wrap: anywhere; }
.order-controls { display: flex; align-items: center; gap: 4px; padding: 4px 0 10px; }
.order-controls button { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 8px; background: var(--campus-bg); color: var(--campus-muted); font-size: 16px; }
.order-controls .drag-handle { justify-content: flex-start; flex: 1; gap: 6px; width: auto; font-size: 11px; cursor: grab; touch-action: none; padding: 0 10px; }
.drag-handle:active { cursor: grabbing; }
.task-title { margin: 20px 0 9px; color: var(--campus-text); font-size: 17px; font-weight: 650; line-height: 1.5; letter-spacing: -.4px; overflow-wrap: anywhere; }
.task-description { margin: 0 0 20px; color: var(--campus-muted); font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.task-due { display: flex; align-items: center; gap: 7px; margin: auto 0 14px; padding-top: 8px; color: var(--campus-muted); font-size: 12px; }
.task-due ion-icon { flex-shrink: 0; font-size: 15px; }
.task-due.overdue { color: var(--campus-danger); }
.attachments { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.attachment-link { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 6px 8px; border-radius: 7px; color: var(--campus-muted); background: var(--campus-bg); font-size: 11px; text-decoration: none; border: 0; font-family: inherit; text-align: left; cursor: pointer; }
.attachment-link span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.attachment-link ion-icon { flex-shrink: 0; font-size: 13px; }
.attachment-link:hover { color: var(--ion-color-primary); }
.attachment-link:disabled { opacity: .65; cursor: wait; }
.attachment-message { margin: 0 0 16px; color: var(--campus-muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.attachment-error { color: var(--campus-danger); }
.tile-actions { display: flex; gap: 8px; padding-top: 15px; border-top: 1px solid var(--campus-border); }
.task-action { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 9px 12px; border: 1px solid var(--campus-border); border-radius: 9px; color: var(--campus-muted); background: transparent; font-size: 12px; font-weight: 600; }
.task-action:hover { background: var(--campus-surface-soft); color: var(--campus-text); }
.task-action ion-icon { font-size: 16px; }
.complete-action { border-color: transparent; color: var(--ion-color-primary); background: var(--campus-green-soft); }
.delete-action { width: 40px; padding: 9px; margin-left: auto; border-color: transparent; }
.delete-action:hover { color: var(--campus-danger); background: var(--campus-danger-soft); }
@media (max-width: 600px) { .task-body { padding: 20px; } .task-action { min-height: 44px; } }
</style>
