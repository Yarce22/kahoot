<template>
  <div class="quiz-list">
    <h1>Quizzes</h1>
    <button @click="router.push('/admin/quizzes/new')">+ New Quiz</button>

    <p v-if="store.loading">Loading…</p>
    <p v-if="store.error" class="error">{{ store.error }}</p>

    <ul v-if="store.quizzes.length">
      <li v-for="quiz in store.quizzes" :key="quiz.id">
        <span>{{ quiz.title }}</span>
        <button @click="router.push(`/admin/quizzes/${quiz.id}`)">Edit</button>
        <button @click="remove(quiz.id)">Delete</button>
      </li>
    </ul>
    <p v-else-if="!store.loading">No quizzes yet.</p>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useQuizStore } from '../../stores/quiz.js'

const router = useRouter()
const store = useQuizStore()

onMounted(() => store.fetchQuizzes())

async function remove(id) {
  if (!confirm('Delete this quiz?')) return
  await store.deleteQuiz(id)
}
</script>
