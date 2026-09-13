# Example: shop checkout, tested locally via the tunnel

Demonstrates the **localhost** half of [`testrigor-dev-loop`](../../SKILL.md): test a site running on your machine by routing testRigor's cloud browser through the `--localhost` tunnel. Target is the static checkout demo from `testsite/public` (`test-web-app/checkout/`): product list → product → checkout form → "Thank you".

Also exercises things the search example didn't: **`.yaml` test cases with labels**, **`--labels` filtering**, a **`variables.json`** consumed by a reusable rule, and **negative tests** that prove the mandatory checkout fields actually block submission.

## Layout

```
test-cases/
  checkout-happy-path.yaml          # list → View → Buy → fill form → Purchase → thank-you
  product-page-details.yaml         # product details visible
  cancel-returns-to-list.yaml       # Cancel returns to the list
  checkout-requires-all-fields.yaml # negative: a missing Expiration is blocked
  checkout-blocks-empty-form.yaml   # negative: an empty form is blocked
rules/
  fill-checkout-form.txt            # fill the form from variables.json
variables.json                      # email / card / fullName / crc / expiration
```

## Run it locally

1. Serve the app's static root (so paths match `r4d4.info`):

   ```bash
   python3 -m http.server 8421 --directory /path/to/testsite/public
   ```

2. Run testRigor through the tunnel, pointing `--url` at the local app and filtering to the `shop` label:

   ```bash
   mkdir -p .run
   testrigor test-suite run \
     --localhost --url "http://localhost:8421/test-web-app/checkout/index.html" \
     --test-cases-path "test-cases/**/*.yaml" \
     --rules-path "rules/**/*.txt" \
     --variables-path variables.json \
     --labels shop \
     --junit-report-save-path .run/report.xml
   ```

The first localhost run downloads a small tunnel binary to `~/.testrigor/trtc/`. The cloud browser reaches `http://localhost:8421/...` on your machine through the tunnel; exit code `0` and `.run/report.xml` (`failures="0"`) confirm success.

> The tests never call `open url` — they run against whatever the suite's URL (or `--url`) points at. Locally that's `--localhost --url http://localhost:8421/...`; for a deployed site, point the suite (or `--url`) there and drop `--localhost`.
