# Vendored: TestRigor official skills

The `testrigor-skills/` folder in this directory is vendored from
[github.com/TestRigor/skills](https://github.com/TestRigor/skills),
MIT licensed (see `testrigor-skills/LICENSE`).

It's included here so `generate.ts` can ground Claude's test-case authoring
in TestRigor's own syntax reference and CLI conventions, rather than the
model's training-data knowledge, which may be stale.

To refresh this vendored copy later:

```
rm -rf vendor/testrigor-skills
git clone --depth 1 https://github.com/TestRigor/skills.git vendor/testrigor-skills
rm -rf vendor/testrigor-skills/.git
```
