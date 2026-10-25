<template>
 <ion-page class="policy-page"><ion-content><div v-html="policy.html"></div></ion-content></ion-page>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { IonContent, IonPage } from '@ionic/vue'
import { getPublicPolicy } from '@/content/publicPolicies.mjs'
import '@/content/publicPolicy.css'
import { initializeTheme } from '@/composables/useTheme'
initializeTheme()
const props=defineProps<{kind:'privacy'|'deletion'}>()
// Fixed, locally authored markup: no account or user input is interpolated.
const policy=computed(()=>getPublicPolicy(props.kind))
</script>
