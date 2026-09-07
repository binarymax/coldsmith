---
title: Moustache Filename
category: felines
date: "2020-01-02 03:04:05"
filename: "/cat/{{ page.metadata.category }}/out.html"
---

Double moustaches in a filename template are evaluated as JavaScript in a `vm`
context where `page` and `env` are available.
