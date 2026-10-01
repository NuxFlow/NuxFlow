import { describe, it, expect } from 'vitest'
import { countSyllables, fleschScores, gradeLabel, isLikelyEnglish } from '../../server/utils/readability'

describe('countSyllables', () => {
  it.each([
    ['cat', 1],
    ['table', 2],
    ['readability', 5],
    ['make', 1],
    ['beautiful', 3],
  ])('%s → %i', (word, expected) => {
    expect(countSyllables(word)).toBe(expected)
  })
})

describe('fleschScores', () => {
  it('scores simple text as easy and dense text as hard', () => {
    const easy = fleschScores('The cat sat on the mat. The dog ran to the park. We had fun in the sun.')!
    const hard = fleschScores('Organizational interdependencies necessitate comprehensive infrastructural reconceptualization notwithstanding considerable implementation difficulties.')!
    expect(easy.readingEase).toBeGreaterThan(80)
    expect(hard.readingEase).toBeLessThan(20)
    expect(easy.grade).toBeLessThan(hard.grade)
  })

  it('is deterministic — the same text always gets the same score', () => {
    const text = 'Our coffee is roasted every morning. We serve it hot, iced, or as cold brew.'
    expect(fleschScores(text)).toEqual(fleschScores(text))
  })

  it('returns null for text with no words', () => {
    expect(fleschScores('123 456 !!!')).toBeNull()
  })
})

describe('isLikelyEnglish', () => {
  it('accepts ordinary English prose', () => {
    expect(isLikelyEnglish('We are a small team of designers and developers. Our work is focused on the web, and we love to build things that are fast and easy to use for you.')).toBe(true)
  })

  it('rejects other languages, where the English-calibrated formula is meaningless', () => {
    expect(isLikelyEnglish('Somos un pequeño equipo de diseñadores y desarrolladores. Nuestro trabajo se centra en la web y nos encanta crear cosas rápidas y fáciles de usar.')).toBe(false)
    expect(isLikelyEnglish('私たちはデザイナーと開発者の小さなチームです。ウェブに焦点を当てています。')).toBe(false)
  })

  it('rejects text too short to score meaningfully', () => {
    expect(isLikelyEnglish('Hello there, and welcome to the site.')).toBe(false)
  })
})

describe('gradeLabel', () => {
  it.each([[1, '1st grade'], [2.4, '2nd grade'], [3, '3rd grade'], [8.2, '8th grade'], [13.5, 'College'], [17, 'Graduate']])('%d → %s', (grade, label) => {
    expect(gradeLabel(grade)).toBe(label)
  })
})
