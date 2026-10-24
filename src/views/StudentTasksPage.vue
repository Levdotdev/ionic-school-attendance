<template>
  <ion-page class="tasks-page">
    <portal-header portal="Student planner" :busy="loggingOut" @logout="logout" />
    <ion-content class="tasks-content">
      <div v-if="loading" class="loading-state" role="status"><ion-spinner name="crescent" /><span>Loading your tasks…</span></div>
      <main v-else class="tasks-shell">
        <section class="task-workspace">
          <div class="overview-heading">
            <div><p class="eyebrow">Your schoolwork, organized</p><h1>Your work, in one place.</h1><p class="overview-description">Keep a clear head. Take it one task at a time.</p></div>
            <div class="heading-actions"><button class="secondary-button" type="button" @click="categoryModalOpen = true"><ion-icon :icon="pricetagsOutline" />Categories</button><button class="primary-button add-task" type="button" @click="openCreateTask"><ion-icon :icon="addOutline" />Add task</button></div>
          </div>
          <div class="summary-grid" aria-label="Task overview">
            <button v-for="summary in summaries" :key="summary.status" class="summary-card" :class="{ selected: statusFilter === summary.status }" type="button" :aria-pressed="statusFilter === summary.status" @click="statusFilter = summary.status">
              <span class="summary-icon" :class="summary.tone"><ion-icon :icon="summary.icon" /></span><span class="summary-copy"><span class="summary-label">{{ summary.label }}</span><strong>{{ summary.count }}</strong></span><span class="summary-caption">{{ summary.caption }}</span>
            </button>
          </div>
          <div v-if="reminderState.native && hasReminders" class="reminder-banner">
            <ion-icon :icon="notificationsOutline" /><div><strong>{{ reminderState.granted ? 'Device reminders are on.' : 'Give your deadlines a gentle nudge.' }}</strong><p>{{ reminderMessage || (reminderState.granted ? reminderState.deferred ? 'The nearest reminders are ready. Later dates are scheduled as you reopen the app.' : 'Upcoming task reminders are scheduled on this device.' : 'Allow notifications to receive your saved reminders on this device.') }}</p></div>
            <button v-if="!reminderState.granted" type="button" class="secondary-button" :disabled="enablingReminders" @click="enableReminders">{{ enablingReminders ? 'Enabling…' : 'Enable reminders' }}</button>
          </div>
          <section class="task-list-section" aria-labelledby="task-list-title">
            <div class="list-toolbar"><div class="list-heading"><h2 id="task-list-title">Your tasks</h2><span aria-live="polite">{{ visibleCount }} {{ visibleCount === 1 ? 'task' : 'tasks' }}</span></div><div class="view-switch" aria-label="Task view"><button type="button" :class="{ active: view === 'list' }" :aria-pressed="view === 'list'" @click="view = 'list'"><ion-icon :icon="gridOutline" />List</button><button type="button" :class="{ active: view === 'calendar' }" :aria-pressed="view === 'calendar'" @click="view = 'calendar'"><ion-icon :icon="calendarOutline" />Calendar</button></div></div>
            <div class="filter-panel">
              <label class="search-field"><ion-icon :icon="searchOutline" /><input v-model="searchQuery" type="search" aria-label="Search tasks, notes, courses, files and links" placeholder="Search tasks, notes, files, links…" /><button v-if="searchQuery" type="button" aria-label="Clear search" @click="searchQuery = ''"><ion-icon :icon="closeOutline" /></button></label>
              <div class="filter-controls">
                <label class="field"><span>Course / category</span><select v-model="groupFilter"><option value="all">All courses and categories</option><option value="ungrouped">Uncategorized</option><optgroup label="Your courses"><option v-for="course in courses" :key="course.id" :value="'course:' + course.id">{{ course.name }}{{ course.section ? ' · ' + course.section : '' }}</option></optgroup><optgroup label="Custom categories"><option v-for="category in categories" :key="category.id" :value="'category:' + category.id">{{ category.name }}</option></optgroup></select></label>
                <label class="field"><span>Priority</span><select v-model="priorityFilter"><option value="all">All priorities</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select></label>
                <label class="field"><span>Repeat</span><select v-model="repeatFilter"><option value="all">All tasks</option><option value="recurring">Recurring tasks</option><option v-for="option in STUDENT_TASK_RECURRENCE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                <label v-if="view === 'list'" class="field"><span>Sort by</span><select v-model="sortOrder"><option value="due">Due date</option><option value="priority">Priority</option><option value="manual">Your order</option><option value="newest">Newest created</option></select></label>
              </div>
              <div class="filter-bottom"><div class="status-filter" aria-label="Filter by status"><button v-for="status in statuses" :key="status.value" type="button" :class="{ active: statusFilter === status.value }" :aria-pressed="statusFilter === status.value" @click="statusFilter = status.value">{{ status.label }}</button></div><button v-if="hasFilters" class="clear-filters" type="button" @click="clearFilters">Clear filters</button></div>
            </div>
            <p v-if="pageMessage" class="form-error" role="alert">{{ pageMessage }}</p>
            <p v-if="view === 'list' && sortOrder !== 'manual' && tasks.some(task => task.recurrence !== 'none')" class="order-hint">Upcoming repeats for the next 30 days. Calendar shows repeats for any month.</p>
            <task-calendar v-if="view === 'calendar'" :tasks="matchingTasks" :selected-date="selectedDate" :now="now" @select="selectedDate = $event" />
            <div v-if="view === 'calendar'" class="selected-day-heading"><h3>{{ formatDateHeader(selectedDate) }}</h3><button class="clear-filters" type="button" @click="openCreateTask">Add a task this day</button></div>
            <template v-if="view === 'list' && sortOrder === 'manual' && manualTasks.length">
              <p class="order-hint"><ion-icon :icon="reorderThreeOutline" />{{ orderBusy ? 'Saving your order…' : 'Drag by the handle or use the arrows. Recurring schedules appear once here; Calendar shows every date.' }}</p>
              <div class="task-grid manual-grid"><div v-for="(item, index) in manualTasks" :key="item.task.id" :class="{ 'task-ghost': draggingId === item.task.id }" @dragover.prevent @drop.prevent="dropTask(item.task.id)"><task-tile :item="item" manual-order :busy="orderBusy" :can-move-up="index > 0" :can-move-down="index < manualTasks.length - 1" @drag="startDrag(item.task.id, $event)" @move="moveTask(index, $event)" @edit="openEditTask(item.task)" @complete="openConfirmation('complete', item)" @revert="openConfirmation('revert', item)" @delete="openConfirmation('delete', item)" /></div></div>
            </template>
            <template v-else>
              <div v-for="group in visibleGroups" :key="group.date" class="date-group">
                <div v-if="view === 'list'" class="date-heading"><h3>{{ group.date === 'priority' ? 'Highest priority first' : group.date === 'newest' ? 'Recently added first' : formatDateHeader(group.date) }}</h3><span>{{ group.tasks.length }}</span><div class="date-rule" /></div>
                <div class="task-grid"><task-tile v-for="item in group.tasks" :key="item.key" :item="item" :busy="actionBusy" @edit="openEditTask(item.task)" @complete="openConfirmation('complete', item)" @revert="openConfirmation('revert', item)" @delete="openConfirmation('delete', item)" /></div>
              </div>
            </template>
            <div v-if="!visibleCount && !pageMessage" class="empty-state"><span class="empty-icon"><ion-icon :icon="emptyState.icon" /></span><h3>{{ emptyState.title }}</h3><p>{{ emptyState.description }}</p><button v-if="hasFilters" class="secondary-button" type="button" @click="clearFilters">Clear filters</button><button v-else class="secondary-button" type="button" @click="openCreateTask"><ion-icon :icon="addOutline" />Add a task</button></div>
          </section>
          <p class="workspace-footer"><ion-icon :icon="leafOutline" />Small steps still move you forward.</p>
        </section>
      </main>
    </ion-content>
    <task-editor-modal :is-open="taskModalOpen" :task="editingTask" :courses="courses" :categories="categories" :saving="savingTask" :error="saveError" :default-due-at="defaultDueAt" @dismiss="closeTaskModal" @save="saveTask" @create-category="categoryModalOpen = true" />
    <category-manager-modal :is-open="categoryModalOpen" :categories="categories" :saving="savingCategory" :error="categoryError" @dismiss="categoryModalOpen = false; categoryError = ''" @create="createCategory" @update="updateCategory" @delete="deleteCategory" />
    <task-dialog :is-open="Boolean(confirmation)" :title="confirmationDetails.title" :description="confirmationDetails.description" :icon="confirmationDetails.icon" :confirm-label="confirmationDetails.label" :busy="actionBusy" :danger="confirmation?.action === 'delete'" @dismiss="closeConfirmation" @confirm="confirmAction">
      <div v-if="confirmation" class="confirmation-task"><ion-icon :icon="documentTextOutline" /><strong>{{ confirmation.item.task.title }}</strong></div>
      <label v-if="confirmation?.action === 'delete' && confirmation.item.task.recurrence !== 'none'" class="field delete-scope"><span>What would you like to remove?</span><select v-model="deleteScope" :disabled="actionBusy"><option value="date">Only this date</option><option value="future">This date and future repeats</option><option value="series">Entire task and completion history</option></select></label>
      <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
    </task-dialog>
    <ion-toast :is-open="Boolean(toastMessage)" :message="toastMessage" :duration="2400" position="bottom" @didDismiss="toastMessage = ''" />
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonIcon, IonPage, IonSpinner, IonToast, onIonViewWillEnter } from '@ionic/vue'
import { addOutline, alertCircleOutline, arrowUndoOutline, calendarOutline, checkboxOutline, checkmarkCircleOutline, closeOutline, documentTextOutline, gridOutline, leafOutline, notificationsOutline, pricetagsOutline, reorderThreeOutline, searchOutline, timeOutline, trashOutline } from 'ionicons/icons'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PortalHeader from '@/components/PortalHeader.vue'
import CategoryManagerModal from '@/components/student-tasks/CategoryManagerModal.vue'
import TaskCalendar from '@/components/student-tasks/TaskCalendar.vue'
import TaskDialog from '@/components/student-tasks/TaskDialog.vue'
import TaskEditorModal from '@/components/student-tasks/TaskEditorModal.vue'
import TaskTile from '@/components/student-tasks/TaskTile.vue'
import { useSession } from '@/composables/useSession'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'
import { completeStudentTaskOccurrence, createStudentTask, createStudentTaskCategory, deleteStudentTask, deleteStudentTaskCategory, loadStudentTaskData, reopenStudentTaskOccurrence, reorderStudentTasks, skipStudentTaskOccurrence, stopStudentTaskRepeats, updateStudentTask, updateStudentTaskCategory } from '@/services/studentTasks'
import { isNativeTaskReminders, syncStudentTaskReminders, type TaskReminderState } from '@/services/studentTaskReminders'
import type { DisplayedStudentTask, StudentCourse, StudentTask, StudentTaskCategory, StudentTaskDisplayStatus, StudentTaskPriority, StudentTaskRecurrence, StudentTaskSaveInput } from '@/types/studentTasks'
import { STUDENT_TASK_RECURRENCE_OPTIONS } from '@/types/studentTasks'
import { compareStudentTasks, expandStudentTasks, localTaskDateKey, manualStudentTaskOrder, matchesStudentTaskSearch, mergeStudentTaskOrder, startOfLocalDay, toLocalDateTimeInput } from '@/utils/studentTasks'
import { toUserFacingErrorMessage } from '@/utils/errors'

type StatusFilter = 'all' | StudentTaskDisplayStatus
type Action = 'complete' | 'revert' | 'delete'
const { initializeSession, profile, user, signOut } = useSession()
const route = useRoute()
const router = useRouter()
const loggingOut = ref(false)
const loading = ref(true), refreshing = ref(false)
const tasks = ref<StudentTask[]>([]), courses = ref<StudentCourse[]>([]), categories = ref<StudentTaskCategory[]>([])
const now = ref(new Date()), view = ref<'list' | 'calendar'>('list'), selectedDate = ref(localTaskDateKey(new Date()))
const searchQuery = ref(''), groupFilter = ref('all'), priorityFilter = ref<StudentTaskPriority | 'all'>('all')
const repeatFilter = ref<StudentTaskRecurrence | 'all' | 'recurring'>('all')
const statusFilter = ref<StatusFilter>('pending'), sortOrder = ref<'due' | 'priority' | 'newest' | 'manual'>('due')
const taskModalOpen = ref(false), categoryModalOpen = ref(false), editingTask = ref<StudentTask | null>(null), defaultDueAt = ref('')
const savingTask = ref(false), savingCategory = ref(false), orderBusy = ref(false), actionBusy = ref(false)
const confirmation = ref<{ action: Action; item: DisplayedStudentTask } | null>(null)
const deleteScope = ref<'date' | 'future' | 'series'>('date')
const draggingId = ref(''), pageMessage = ref(''), saveError = ref(''), actionError = ref(''), toastMessage = ref('')
const enablingReminders = ref(false), reminderMessage = ref('')
const categoryError = ref('')
const reminderState = ref<TaskReminderState>({ native: isNativeTaskReminders(), granted: false, scheduled: 0, deferred: 0 })
let taskLoadGeneration = 0
let appliedCourseQuery: string | null = null
function applyCourseQuery() {
  const courseId = typeof route.query.course === 'string' ? route.query.course : null
  if (courseId === appliedCourseQuery) return
  if (courseId && !courses.value.some(course => course.id === courseId)) return
  groupFilter.value = courseId ? `course:${courseId}` : 'all'
  appliedCourseQuery = courseId
}
const statuses: { value: StatusFilter; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'pending', label: 'Pending' }, { value: 'overdue', label: 'Missed' }, { value: 'completed', label: 'Completed' }]
const listTasks = computed(() => {
  const end = new Date(now.value); end.setDate(end.getDate() + 30)
  return expandStudentTasks(tasks.value, { now: now.value, windowEnd: end })
})
const workspaceTasks = computed(() => {
  if (view.value === 'list') return listTasks.value
  const start = new Date(selectedDate.value.slice(0, 7) + '-01T00:00')
  start.setDate(start.getDate() - start.getDay())
  const end = new Date(start); end.setDate(end.getDate() + 42)
  return expandStudentTasks(tasks.value, { now: now.value, windowStart: start, windowEnd: end })
})
const summaries = computed(() => [
  { status: 'pending' as const, label: 'On your list', count: listTasks.value.filter(item => item.status === 'pending').length, icon: timeOutline, tone: 'pending', caption: 'Ready when you are' },
  { status: 'overdue' as const, label: 'Needs attention', count: listTasks.value.filter(item => item.status === 'overdue').length, icon: alertCircleOutline, tone: 'missed', caption: 'A chance to catch up' },
  { status: 'completed' as const, label: 'All wrapped up', count: listTasks.value.filter(item => item.status === 'completed').length, icon: checkmarkCircleOutline, tone: 'completed', caption: 'Look how far you’ve come' },
])
const matchingTasks = computed(() => workspaceTasks.value.filter(item => {
  if (statusFilter.value !== 'all' && item.status !== statusFilter.value) return false
  if (groupFilter.value === 'ungrouped' && (item.task.class_id || item.task.category_id)) return false
  if (groupFilter.value.startsWith('course:') && item.task.class_id !== groupFilter.value.slice(7)) return false
  if (groupFilter.value.startsWith('category:') && item.task.category_id !== groupFilter.value.slice(9)) return false
  if (priorityFilter.value !== 'all' && item.task.priority !== priorityFilter.value) return false
  if (repeatFilter.value === 'recurring' && item.task.recurrence === 'none') return false
  if (repeatFilter.value !== 'all' && repeatFilter.value !== 'recurring' && item.task.recurrence !== repeatFilter.value) return false
  return matchesStudentTaskSearch(item, searchQuery.value)
}))
const filteredTasks = computed(() => view.value === 'calendar' ? matchingTasks.value.filter(item => localTaskDateKey(item.due_at) === selectedDate.value) : matchingTasks.value)
const visibleGroups = computed(() => {
  if (view.value === 'list' && sortOrder.value === 'priority') return filteredTasks.value.length ? [{ date: 'priority', tasks: [...filteredTasks.value].sort((a, b) => compareStudentTasks(a, b, 'priority')) }] : []
  if (view.value === 'list' && sortOrder.value === 'newest') return filteredTasks.value.length ? [{ date: 'newest', tasks: [...filteredTasks.value].sort((a, b) => compareStudentTasks(a, b, 'newest')) }] : []
  const groups = new Map<string, DisplayedStudentTask[]>()
  for (const item of filteredTasks.value) { const date = localTaskDateKey(item.due_at); groups.set(date, [...(groups.get(date) ?? []), item]) }
  const dates = [...groups.keys()].sort()
  if (statusFilter.value === 'completed') dates.reverse()
  return dates.map(date => ({ date, tasks: groups.get(date)!.sort((a, b) => compareStudentTasks(a, b, sortOrder.value === 'newest' ? 'newest' : 'due')) }))
})
const manualTasks = computed(() => {
  const visible = new Map<string, DisplayedStudentTask>()
  for (const item of [...filteredTasks.value].sort((a, b) => compareStudentTasks(a, b, 'due'))) if (!visible.has(item.task.id)) visible.set(item.task.id, item)
  return manualStudentTaskOrder(tasks.value).flatMap(task => visible.has(task.id) ? [visible.get(task.id)!] : [])
})
const visibleCount = computed(() => view.value === 'list' && sortOrder.value === 'manual' ? manualTasks.value.length : filteredTasks.value.length)
const hasFilters = computed(() => Boolean(searchQuery.value.trim()) || groupFilter.value !== 'all' || priorityFilter.value !== 'all' || repeatFilter.value !== 'all' || statusFilter.value !== 'all')
const hasReminders = computed(() => tasks.value.some(task => task.reminder_minutes.length))
const emptyState = computed(() => {
  if (searchQuery.value || groupFilter.value !== 'all' || priorityFilter.value !== 'all' || repeatFilter.value !== 'all') return { icon: searchOutline, title: 'No tasks match just yet.', description: 'Try another search or clear a filter to see more tasks.' }
  if (view.value === 'calendar') return { icon: calendarOutline, title: 'A little room in your day.', description: 'There are no tasks for this date with your current status filter.' }
  if (statusFilter.value === 'completed') return { icon: checkboxOutline, title: 'Your wins will live here.', description: 'Complete a task and give yourself a little credit.' }
  if (statusFilter.value === 'overdue') return { icon: checkmarkCircleOutline, title: 'Nothing to catch up on.', description: 'You’re on top of your deadlines. Keep it up.' }
  return { icon: leafOutline, title: 'A little room for your next step.', description: 'Add a task to start planning your day.' }
})
const confirmationDetails = computed(() => {
  if (confirmation.value?.action === 'delete') return { title: 'Delete this task?', description: confirmation.value.item.task.recurrence === 'none' ? 'This removes the task and its attachments permanently.' : 'Choose a single date, future repeats, or the entire task. Earlier history is kept unless you delete the entire task.', icon: trashOutline, label: 'Delete task' }
  if (confirmation.value?.action === 'revert') return { title: 'Back on your list?', description: 'Move this date back to pending. Other dates in the schedule will stay as they are.', icon: arrowUndoOutline, label: 'Move to pending' }
  return { title: 'Another task, done.', description: 'Mark this date as completed and celebrate a little progress.', icon: checkmarkCircleOutline, label: 'Mark as completed' }
})
function formatDateHeader(date: string) { return new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) }
async function logout() {
  loggingOut.value = true
  try { await signOut(); await router.replace('/login') }
  catch (error) { toastMessage.value = toUserFacingErrorMessage(error, 'Unable to sign out. Please try again.') }
  finally { loggingOut.value = false }
}
function clearFilters() { searchQuery.value = ''; groupFilter.value = 'all'; priorityFilter.value = 'all'; repeatFilter.value = 'all'; statusFilter.value = 'all' }
async function syncReminders(request = false) {
  if (!user.value) return
  try { reminderState.value = await syncStudentTaskReminders(user.value.id, tasks.value, request); reminderMessage.value = reminderState.value.granted ? '' : 'Allow notifications in device settings to receive task reminders.' }
  catch (error) { reminderMessage.value = toUserFacingErrorMessage(error, 'Device reminders could not be scheduled. Your task is still saved.') }
}
async function enableReminders() { enablingReminders.value = true; try { await syncReminders(true) } finally { enablingReminders.value = false } }
async function loadData() {
  if (!user.value || refreshing.value) return
  const studentId = user.value.id
  const generation = ++taskLoadGeneration
  refreshing.value = true; pageMessage.value = ''
  try {
    const data = await loadStudentTaskData(studentId)
    if (generation !== taskLoadGeneration || user.value?.id !== studentId || profile.value?.role !== 'student') return
    tasks.value = data.tasks; courses.value = data.courses; categories.value = data.categories; applyCourseQuery(); void syncReminders()
  }
  catch (error) { if (generation === taskLoadGeneration) pageMessage.value = toUserFacingErrorMessage(error, 'Your tasks could not be loaded. Please try again.') }
  finally { if (generation === taskLoadGeneration) refreshing.value = false }
}
function openCreateTask() { editingTask.value = null; saveError.value = ''; defaultDueAt.value = view.value === 'calendar' ? selectedDate.value + 'T17:00' : toLocalDateTimeInput(new Date(now.value.getTime() + 3_600_000)); taskModalOpen.value = true }
function openEditTask(task: StudentTask) { editingTask.value = task; saveError.value = ''; taskModalOpen.value = true }
function closeTaskModal() { if (!savingTask.value) taskModalOpen.value = false }
async function saveTask(input: StudentTaskSaveInput) {
  if (!user.value || savingTask.value) return
  savingTask.value = true; saveError.value = ''
  try { if (editingTask.value) await updateStudentTask(user.value.id, editingTask.value, input); else await createStudentTask(user.value.id, input); taskModalOpen.value = false; toastMessage.value = 'Your task was saved.'; await loadData() }
  catch (error) { saveError.value = toUserFacingErrorMessage(error, 'Your task could not be saved. Your details are still here.') }
  finally { savingTask.value = false }
}
function openConfirmation(action: Action, item: DisplayedStudentTask) { actionError.value = ''; deleteScope.value = 'date'; confirmation.value = { action, item } }
function closeConfirmation() { if (!actionBusy.value) confirmation.value = null }
async function confirmAction() {
  if (!confirmation.value || actionBusy.value) return
  const { action, item } = confirmation.value
  actionBusy.value = true; actionError.value = ''
  try {
    if (action === 'complete') await completeStudentTaskOccurrence(item.task.id, item.due_at)
    else if (action === 'revert') await reopenStudentTaskOccurrence(item.task.id, item.due_at)
    else if (item.task.recurrence === 'none' || deleteScope.value === 'series') await deleteStudentTask(item.task)
    else if (deleteScope.value === 'future') await stopStudentTaskRepeats(item.task, item.due_at)
    else await skipStudentTaskOccurrence(item.task.id, item.due_at)
    confirmation.value = null; await loadData(); toastMessage.value = action === 'complete' ? 'Task completed.' : action === 'revert' ? 'Task moved to pending.' : 'Task removed.'
  } catch (error) { actionError.value = toUserFacingErrorMessage(error, 'The task could not be updated.') }
  finally { actionBusy.value = false }
}
async function persistOrder(ids: string[]) {
  if (!user.value || orderBusy.value) return
  orderBusy.value = true
  const ordered = mergeStudentTaskOrder(manualStudentTaskOrder(tasks.value).map(task => task.id), ids)
  try { await reorderStudentTasks(user.value.id, ordered); await loadData(); toastMessage.value = 'Your task order was saved.' }
  catch (error) { pageMessage.value = toUserFacingErrorMessage(error, 'Your task order could not be saved.'); await loadData() }
  finally { orderBusy.value = false; draggingId.value = '' }
}
async function moveTask(index: number, direction: number) {
  const ids = manualTasks.value.map(item => item.task.id), next = index + direction
  if (orderBusy.value || next < 0 || next >= ids.length) return
  ;[ids[index], ids[next]] = [ids[next], ids[index]]
  await persistOrder(ids)
}
function startDrag(id: string, event: DragEvent) { draggingId.value = id; event.dataTransfer?.setData('text/plain', id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move' }
async function dropTask(target: string) {
  const ids = manualTasks.value.map(item => item.task.id), from = ids.indexOf(draggingId.value), to = ids.indexOf(target)
  if (from < 0 || to < 0 || from === to) { draggingId.value = ''; return }
  ids.splice(to, 0, ids.splice(from, 1)[0]); await persistOrder(ids)
}
async function createCategory(name: string, color: string) {
  if (!user.value) return
  savingCategory.value = true; categoryError.value = ''
  try { await createStudentTaskCategory(user.value.id, name, color); await loadData(); toastMessage.value = 'Category added.' }
  catch (error) { categoryError.value = toUserFacingErrorMessage(error, 'The category could not be added. Your details are still here.') }
  finally { savingCategory.value = false }
}
async function updateCategory(id: string, name: string, color: string) {
  savingCategory.value = true; categoryError.value = ''
  try { await updateStudentTaskCategory(id, name, color); await loadData(); toastMessage.value = 'Category updated.' }
  catch (error) { categoryError.value = toUserFacingErrorMessage(error, 'The category could not be updated. Your details are still here.') }
  finally { savingCategory.value = false }
}
async function deleteCategory(id: string) {
  savingCategory.value = true; categoryError.value = ''
  try { await deleteStudentTaskCategory(id); if (groupFilter.value === 'category:' + id) groupFilter.value = 'all'; await loadData(); toastMessage.value = 'Category deleted. Its tasks were kept.' }
  catch (error) { categoryError.value = toUserFacingErrorMessage(error, 'The category could not be deleted.') }
  finally { savingCategory.value = false }
}
function openNotificationTask() {
  if (typeof route.query.task !== 'string' || taskModalOpen.value) return
  const task = tasks.value.find(task => task.id === route.query.task)
  if (!task) return
  const due = typeof route.query.due === 'string' ? new Date(route.query.due) : null
  if (due && Number.isFinite(due.getTime())) {
    clearFilters(); view.value = 'calendar'; selectedDate.value = localTaskDateKey(due)
  } else openEditTask(task)
}
watch(() => [route.query.task, route.query.due], openNotificationTask)
watch(() => route.query.course, applyCourseQuery)
watch(() => user.value?.id, (studentId, previous) => {
  if (studentId === previous) return
  taskLoadGeneration++; refreshing.value = false; appliedCourseQuery = null
  tasks.value = []; courses.value = []; categories.value = []
  taskModalOpen.value = false; categoryModalOpen.value = false; confirmation.value = null
  editingTask.value = null; pageMessage.value = ''; saveError.value = ''; categoryError.value = ''
})
onMounted(async () => { try { await initializeSession(); if (user.value && profile.value?.role === 'student') { await loadData(); openNotificationTask() } } finally { loading.value = false } })
useRealtimeRefresh({ channel: 'student-tasks', onChange: loadData, enabled: () => profile.value?.role === 'student' && !loading.value })
onIonViewWillEnter(() => { if (!loading.value) void loadData() })
const clock = setInterval(() => { now.value = new Date(); void syncReminders() }, 60_000)
onBeforeUnmount(() => clearInterval(clock))
</script>
<style scoped>
.overview-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 30px; }
h1 { margin: 0; font-family: Georgia, serif; font-size: clamp(30px, 3.5vw, 42px); font-weight: 400; line-height: 1.2; letter-spacing: -1.5px; }
.overview-description { margin: 12px 0 0; color: var(--campus-muted); font-size: 14px; line-height: 1.7; }
.add-task { flex-shrink: 0; }
.add-task ion-icon { font-size: 20px; }
.summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin-bottom: 38px; }
.summary-card { display: grid; grid-template-columns: 44px 1fr; column-gap: 14px; align-items: center; padding: 23px; text-align: left; color: var(--campus-text); background: var(--campus-surface); border: 1px solid var(--campus-border); border-radius: 18px; box-shadow: var(--campus-shadow); }
.summary-card:hover, .summary-card.selected { border-color: var(--ion-color-primary); }
.summary-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 13px; font-size: 23px; }
.summary-icon.pending { color: var(--campus-warning); background: var(--campus-warning-soft); }
.summary-icon.missed { color: var(--ion-color-danger); background: var(--campus-danger-soft); }
.summary-icon.completed { color: var(--ion-color-primary); background: var(--campus-green-soft); }
.summary-label { display: block; font-size: 12px; color: var(--campus-muted); }
.summary-copy strong { display: block; margin-top: 4px; font-size: 28px; font-weight: 650; line-height: 1; letter-spacing: -1px; }
.summary-caption { grid-column: 1 / -1; margin-top: 18px; color: var(--campus-muted); font-size: 11px; }
.list-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 28px; }
.list-heading { display: flex; align-items: center; gap: 12px; }
.list-heading h2 { margin: 0; font-size: 21px; font-weight: 650; letter-spacing: -.6px; }
.list-heading > span { padding: 5px 9px; border-radius: 8px; background: var(--campus-surface-soft); color: var(--campus-muted); font-size: 11px; }
.view-switch { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--campus-border); border-radius: 11px; background: var(--campus-surface-soft); }
.view-switch button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 8px 13px; border: 0; border-radius: 7px; color: var(--campus-muted); background: transparent; font-size: 12px; font-weight: 600; }
.view-switch button.active { color: var(--campus-text); background: var(--campus-surface); box-shadow: 0 2px 5px rgb(30 50 36 / 6%); }
.filter-panel { display: flex; flex-direction: column; gap: 18px; padding: 20px; margin-bottom: 26px; border: 1px solid var(--campus-border); border-radius: 16px; background: var(--campus-surface); }
.search-field { display: flex; align-items: center; gap: 10px; padding: 0 13px; border: 1px solid var(--campus-border); border-radius: 10px; background: var(--campus-bg); }
.search-field > ion-icon { flex-shrink: 0; color: var(--campus-muted); font-size: 19px; }
.search-field input { min-width: 0; width: 100%; height: 46px; padding: 0; border: 0; outline: 0; background: transparent; color: var(--campus-text); font-size: 13px; }
.search-field:focus-within { border-color: var(--ion-color-primary); }
.search-field button { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 44px; padding: 0; border: 0; background: transparent; color: var(--campus-muted); font-size: 17px; }
.filter-controls { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.filter-controls .field { gap: 7px; }
.filter-controls .field > span { font-size: 10px; }
.filter-controls select { font-size: 12px; min-height: 44px; padding: 10px 11px; }
.filter-bottom { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.clear-filters { min-height: 44px; padding: 8px 5px; border: 0; background: transparent; color: var(--ion-color-primary); font-size: 11px; font-weight: 600; }
.selected-day-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 15px; }
.selected-day-heading h3 { margin: 0; font-size: 14px; color: var(--campus-text); }
.order-hint { display: flex; align-items: center; gap: 7px; margin: 0 0 16px; color: var(--campus-muted); font-size: 12px; line-height: 1.6; }
.task-ghost { opacity: .35; }
.reminder-banner { display: flex; align-items: center; gap: 16px; padding: 18px; margin-bottom: 26px; border: 1px solid var(--campus-border); border-radius: 13px; background: var(--campus-green-soft); }
.reminder-banner > ion-icon { flex-shrink: 0; font-size: 24px; color: var(--ion-color-primary); }
.reminder-banner > div { flex: 1; }
.reminder-banner strong { font-size: 12px; }
.reminder-banner p { margin: 5px 0 0; color: var(--campus-muted); font-size: 11px; line-height: 1.6; }
.reminder-banner .secondary-button { flex-shrink: 0; font-size: 11px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.status-filter { display: flex; padding: 4px; gap: 3px; border: 1px solid var(--campus-border); border-radius: 12px; background: var(--campus-surface-soft); }
.status-filter button { min-height: 38px; padding: 9px 18px; border: 0; border-radius: 8px; background: transparent; color: var(--campus-muted); font-size: 12px; font-weight: 600; }
.status-filter button.active { background: var(--campus-surface); color: var(--campus-text); box-shadow: 0 2px 5px rgb(30 50 36 / 6%); }
.date-group { margin-top: 25px; }
.date-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 15px; }
.date-heading h3 { margin: 0; font-size: 12px; font-weight: 600; color: var(--campus-muted); }
.date-heading > span { font-size: 10px; color: var(--campus-muted); }
.date-rule { flex: 1; height: 1px; margin-left: 3px; background: var(--campus-border); }
.task-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 300px; padding: 40px 24px; border: 1px dashed var(--campus-border); border-radius: 20px; text-align: center; background: var(--campus-surface); }
.empty-icon { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 20px; background: var(--campus-green-soft); color: var(--ion-color-primary); font-size: 30px; }
.empty-state h3 { margin: 20px 0 8px; font-size: 19px; letter-spacing: -.4px; }
.empty-state p { margin: 0; color: var(--campus-muted); font-size: 13px; line-height: 1.8; }
.empty-state button { margin-top: 24px; }
.workspace-footer { display: flex; align-items: center; justify-content: center; gap: 7px; margin: 40px 0 0; color: var(--campus-muted); font-size: 11px; }
.confirmation-task { display: flex; align-items: center; gap: 10px; padding: 14px; border: 1px solid var(--campus-border); border-radius: 12px; background: var(--campus-bg); font-size: 13px; line-height: 1.6; }
.confirmation-task ion-icon { flex-shrink: 0; color: var(--campus-muted); font-size: 19px; }
.confirmation-task strong { overflow-wrap: anywhere; font-weight: 600; }
.confirmation-task + .form-error { margin-top: 14px; }
@media (max-width: 950px) { .task-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) {
  .overview-heading { flex-wrap: wrap; gap: 20px; margin-bottom: 24px; }
  .overview-description { margin-top: 10px; font-size: 13px; }
  .summary-grid { gap: 8px; margin-bottom: 28px; }
  .summary-card { display: flex; flex-direction: column; align-items: flex-start; gap: 13px; padding: 14px 12px; border-radius: 14px; }
  .summary-icon { width: 34px; height: 34px; border-radius: 10px; font-size: 19px; }
  .summary-label { font-size: 10px; line-height: 1.5; }
  .summary-copy strong { font-size: 25px; margin-top: 6px; }
  .summary-caption { display: none; }
  .list-toolbar { align-items: flex-start; flex-direction: column; gap: 18px; margin-bottom: 22px; }
  .list-toolbar { flex-direction: row; align-items: center; flex-wrap: wrap; }
  .filter-panel { padding: 15px; gap: 15px; }
  .filter-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .filter-controls select, .search-field input { font-size: 16px; }
  .status-filter { width: 100%; }
  .filter-bottom { align-items: stretch; }
  .reminder-banner { flex-wrap: wrap; }
  .reminder-banner .secondary-button { width: 100%; }
  .view-switch button { min-height: 42px; padding: 8px 10px; }
  .status-filter button { flex: 1; min-height: 42px; padding: 10px 8px; }
  .task-grid { grid-template-columns: 1fr; gap: 14px; }
  .date-heading h3 { font-size: 11px; }
  .empty-state { min-height: 280px; }
}

.tasks-content { --background: var(--campus-bg); }
.tasks-shell { max-width: 1240px; margin: 0 auto; padding: 44px max(36px, var(--ion-safe-area-left, 0px)) max(60px, var(--ion-safe-area-bottom, 0px)); }
.loading-state { display: flex; min-height: 65vh; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: var(--campus-muted); }
.heading-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.primary-button, .secondary-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 12px 20px; border: 1px solid transparent; border-radius: 12px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.primary-button { background: var(--ion-color-primary); color: var(--ion-color-primary-contrast); }
.secondary-button { background: var(--campus-surface); border-color: var(--campus-border); color: var(--campus-text); }
.field { display: flex; flex-direction: column; min-width: 0; gap: 8px; }
.field span { font-weight: 600; color: var(--campus-text); font-size: 13px; }
.field select { width: 100%; min-width: 0; min-height: 46px; padding: 10px 12px; border: 1px solid var(--campus-border); border-radius: 10px; background: var(--campus-surface); color: var(--campus-text); font: inherit; }
.eyebrow { margin: 0 0 10px; color: var(--campus-muted); font-size: 11px; font-weight: 700; letter-spacing: 1.7px; text-transform: uppercase; }
.form-error { margin: 0 0 16px; padding: 12px 14px; border-radius: 12px; color: var(--campus-danger); background: var(--campus-danger-soft); font-size: 13px; line-height: 1.6; }
.delete-scope { margin-top: 20px; }
button:disabled { opacity: .55; cursor: wait; }
@media (max-width: 600px) { .tasks-shell { padding: 28px 18px max(40px, var(--ion-safe-area-bottom, 0px)); } .heading-actions { width: 100%; } }
</style>
