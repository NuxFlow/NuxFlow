// Deterministic Flesch Reading Ease and Flesch-Kincaid grade for the readability card.
// These are simple formulas over sentence/word/syllable counts — having a model guess the
// number (as readability.post.ts used to) gave a different score on every click for the
// same text. The formulas are calibrated for English only, so isLikelyEnglish() gates
// them; other languages fall back to the model's estimate.

const ENGLISH_STOPWORDS = new Set(['the', 'and', 'of', 'to', 'a', 'in', 'is', 'that', 'it', 'for', 'you', 'with', 'on', 'are', 'as', 'this', 'be', 'or', 'your', 'we'])

function words(text: string): string[] {
  return text.match(/[a-z]+(?:['’][a-z]+)*/gi) ?? []
}

/** Rough English-syllable count: vowel groups, minus a silent trailing "e", at least one. */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/['’]/g, '')
  if (w.length <= 3) return 1
  const trimmed = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '').replace(/^y/, '')
  const groups = trimmed.match(/[aeiouy]+/g)
  return Math.max(1, groups?.length ?? 1)
}

export function isLikelyEnglish(text: string): boolean {
  const all = words(text)
  if (all.length < 20) return false
  const latinLetters = (text.match(/[a-z]/gi) ?? []).length
  const letters = (text.match(/\p{L}/gu) ?? []).length
  if (!letters || latinLetters / letters < 0.95) return false
  const stop = all.filter(w => ENGLISH_STOPWORDS.has(w.toLowerCase())).length
  return stop / all.length >= 0.08
}

export interface FleschScores {
  /** 0-100, higher is easier. */
  readingEase: number
  /** US school grade. */
  grade: number
  sentences: number
  words: number
}

export function fleschScores(text: string): FleschScores | null {
  const wordList = words(text)
  if (!wordList.length) return null
  const sentences = Math.max(1, text.split(/[.!?]+(?:\s|$)/).filter(s => words(s).length > 0).length)
  const syllables = wordList.reduce((sum, w) => sum + countSyllables(w), 0)
  const wordsPerSentence = wordList.length / sentences
  const syllablesPerWord = syllables / wordList.length
  const readingEase = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord
  const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59
  return {
    readingEase: Math.round(Math.min(100, Math.max(0, readingEase))),
    grade: Math.max(0, Math.round(grade * 10) / 10),
    sentences,
    words: wordList.length,
  }
}

export function gradeLabel(grade: number): string {
  if (grade >= 16) return 'Graduate'
  if (grade >= 13) return 'College'
  const g = Math.max(1, Math.round(grade))
  const suffix = g === 1 ? 'st' : g === 2 ? 'nd' : g === 3 ? 'rd' : 'th'
  return `${g}${suffix} grade`
}
