import { ensureMigrations } from '../utils/migrations'

// Runs before every other middleware: nothing can query D1 until its schema is current.
export default defineEventHandler(ensureMigrations)
