<template>
  <task-dialog :is-open="isOpen" title="Categories beyond your courses" description="Make room for personal study, school organizations, and everything in between." :icon="pricetagsOutline" :busy="saving" wide hide-footer @dismiss="$emit('dismiss')">
      <div class="category-shell">
        <form class="category-form" @submit.prevent="submit">
          <div class="category-fields">
            <label class="color-field">
              <span>Color</span>
              <input v-model="color" type="color" :disabled="saving" aria-label="Category color" />
            </label>
            <ion-input
              v-model="name"
              label="Category name"
              label-placement="stacked"
              fill="outline"
              :maxlength="60"
              :disabled="saving"
              placeholder="Personal study"
              required
            />
          </div>
          <div v-if="formMessage || error" class="category-error" role="alert">{{ formMessage || error }}</div>
          <div class="form-actions">
            <ion-button v-if="editingCategory" type="button" fill="clear" :disabled="saving" @click="resetForm">
              Cancel edit
            </ion-button>
            <ion-button type="submit" :disabled="saving || !name.trim()">
              <ion-spinner v-if="saving" name="crescent" />
              <template v-else>{{ editingCategory ? 'Save category' : 'Add category' }}</template>
            </ion-button>
          </div>
        </form>

        <section class="category-list" aria-label="Your custom categories">
          <article v-for="category in categories" :key="category.id" class="category-row">
            <span class="color-dot" :style="{ background: category.color }" aria-hidden="true"></span>
            <strong>{{ category.name }}</strong>
            <div class="category-actions">
              <ion-button fill="clear" :disabled="saving" :aria-label="`Edit ${category.name}`" @click="edit(category)">
                <ion-icon slot="icon-only" :icon="pencilOutline" />
              </ion-button>
              <ion-button
                fill="clear"
                color="danger"
                :disabled="saving"
                :aria-label="`Delete ${category.name}`"
                @click="pendingDelete = category"
              >
                <ion-icon slot="icon-only" :icon="trashOutline" />
              </ion-button>
            </div>
          </article>

          <div v-if="!categories.length" class="empty-categories">
            <ion-icon :icon="pricetagOutline" />
            <p>No custom categories yet.</p>
          </div>
        </section>
      </div>
    <button type="button" class="done-button" :disabled="saving" @click="$emit('dismiss')">Done</button>
  </task-dialog>
  <task-dialog :is-open="Boolean(pendingDelete)" title="Delete category?" :description="deleteMessage" :icon="trashOutline" danger confirm-label="Delete category" :busy="saving" @dismiss="pendingDelete = null" @confirm="confirmDelete"><p v-if="error" class="category-error" role="alert">{{ error }}</p></task-dialog>
</template>

<script setup lang="ts">
import { IonButton, IonIcon, IonInput, IonSpinner } from '@ionic/vue'
import { pencilOutline, pricetagOutline, pricetagsOutline, trashOutline } from 'ionicons/icons'
import { computed, ref, watch } from 'vue'
import TaskDialog from './TaskDialog.vue'

import type { StudentTaskCategory } from '@/types/studentTasks'

const props = defineProps<{
  isOpen: boolean
  categories: StudentTaskCategory[]
  saving: boolean
  error?: string
}>()

const emit = defineEmits<{
  dismiss: []
  create: [name: string, color: string]
  update: [categoryId: string, name: string, color: string]
  delete: [categoryId: string]
}>()

const name = ref('')
const color = ref('#087443')
const editingCategory = ref<StudentTaskCategory | null>(null)
const pendingDelete = ref<StudentTaskCategory | null>(null)
const formMessage = ref('')
let awaitingSave = false

const deleteMessage = computed(() => {
  const categoryName = pendingDelete.value?.name ?? 'this category'
  return `Tasks in “${categoryName}” will be kept, but they will become uncategorized.`
})

function confirmDelete() { if (pendingDelete.value && !props.saving) emit('delete', pendingDelete.value.id) }

watch(() => props.isOpen, (isOpen) => {
  if (isOpen) resetForm()
  else pendingDelete.value = null
})
watch(() => props.saving, (saving, previous) => {
  if (previous && !saving && awaitingSave) { if (!props.error) resetForm(); awaitingSave = false }
})
watch(() => props.categories, categories => {
  if (pendingDelete.value && !categories.some(category => category.id === pendingDelete.value?.id)) pendingDelete.value = null
})

function resetForm() {
  name.value = ''
  color.value = '#087443'
  editingCategory.value = null
  formMessage.value = ''
  awaitingSave = false
}

function edit(category: StudentTaskCategory) {
  editingCategory.value = category
  name.value = category.name
  color.value = category.color
  formMessage.value = ''
}

function submit() {
  if (props.saving) return
  formMessage.value = ''
  const cleanName = name.value.trim()
  if (!cleanName) {
    formMessage.value = 'Enter a category name.'
    return
  }
  if (props.categories.some(category => category.id !== editingCategory.value?.id && category.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
    formMessage.value = 'You already have a category with this name.'
    return
  }

  awaitingSave = true
  if (editingCategory.value) {
    emit('update', editingCategory.value.id, cleanName, color.value)
  } else {
    emit('create', cleanName, color.value)
  }
}
</script>

<style scoped>
.category-content {
  --background: var(--campus-bg);
}

.category-shell {
  display: grid;
  width: 100%;
  gap: 1rem;
  margin: 0 auto;
  padding: 0;
}

.category-intro,
.category-form,
.category-list {
  border: 1px solid var(--campus-border);
  border-radius: var(--campus-radius-sm);
  background: var(--campus-surface);
}

.category-intro {
  display: flex;
  gap: 0.8rem;
  padding: 1rem;
}

.category-icon {
  display: grid;
  width: 2.7rem;
  height: 2.7rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 0.8rem;
  background: var(--campus-gold-soft);
  color: var(--campus-gold-strong);
  font-size: 1.25rem;
}

.category-intro h2 {
  margin: 0;
  color: var(--campus-text);
  font-size: 1rem;
}

.category-intro p {
  margin: 0.3rem 0 0;
  color: var(--campus-muted);
  font-size: 0.78rem;
  line-height: 1.5;
}

.category-form {
  display: grid;
  gap: 0.65rem;
  padding: 1rem;
}

.category-fields {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.75rem;
  align-items: end;
}

.color-field {
  display: grid;
  gap: 0.45rem;
  color: var(--campus-text);
  font-size: 0.74rem;
  font-weight: 600;
}

.color-field input {
  width: 54px;
  height: 54px;
  padding: 4px;
  border: 1px solid var(--campus-border);
  border-radius: 12px;
  background: var(--campus-surface);
  cursor: pointer;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.category-error {
  color: var(--campus-danger);
  font-size: 0.78rem;
}

.category-list {
  overflow: hidden;
}

.category-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.65rem;
  align-items: center;
  min-height: 58px;
  padding: 0.4rem 0.55rem 0.4rem 1rem;
  border-bottom: 1px solid var(--campus-border);
}

.category-row:last-child {
  border-bottom: 0;
}

.color-dot {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
}

.category-row strong {
  overflow: hidden;
  color: var(--campus-text);
  font-size: 0.84rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-actions {
  display: flex;
}

.category-actions ion-button {
  min-height: 36px;
  margin: 0;
}

.empty-categories {
  display: grid;
  justify-items: center;
  gap: 0.4rem;
  padding: 2.5rem 1rem;
  color: var(--campus-muted);
}

.empty-categories ion-icon {
  font-size: 1.7rem;
}

.empty-categories p {
  margin: 0;
  font-size: 0.82rem;
}

@media (max-width: 520px) {
  .category-shell {
    width: 100%;
  }
}
.done-button { width: 100%; min-height: 46px; margin-top: 18px; border: 0; border-radius: 10px; color: var(--campus-muted); background: transparent; font: inherit; font-size: 13px; font-weight: 600; }
</style>
