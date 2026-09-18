/**
 * Minimal, safe arithmetic expression evaluator for form "computed" fields. Replaces a
 * previous `Function("'use strict'; return (" + expr + ")")()` — an eval-equivalent that ran
 * a string built from a form's own sibling field values directly as JavaScript. Supports
 * only +, -, *, %, /, parentheses, and numeric literals — enough for the
 * "{{price}} * {{qty}}" class of formula these fields exist for, with no way to reach
 * anything beyond arithmetic on numbers.
 */

type TokenType = 'number' | '+' | '-' | '*' | '/' | '%' | '(' | ')'
interface Token { type: TokenType; value?: number }

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%' || ch === '(' || ch === ')') {
      tokens.push({ type: ch })
      i++
      continue
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let j = i
      let sawDot = false
      while (j < expr.length && ((expr[j]! >= '0' && expr[j]! <= '9') || (expr[j] === '.' && !sawDot))) {
        if (expr[j] === '.') sawDot = true
        j++
      }
      const numStr = expr.slice(i, j)
      const value = Number(numStr)
      if (Number.isNaN(value)) throw new Error(`Invalid number: "${numStr}"`)
      tokens.push({ type: 'number', value })
      i = j
      continue
    }
    throw new Error(`Unexpected character in expression: "${ch}"`)
  }
  return tokens
}

class ArithmeticParser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private consume(): Token {
    const token = this.tokens[this.pos]
    if (!token) throw new Error('Unexpected end of expression')
    this.pos++
    return token
  }

  parse(): number {
    const value = this.parseExpression()
    if (this.pos < this.tokens.length) throw new Error('Unexpected trailing input in expression')
    return value
  }

  private parseExpression(): number {
    let value = this.parseTerm()
    while (this.peek()?.type === '+' || this.peek()?.type === '-') {
      const op = this.consume().type
      const rhs = this.parseTerm()
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }

  private parseTerm(): number {
    let value = this.parseUnary()
    while (this.peek()?.type === '*' || this.peek()?.type === '/' || this.peek()?.type === '%') {
      const op = this.consume().type
      const rhs = this.parseUnary()
      if (op === '*') value *= rhs
      else if (op === '/') value /= rhs
      else value %= rhs
    }
    return value
  }

  private parseUnary(): number {
    if (this.peek()?.type === '-') {
      this.consume()
      return -this.parseUnary()
    }
    if (this.peek()?.type === '+') {
      this.consume()
      return this.parseUnary()
    }
    return this.parseAtom()
  }

  private parseAtom(): number {
    const token = this.consume()
    if (token.type === 'number') return token.value!
    if (token.type === '(') {
      const value = this.parseExpression()
      const closing = this.consume()
      if (closing.type !== ')') throw new Error('Expected closing parenthesis')
      return value
    }
    throw new Error('Unexpected token in expression')
  }
}

/** Throws on any malformed or non-arithmetic input — callers should catch and degrade. */
export function evaluateArithmeticExpression(expr: string): number {
  const tokens = tokenize(expr)
  if (tokens.length === 0) throw new Error('Empty expression')
  return new ArithmeticParser(tokens).parse()
}
