# Google Finance: Annualized Gain

Chrome extension (Manifest V3). On any Google Finance quote page, when the chart
window is longer than one year, it appends the **annualized** return (CAGR) after
Google's headline total return.

    +64.89% (+258.66) 5Y · +10.5%/yr
    +1,141.50% (+604.66) MAX · ≈+9.51%/yr

Hover the added figure for the span it was annualized over.

## Install (unpacked)

1. `git clone https://github.com/mylacc/google-finance-yearly` somewhere permanent
   (Chrome loads the extension from disk, so don't delete it afterwards).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the cloned folder (the one containing `manifest.json`).
5. Reload any open Google Finance tab.

To update later: `git pull`, click the reload (↻) icon on the extension's card at
`chrome://extensions`, then reload the Finance tab.

No permissions are requested beyond running on `google.com/finance/*`. No network calls, no storage.

## How it works

- The span is never taken from the label alone. It is inferred from the chart: a
  least-squares fit of the x-axis date ticks gives px/year, and the price line's
  first and last x-coordinates give the span. Typical error is a few weeks over
  decades — negligible for CAGR.
- **5Y** → if the chart confirms ~5 years, `years = 5` exactly. If the ticker is
  younger than 5 years, Google still labels the window "5Y" but only charts the
  available history; the real span is used instead and the figure gets a `≈`.
- **MAX** → always the inferred span, always `≈`.
- **Under 1 year of history** (any window) → nothing is added; annualizing a few
  months is noise.
- **1D … 1Y** → nothing is added.
- `CAGR = (1 + total)^(1/years) − 1`

## Changelog

- **1.0.2** — Fixed: tickers with less than five years of history (e.g. a 2026 IPO)
  were annualized as if the "5Y" window really covered five years. The span is now
  measured from the chart for 5Y as well; under one year nothing is shown.

- **1.0.1** — Fixed: after navigating between tickers inside Google Finance (search
  box, links), the previous ticker's header stays in the DOM hidden and keeps
  updating. v1.0.0 annotated that hidden node and left the visible one untouched,
  so the figure appeared to "not work" on the second ticker. The script now only
  considers rendered elements.
- **1.0.0** — Initial release.

## Caveats

- Google's headline figure is **price return** (dividends excluded), so the CAGR is
  price-only too. For a dividend payer this understates total return.
- Google's DOM uses obfuscated class names (`DAicsd`, `wBomed`, `vY9t3b`, …). The
  script targets those first and falls back to a structural search, but a Google
  redesign can still break it. If the figure disappears, the selectors in
  `findHeadline()` are the place to look.
- Only `www.google.com/finance` and `google.com/finance` are matched. Add other
  country domains to `manifest.json` → `matches` if you use them.
