---
"@nuxflow/canvas": patch
"@nuxflow/app": patch
---

fix: readable block settings in dark mode, and sign-in alerts name the site

In dark mode the text in a block's rich-text box (for example a Text block's content) was dark on a dark background and couldn't be seen; the settings panel's other fields now follow dark mode too. The "new sign-in to your account" email now says which site you signed in to use, instead of only showing the platform's name.
