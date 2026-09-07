---
title: Unquoted YAML Date
date: 2012-03-04
---

The date above is an unquoted YAML timestamp, so js-yaml parses it into a Date
before coldsmith ever sees it. Quoted dates take a different code path, and
the two must keep agreeing across a js-yaml major upgrade.
