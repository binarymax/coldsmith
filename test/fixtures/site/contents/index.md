---
title: Fixture Index
date: "2001-02-03 04:05:06"
---

Every kind of link the markdown plugin has to resolve through the content tree.

- [sibling page](winter-matter.md)
- [nested page](pages/deep/note.md)
- [nested page with anchor](pages/deep/note.md#section)
- [json page](data.json)
- [absolute in tree](/data.json)
- [external](https://example.com/somewhere)
- [internal anchor](#a-heading)
- [unresolvable](does-not-exist.md)
- [static file](static.txt)

Images go through the same resolution path as links:

![a red dot](image.png)

## A heading

This text is below the `<h2>` cutoff, so `page.intro` should stop above it and
`page.hasMore` should be true.

```js
const answer = 42
```

```
no language given
```
