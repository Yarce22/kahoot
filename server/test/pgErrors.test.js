import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isUniqueViolation } from '../src/lib/pgErrors.js'

test('isUniqueViolation — true when error.code is the Postgres unique_violation code (23505)', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true)
})

test('isUniqueViolation — true on a text fallback match when code is absent', () => {
  assert.equal(isUniqueViolation({ message: 'duplicate key value violates unique constraint' }), true)
})

test('isUniqueViolation — false for an unrelated error', () => {
  assert.equal(isUniqueViolation({ code: '23503', message: 'foreign key violation' }), false)
})

test('isUniqueViolation — false for null/undefined error', () => {
  assert.equal(isUniqueViolation(null), false)
  assert.equal(isUniqueViolation(undefined), false)
})
