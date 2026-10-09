<template>
  <ion-page class="tasks-page">
    <ion-header>
      <ion-toolbar class="tasks-toolbar">
        <ion-buttons slot="start">
          <ion-menu-button />
        </ion-buttons>
        <ion-title>Tasks</ion-title>
        <ion-buttons slot="end">
          <ion-button :disabled="loading" aria-label="Refresh tasks" @click="loadData">
            <ion-icon slot="icon-only" :icon="refreshOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="tasks-content" :fullscreen="true">
      <div v-if="loading" class="loading-state" role="status" aria-live="polite">
        <ion-spinner name="crescent" />
        <span>Loading your tasks...</span>
      </div>

      <main v-else class="tasks-shell">
        <section class="tasks-hero">
          <div>
            <p class="eyebrow">Student planner</p>
            <h1>Keep every school task in one place.</h1>
            <p>Organize work by your enrolled subjects or create your own categories.</p>
          </div>
          <div class="hero-actions">
            <ion-button fill="outline" @click="categoryModalOpen = true">
              <ion-icon slot="start" :icon="pricetagsOutline" />
              Categories
            </ion-button>
            <ion-button @click="openCreateTask">
              <ion-icon slot="start" :icon="addOutline" />
              New task
            </ion-button>
          </div>
        </section>

        <div v-if="pageMessage" class="page-message" role="alert">
          <ion-icon :icon="alertCircleOutline" />
          <span>{{ pageMessage }}</span>
          <ion-button fill="clear" size="small" @click="pageMessage = ''">Dismiss</ion-button>
        </div>

        <section class="summary-grid" aria-label="Task summary">
          <article class="summary-card">
            <span class="summary-icon is-open"><ion-icon :icon="listOutline" /></span>
            <div><strong>{{ pendingCount }}</strong><small>Open</small></div>
          </article>
          <article class="summary-card">
            <span class="summary-icon is-overdue"><ion-icon :icon="alertCircleOutline" /></span>
            <div><strong>{{ overdueCount }}</strong><small>Overdue</small></div>
          </article>
          <article class="summary-card">
            <span class="summary-icon is-today"><ion-icon :icon="todayOutline" /></span>
            <div><strong>{{ todayCount }}</strong><small>Due today</small></div>
          </article>
          <article class="summary-card">
            <span class="summary-icon is-done"><ion-icon :icon="checkmarkCircleOutline" /></span>
            <div><strong>{{ completedCount }}</strong><small>Completed</small></div>
          </article>
        </section>

        <section class="task-controls" aria-label="Task filters">
          <ion-searchbar
            v-model="searchQuery"
            placeholder="Search tasks, courses, links, or files"
            :debounce="120"
            show-clear-button="focus"
          />

          <div class="control-row">
            <ion-segment v-model="statusFilter" :scrollable="true" aria-label="Filter by status">
              <ion-segment-button value="all"><ion-label>All</ion-label></ion-segment-button>
              <ion-segment-button value="pending"><ion-label>Open</ion-label></ion-segment-button>
              <ion-segment-button value="overdue"><ion-label>Overdue</ion-label></ion-segment-button>
              <ion-segment-button value="completed"><ion-label>Completed</ion-label></ion-segment-button>
            </ion-segment>

            <ion-select v-model="groupFilter" label="Course / category" fill="outline" interface="popover">
              <ion-select-option value="all">All courses and categories</ion-select-option>
              <ion-select-option value="ungrouped">Uncategorized</ion-select-option>
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

            <ion-select v-model="sortOrder" label="Sort" fill="outline" interface="popover">
              <ion-select-option value="due">Due date</ion-select-option>
              <ion-select-option value="priority">Priority</ion-select-option>
              <ion-select-option value="newest">Newest created</ion-select-option>
            </ion-select>
          </div>
        </section>

        <section v-if="visibleTasks.length" class="task-list" aria-label="Tasks">
          <article
            v-for="item in visibleTasks"
            :key="item.key"
            class="task-card"
            :class="[`status-${item.status}`, `priority-${item.task.priority}`]"
          >
            <div class="priority-bar" aria-hidden="true"></div>
            <div class="task-main">
              <div class="task-heading">
                <div class="task-title-copy">
                  <div class="task-badges">
                    <span
                      class="group-chip"
                      :style="item.task.category ? { '--chip-color': item.task.category.color } : undefined"
                    >
                      <ion-icon :icon="item.task.course ? schoolOutline : pricetagOutline" />
                      {{ taskGroupLabel(item.task) }}
                    </span>
                    <span class="status-chip" :class="`is-${item.status}`">{{ taskStatusLabel(item.status) }}</span>
                    <span class="priority-chip">{{ item.task.priority }} priority</span>
                  </div>
                  <h2>{{ item.task.title }}</h2>
                </div>

                <ion-button
                  fill="clear"
                  class="more-button"
                  :id="`task-actions-${safeId(item.key)}`"
                  :aria-label="`Actions for ${item.task.title}`"
                >
                  <ion-icon slot="icon-only" :icon="ellipsisHorizontalOutline" />
                </ion-button>
                <ion-popover :trigger="`task-actions-${safeId(item.key)}`" trigger-action="click" dismiss-on-select>
                  <ion-content>
                    <ion-list lines="none">
                      <ion-item button :disabled="busyTaskKey === item.key" @click="openEditTask(item.task)">
                        <ion-icon slot="start" :icon="pencilOutline" /><ion-label>Edit series</ion-label>
                      </ion-item>
                      <ion-item button :disabled="busyTaskKey === item.key" @click="pendingDelete = item.task">
                        <ion-icon slot="start" color="danger" :icon="trashOutline" /><ion-label color="danger">Delete task</ion-label>
                      </ion-item>
                    </ion-list>
                  </ion-content>
                </ion-popover>
              </div>

              <p v-if="item.task.description" class="task-description">{{ item.task.description }}</p>

              <div class="task-meta">
                <span :class="{ 'is-overdue': item.status === 'overdue' }">
                  <ion-icon :icon="calendarOutline" />
                  {{ formatDue(item.due_at) }}
                </span>
                <span v-if="item.task.recurrence !== 'none'">
                  <ion-icon :icon="repeatOutline" /> {{ recurrenceLabel(item.task.recurrence) }}
                </span>
                <span v-if="item.task.reminder_minutes.length">
                  <ion-icon :icon="notificationsOutline" />
                  {{ item.task.reminder_minutes.length }} {{ item.task.reminder_minutes.length === 1 ? 'reminder' : 'reminders' }}
                </span>
              </div>

              <div v-if="item.task.links.length || item.task.files.length" class="resource-row">
                <a
                  v-for="link in item.task.links"
                  :key="link.id"
                  :href="link.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="resource-chip"
                >
                  <ion-icon :icon="linkOutline" /> {{ link.title }}
                </a>
                <button
                  v-for="file in item.task.files"
                  :key="file.id"
                  type="button"
                  class="resource-chip"
                  @click="openFile(file.storage_path)"
                >
                  <ion-icon :icon="documentAttachOutline" /> {{ file.file_name }}
                </button>
              </div>

              <div class="task-actions">
                <span v-if="item.completed_at" class="completed-time">
                  Completed {{ formatCompleted(item.completed_at) }}
                </span>
                <span v-else></span>

                <ion-button
                  v-if="item.status === 'completed'"
                  fill="outline"
                  size="small"
                  :disabled="busyTaskKey === item.key"
                  @click="reopen(item)"
                >
                  <ion-spinner v-if="busyTaskKey === item.key" name="crescent" />
                  <template v-else><ion-icon slot="start" :icon="arrowUndoOutline" /> Reopen</template>
                </ion-button>
                <ion-button
                  v-else
                  size="small"
                  :disabled="busyTaskKey === item.key"
                  @click="complete(item)"
                >
                  <ion-spinner v-if="busyTaskKey === item.key" name="crescent" />
                  <template v-else><ion-icon slot="start" :icon="checkmarkOutline" /> Mark complete</template>
                </ion-button>
              </div>
            </div>
          </article>
        </section>

        <section v-else class="empty-state">
          <div class="empty-icon"><ion-icon :icon="checkmarkDoneOutline" /></div>
          <h2>{{ tasks.length ? 'No tasks match these filters' : 'Your task list is ready' }}</h2>
          <p>{{ tasks.length ? 'Try a different search, status, course, or category.' : 'Create your first task and connect it directly to one of your subjects.' }}</p>
          <ion-button v-if="!tasks.length" @click="openCreateTask">
            <ion-icon slot="start" :icon="addOutline" /> Create first task
          </ion-button>
          <ion-button v-else fill="outline" @click="clearFilters">Clear filters</ion-button>
        </section>
      </main>
    </ion-content>

    <task-editor-modal
      :is-open="taskModalOpen"
      :task="editingTask"
      :courses="courses"
      :categories="categories"
      :saving="savingTask"
      @dismiss="closeTaskModal"
      @save="saveTask"
    />

    <category-manager-modal
      :is-open="categoryModalOpen"
      :categories="categories"
      :saving="savingCategory"
      @dismiss="categoryModalOpen = false"
      @create="createCategory"
      @update="updateCategory"
      @delete="deleteCategory"
    />

    <ion-alert
      :is-open="Boolean(pendingDelete)"
      header="Delete this task?"
      :message="deleteMessage"
      :buttons="deleteButtons"
      @didDismiss="pendingDelete = null"
    />

    <ion-toast
      :is-open="Boolean(toastMessage)"
      :message="toastMessage"
      :color="toastColor"
      :duration="2200"
      position="bottom"
      @didDismiss="toastMessage = ''"
    />
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonAlert,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonPage,
  IonPopover,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToast,
  IonToolbar,
} from '@ionic/vue'
import {
  addOutline,
  alertCircleOutline,
  arrowUndoOutline,
  calendarOutline,
  checkmarkCircleOutline,
  checkmarkDoneOutline,
  checkmarkOutline,
  documentAttachOutline,
  ellipsisHorizontalOutline,
  linkOutline,
  listOutline,
  notificationsOutline,
  pencilOutline,
  pricetagOutline,
  pricetagsOutline,
  refreshOutline,
  repeatOutline,
  schoolOutline,
  todayOutline,
  trashOutline,
} from 'ionicons/icons'
import { computed, onMounted, ref } from 'vue'

import CategoryManagerModal from '@/components/student-tasks/CategoryManagerModal.vue'
import TaskEditorModal from '@/components/student-tasks/TaskEditorModal.vue'
import { useSession } from '@/composables/useSession'
import {
  completeStudentTaskOccurrence,
  createStudentTask,
  createStudentTaskCategory,
  createTaskFileDownloadUrl,
  deleteStudentTask,
  deleteStudentTaskCategory,
  loadStudentTaskData,
  reopenStudentTaskOccurrence,
  updateStudentTask,
  updateStudentTaskCategory,
} from '@/services/studentTasks'
import type {
  DisplayedStudentTask,
  StudentCourse,
  StudentTask,
  StudentTaskCategory,
  StudentTaskDisplayStatus,
  StudentTaskSaveInput,
} from '@/types/studentTasks'
import { toUserFacingErrorMessage } from '@/utils/errors'
import {
  compareStudentTasks,
  endOfLocalDay,
  expandStudentTasks,
  matchesStudentTaskSearch,
  recurrenceLabel,
  startOfLocalDay,
  taskGroupLabel,
  taskStatusLabel,
} from '@/utils/studentTasks'

type StatusFilter = 'all' | StudentTaskDisplayStatus
type TaskSort = 'due' | 'priority' | 'newest'

const { initializeSession, profile, user } = useSession()

const loading = ref(true)
const tasks = ref<StudentTask[]>([])
const courses = ref<StudentCourse[]>([])
const categories = ref<StudentTaskCategory[]>([])
const searchQuery = ref('')
const statusFilter = ref<StatusFilter>('all')
const groupFilter = ref('all')
const sortOrder = ref<TaskSort>('due')
const taskModalOpen = ref(false)
const categoryModalOpen = ref(false)
const editingTask = ref<StudentTask | null>(null)
const savingTask = ref(false)
const savingCategory = ref(false)
const busyTaskKey = ref('')
const pendingDelete = ref<StudentTask | null>(null)
const pageMessage = ref('')
const toastMessage = ref('')
const toastColor = ref<'success' | 'danger'>('success')

const displayedTasks = computed(() => expandStudentTasks(tasks.value))
const pendingCount = computed(() => displayedTasks.value.filter((item) => item.status === 'pending').length)
const overdueCount = computed(() => displayedTasks.value.filter((item) => item.status === 'overdue').length)
const completedCount = computed(() => displayedTasks.value.filter((item) => item.status === 'completed').length)
const todayCount = computed(() => {
  const start = startOfLocalDay(new Date()).getTime()
  const end = endOfLocalDay(new Date()).getTime()
  return displayedTasks.value.filter((item) => {
    const due = new Date(item.due_at).getTime()
    return due >= start && due <= end && item.status !== 'completed'
  }).length
})

const visibleTasks = computed(() => displayedTasks.value
  .filter((item) => statusFilter.value === 'all' || item.status === statusFilter.value)
  .filter((item) => matchesGroup(item))
  .filter((item) => matchesStudentTaskSearch(item, searchQuery.value))
  .sort((left, right) => compareStudentTasks(left, right, sortOrder.value)))

const deleteMessage = computed(() => {
  const title = pendingDelete.value?.title ?? 'this task'
  return `“${title}” and all of its recurring completions, links, and attachments will be permanently deleted.`
})

const deleteButtons = computed(() => [
  { text: 'Cancel', role: 'cancel' },
  {
    text: 'Delete',
    role: 'destructive',
    handler: () => {
      if (pendingDelete.value) void confirmDeleteTask(pendingDelete.value)
    },
  },
])

function matchesGroup(item: DisplayedStudentTask): boolean {
  if (groupFilter.value === 'all') return true
  if (groupFilter.value === 'ungrouped') return !item.task.class_id && !item.task.category_id
  if (groupFilter.value.startsWith('course:')) return item.task.class_id === groupFilter.value.slice(7)
  if (groupFilter.value.startsWith('category:')) return item.task.category_id === groupFilter.value.slice(9)
  return true
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function notify(message: string, color: 'success' | 'danger' = 'success') {
  toastMessage.value = message
  toastColor.value = color
}

async function loadData() {
  if (!user.value) return
  pageMessage.value = ''
  try {
    const data = await loadStudentTaskData(user.value.id)
    tasks.value = data.tasks
    courses.value = data.courses
    categories.value = data.categories
  } catch (error) {
    pageMessage.value = toUserFacingErrorMessage(error, 'Unable to load your tasks.')
  }
}

function openCreateTask() {
  editingTask.value = null
  taskModalOpen.value = true
}

function openEditTask(task: StudentTask) {
  editingTask.value = task
  taskModalOpen.value = true
}

function closeTaskModal() {
  if (savingTask.value) return
  taskModalOpen.value = false
  editingTask.value = null
}

async function saveTask(input: StudentTaskSaveInput) {
  if (!user.value) return
  savingTask.value = true
  pageMessage.value = ''
  try {
    if (editingTask.value) {
      await updateStudentTask(user.value.id, editingTask.value, input)
      notify('Task updated.')
    } else {
      await createStudentTask(user.value.id, input)
      notify('Task created.')
    }
    taskModalOpen.value = false
    editingTask.value = null
    await loadData()
  } catch (error) {
    pageMessage.value = toUserFacingErrorMessage(error, 'The task could not be saved.')
    notify(pageMessage.value, 'danger')
  } finally {
    savingTask.value = false
  }
}

async function complete(item: DisplayedStudentTask) {
  busyTaskKey.value = item.key
  try {
    await completeStudentTaskOccurrence(item.task.id, item.due_at)
    await loadData()
    notify('Task marked complete.')
  } catch (error) {
    notify(toUserFacingErrorMessage(error, 'The task could not be completed.'), 'danger')
  } finally {
    busyTaskKey.value = ''
  }
}

async function reopen(item: DisplayedStudentTask) {
  busyTaskKey.value = item.key
  try {
    await reopenStudentTaskOccurrence(item.task.id, item.due_at)
    await loadData()
    notify('Task reopened.')
  } catch (error) {
    notify(toUserFacingErrorMessage(error, 'The task could not be reopened.'), 'danger')
  } finally {
    busyTaskKey.value = ''
  }
}

async function confirmDeleteTask(task: StudentTask) {
  try {
    await deleteStudentTask(task)
    pendingDelete.value = null
    await loadData()
    notify('Task deleted.')
  } catch (error) {
    notify(toUserFacingErrorMessage(error, 'The task could not be deleted.'), 'danger')
  }
}

async function createCategory(name: string, color: string) {
  if (!user.value) return
  savingCategory.value = true
  try {
    await createStudentTaskCategory(user.value.id, name, color)
    await loadData()
    notify('Category added.')
  } catch (error) {
    notify(toUserFacingErrorMessage(error, 'The category could not be added.'), 'danger')
  } finally {
    savingCategory.value = false
  }
}

async function updateCategory(categoryId: string, name: string, color: string) {
  savingCategory.value = true
  try {
    await updateStudentTaskCategory(categoryId, name, color)
    await loadData()
    notify('Category updated.')
  } catch (error) {
    notify(toUserFacingErrorMessage(error, 'The category could not be updated.'), 'danger')
  } finally {
    savingCategory.value = false
  }
}

async function deleteCategory(categoryId: string) {
  savingCategory.value = true
  try {
    await deleteStudentTaskCategory(categoryId)
    if (groupFilter.value === `category:${categoryId}`) groupFilter.value = 'all'
    await loadData()
    notify('Category deleted. Its tasks were kept.')
  } catch (error) {
    notify(toUserFacingErrorMessage(error, 'The category could not be deleted.'), 'danger')
  } finally {
    savingCategory.value = false
  }
}

async function openFile(path: string) {
  try {
    const url = await createTaskFileDownloadUrl(path)
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch (error) {
    notify(toUserFacingErrorMessage(error, 'The attachment could not be opened.'), 'danger')
  }
}

function clearFilters() {
  searchQuery.value = ''
  statusFilter.value = 'all'
  groupFilter.value = 'all'
  sortOrder.value = 'due'
}

function formatDue(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatCompleted(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

onMounted(async () => {
  try {
    await initializeSession()
    if (!user.value || profile.value?.role !== 'student') return
    await loadData()
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.tasks-page {
  --tasks-green: var(--ion-color-primary);
}

.tasks-toolbar {
  --background: var(--campus-surface);
  --border-color: var(--campus-border);
  --color: var(--campus-text);
  --min-height: 64px;
}

.tasks-content {
  --background: var(--campus-bg);
}

.tasks-shell {
  width: min(1180px, calc(100% - 2rem));
  margin: 0 auto;
  padding: clamp(1.25rem, 3vw, 2.25rem) 0 4rem;
}

.loading-state {
  display: grid;
  min-height: 70vh;
  place-items: center;
  align-content: center;
  gap: 0.75rem;
  color: var(--campus-muted);
  font-size: 0.85rem;
}

.loading-state ion-spinner {
  width: 2rem;
  height: 2rem;
}

.tasks-hero {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
}

.eyebrow {
  margin: 0 0 0.35rem;
  color: var(--campus-muted);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.tasks-hero h1 {
  margin: 0;
  color: var(--campus-text);
  font-size: clamp(1.65rem, 4vw, 2.5rem);
  letter-spacing: -0.035em;
  line-height: 1.1;
}

.tasks-hero p:not(.eyebrow) {
  margin: 0.65rem 0 0;
  color: var(--campus-muted);
  font-size: 0.9rem;
}

.hero-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 0.6rem;
}

.page-message {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 1rem;
  padding: 0.7rem 0.8rem;
  border-radius: 11px;
  background: var(--campus-danger-soft);
  color: var(--campus-danger);
  font-size: 0.8rem;
}

.page-message span {
  flex: 1;
}

.page-message ion-button {
  min-height: 32px;
  margin: 0;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.8rem;
  margin-bottom: 1rem;
}

.summary-card {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.85rem;
  border: 1px solid var(--campus-border);
  border-radius: var(--campus-radius-sm);
  background: var(--campus-surface);
}

.summary-icon {
  display: grid;
  width: 2.45rem;
  height: 2.45rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 0.75rem;
  background: var(--campus-green-soft);
  color: var(--campus-success);
  font-size: 1.1rem;
}

.summary-icon.is-overdue {
  background: var(--campus-danger-soft);
  color: var(--campus-danger);
}

.summary-icon.is-today {
  background: var(--campus-gold-soft);
  color: var(--campus-gold-strong);
}

.summary-icon.is-done {
  background: var(--campus-surface-soft);
  color: var(--campus-muted);
}

.summary-card strong,
.summary-card small {
  display: block;
}

.summary-card strong {
  color: var(--campus-text);
  font-size: 1.25rem;
}

.summary-card small {
  margin-top: 0.12rem;
  color: var(--campus-muted);
  font-size: 0.7rem;
}

.task-controls {
  margin-bottom: 1rem;
  padding: 0.7rem;
  border: 1px solid var(--campus-border);
  border-radius: var(--campus-radius-sm);
  background: var(--campus-surface);
}

.task-controls ion-searchbar {
  --background: var(--campus-surface-soft);
  --border-radius: 11px;
  --box-shadow: none;
  --color: var(--campus-text);
  --placeholder-color: var(--campus-muted);
  padding: 0 0 0.65rem;
}

.control-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(190px, 0.8fr) minmax(140px, 0.45fr);
  gap: 0.7rem;
}

.control-row ion-segment {
  min-width: 0;
}

.control-row ion-select {
  min-height: 48px;
}

.task-list {
  display: grid;
  gap: 0.8rem;
}

.task-card {
  position: relative;
  display: grid;
  grid-template-columns: 4px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--campus-border);
  border-radius: var(--campus-radius);
  background: var(--campus-surface);
  box-shadow: var(--campus-shadow);
}

.priority-bar {
  background: var(--campus-muted);
}

.priority-high .priority-bar {
  background: var(--campus-danger);
}

.priority-medium .priority-bar {
  background: var(--campus-gold-strong);
}

.priority-low .priority-bar {
  background: var(--campus-success);
}

.status-completed {
  opacity: 0.78;
}

.task-main {
  min-width: 0;
  padding: 1rem;
}

.task-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.task-title-copy {
  min-width: 0;
}

.task-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.group-chip,
.status-chip,
.priority-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.3rem 0.48rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--chip-color, var(--ion-color-primary)) 13%, transparent);
  color: var(--chip-color, var(--ion-color-primary));
  font-size: 0.67rem;
  font-weight: 750;
}

.status-chip,
.priority-chip {
  background: var(--campus-surface-soft);
  color: var(--campus-muted);
  text-transform: capitalize;
}

.status-chip.is-overdue {
  background: var(--campus-danger-soft);
  color: var(--campus-danger);
}

.status-chip.is-completed {
  background: var(--campus-green-soft);
  color: var(--campus-success);
}

.task-heading h2 {
  margin: 0.55rem 0 0;
  overflow-wrap: anywhere;
  color: var(--campus-text);
  font-size: 1.05rem;
  letter-spacing: -0.015em;
}

.status-completed .task-heading h2 {
  text-decoration: line-through;
}

.more-button {
  min-height: 36px;
  margin: -0.35rem -0.4rem 0 0;
  color: var(--campus-muted);
}

.task-description {
  display: -webkit-box;
  margin: 0.55rem 0 0;
  overflow: hidden;
  color: var(--campus-muted);
  font-size: 0.8rem;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 1rem;
  margin-top: 0.75rem;
}

.task-meta span {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--campus-muted);
  font-size: 0.73rem;
}

.task-meta .is-overdue {
  color: var(--campus-danger);
  font-weight: 700;
}

.resource-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.75rem;
}

.resource-chip {
  display: inline-flex;
  max-width: 240px;
  align-items: center;
  gap: 0.3rem;
  padding: 0.38rem 0.52rem;
  overflow: hidden;
  border: 1px solid var(--campus-border);
  border-radius: 8px;
  background: transparent;
  color: var(--ion-color-primary);
  font: inherit;
  font-size: 0.7rem;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.task-actions {
  display: flex;
  min-height: 42px;
  align-items: end;
  justify-content: space-between;
  gap: 0.8rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--campus-border);
}

.task-actions ion-button {
  min-height: 36px;
  margin: 0;
}

.completed-time {
  color: var(--campus-success);
  font-size: 0.7rem;
}

.empty-state {
  display: grid;
  max-width: 480px;
  justify-items: center;
  gap: 0.55rem;
  margin: 0 auto;
  padding: clamp(3rem, 10vw, 6rem) 1rem;
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 4.4rem;
  height: 4.4rem;
  margin-bottom: 0.45rem;
  place-items: center;
  border-radius: 1.35rem;
  background: var(--campus-green-soft);
  color: var(--campus-success);
  font-size: 2rem;
}

.empty-state h2 {
  margin: 0;
  color: var(--campus-text);
  font-size: 1.15rem;
}

.empty-state p {
  margin: 0 0 0.45rem;
  color: var(--campus-muted);
  font-size: 0.82rem;
  line-height: 1.55;
}

@media (max-width: 900px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .control-row {
    grid-template-columns: 1fr 1fr;
  }

  .control-row ion-segment {
    grid-column: 1 / -1;
  }
}

@media (max-width: 620px) {
  .tasks-shell {
    width: min(100% - 1rem, 1180px);
    padding-top: 1rem;
  }

  .tasks-hero {
    display: grid;
  }

  .hero-actions,
  .hero-actions ion-button {
    width: 100%;
  }

  .control-row {
    grid-template-columns: 1fr;
  }

  .control-row ion-segment {
    grid-column: auto;
  }

  .task-main {
    padding: 0.85rem;
  }

  .task-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .task-actions ion-button {
    width: 100%;
  }
}
</style>
