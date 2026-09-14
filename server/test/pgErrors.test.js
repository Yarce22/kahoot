import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isUniqueViolation, isNoRowsReturned } from '../src/lib/pgErrors.js'

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

test('isNoRowsReturned — true for the PostgREST PGRST116 code', () => {
  assert.equal(isNoRowsReturned({ code: 'PGRST116' }), true)
})

test('isNoRowsReturned — true on a text fallback match when code is absent', () => {
  assert.equal(isNoRowsReturned({ message: 'JSON object requested, multiple (or no) rows returned' }), true)
})

test('isNoRowsReturned — false for an unrelated error', () => {
  assert.equal(isNoRowsReturned({ code: '23505', message: 'duplicate key value violates unique constraint' }), false)
})

test('isNoRowsReturned — false for null/undefined error', () => {
  assert.equal(isNoRowsReturned(null), false)
  assert.equal(isNoRowsReturned(undefined), false)
})
