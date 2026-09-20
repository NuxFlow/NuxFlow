/** Escapes the 5 XML metacharacters — safe for both element text and attribute values. */
export function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * Neutralizes a literal `]]>` inside text that will be wrapped in `<![CDATA[...]]>` —
 * that sequence is the only thing a CDATA section can't contain, and an unescaped one
 * (e.g. in an admin-authored post title) silently truncates the CDATA section early,
 * letting whatever follows it be parsed as raw XML/markup by the feed reader. Splits the
 * CDATA section around it instead of trying to encode it, which is the standard technique
 * for embedding that exact sequence inside CDATA content.
 */
export function cdataSafe(s: string): string {
  return s.replace(/\]\]>/g, ']]]]><![CDATA[>')
}
