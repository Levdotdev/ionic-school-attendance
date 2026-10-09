<template>
  <ion-modal :is-open="isOpen" :can-dismiss="!saving" @didDismiss="$emit('dismiss')">
    <ion-header>
      <ion-toolbar>
        <ion-title>Custom categories</ion-title>
        <ion-buttons slot="end">
          <ion-button :disabled="saving" @click="$emit('dismiss')">Done</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="category-content">
      <div class="category-shell">
        <section class="category-intro">
          <div class="category-icon"><ion-icon :icon="pricetagsOutline" /></div>
          <div>
            <h2>Categories beyond your courses</h2>
            <p>Use these for personal study, school organizations, or tasks that do not belong to a subject.</p>
          </div>
        </section>

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
          <div v-if="formMessage" class="category-error" role="alert">{{ formMessage }}</div>
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
    </ion-content>
  </ion-modal>

  <ion-alert
    :is-open="Boolean(pendingDelete)"
    header="Delete category?"
    :message="deleteMessage"
    :buttons="deleteButtons"
    @didDismiss="pendingDelete = null"
  />
</template>

<script setup lang="ts">
import {
  IonAlert,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonModal,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { pencilOutline, pricetagOutline, pricetagsOutline, trashOutline } from 'ionicons/icons'
import { computed, ref, watch } from 'vue'

import type { StudentTaskCategory } from '@/types/studentTasks'

const props = defineProps<{
  isOpen: boolean
  categories: StudentTaskCategory[]
  saving: boolean
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

const deleteMessage = computed(() => {
  const categoryName = pendingDelete.value?.name ?? 'this category'
  return `Tasks in “${categoryName}” will be kept, but they will become uncategorized.`
})

const deleteButtons = computed(() => [
  { text: 'Cancel', role: 'cancel' },
  {
    text: 'Delete',
    role: 'destructive',
    handler: () => {
      if (pendingDelete.value) emit('delete', pendingDelete.value.id)
    },
  },
])

watch(() => props.isOpen, (isOpen) => {
  if (isOpen) resetForm()
})

function resetForm() {
  name.value = ''
  color.value = '#087443'
  editingCategory.value = null
  formMessage.value = ''
}

function edit(category: StudentTaskCategory) {
  editingCategory.value = category
  name.value = category.name
  color.value = category.color
  formMessage.value = ''
}

function submit() {
  formMessage.value = ''
  const cleanName = name.value.trim()
  if (!cleanName) {
    formMessage.value = 'Enter a category name.'
    return
  }

  if (editingCategory.value) {
    emit('update', editingCategory.value.id, cleanName, color.value)
  } else {
    emit('create', cleanName, color.value)
  }
  resetForm()
}
</script>

<style scoped>
.category-content {
  --background: var(--campus-bg);
}

.category-shell {
  display: grid;
  width: min(100% - 2rem, 620px);
  gap: 1rem;
  margin: 0 auto;
  padding: 1.25rem 0 2rem;
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
    width: min(100% - 1rem, 620px);
  }
}
</style>
