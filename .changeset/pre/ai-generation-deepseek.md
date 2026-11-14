---
"@nuxflow/app": patch
---

Generate with AI and Translate work with DeepSeek, and Publish all sets the new homepage.

- Generating pages and translating failed on DeepSeek ("Invalid json schema: invalid type: map, expected a boolean"); the answer formats now suit every provider.
- A plan or page the AI makes slightly too long is trimmed instead of failing with "The AI's answer wasn't in the expected format". When an answer is still rejected, the Worker log says why.
- Publish all on a whole-site job makes the planned home page your homepage. Your previous homepage is kept as a draft at /previous-home.
