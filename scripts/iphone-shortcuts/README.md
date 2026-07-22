# iPhone Shortcuts generator

Generates the three Apple Shortcuts from `docs/iphone-examples.md`:

- `Log Creatine`
- `AI'a Sor`
- `Sabah Brief`

The committed source uses `__PHONE_GATEWAY_SECRET__` as a placeholder. Do not
commit generated `.plist` or `.shortcut` files containing the real
`x-phone-secret`.

## Generate locally

```bash
PHONE_GATEWAY_SECRET='replace-with-real-secret' \
  node scripts/iphone-shortcuts/generate.mjs --sign --open
```

By default, files are written outside the repo:

```text
/private/tmp/lascis-board-shortcuts
```

Useful flags:

- `--out-dir <path>`: write generated files somewhere else.
- `--sign`: run `shortcuts sign` for every generated plist.
- `--open`: open signed `.shortcut` files for import. Requires `--sign`.
- `--allow-placeholder`: permit placeholder generation for structure review.

The generator writes unsigned old-format Shortcut plists as
`.unsigned.shortcut` files because `shortcuts sign` validates the input extension.
The signed importable files use `.shortcut`.

The generator checks for `openssl`, `shortcuts`, and `open` before using the
features that need them.
