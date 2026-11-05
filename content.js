// Google Finance: Annualized Gain
// Appends a CAGR (compound annual growth rate) next to the headline % change
// when the selected chart window is longer than one year (5Y, MAX).
//
// Formula: cagr = (1 + totalGain) ^ (1 / years) - 1
//   5Y  -> years = 5
//   MAX -> years inferred from the chart's x-axis year ticks and the line's extent
//
// Google's headline figure is price return (no dividends), so the CAGR shown
// here is a price-only CAGR as well.

(() => {
  'use strict';

  const MARK = 'gfa-annualized';
  const WINDOW_YEARS = { '5Y': 5 };          // fixed-length windows > 1 year
  const INFERRED_WINDOWS = new Set(['MAX']); // windows whose length must be inferred
  let scheduled = false;

  // ---------- number parsing ----------

  // Parse "+1,143.14%" / "−12.3%" / "+1.143,14 %" -> fraction (11.4314, -0.123, ...)
  function parsePercent(text) {
    if (!text) return null;
    let s = text.replace(/\u2212/g, '-').replace(/[^\d.,\-]/g, '');
    if (!s) return null;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      // whichever separator comes last is the decimal separator
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      // only commas: decimal if exactly one and <=2 digits follow, else thousands
      const after = s.length - lastComma - 1;
      const commaCount = (s.match(/,/g) || []).length;
      if (commaCount === 1 && after > 0 && after <= 2) s = s.replace(',', '.');
      else s = s.replace(/,/g, '');
    }
    const v = parseFloat(s);
    return Number.isFinite(v) ? v / 100 : null;
  }

  function fmtPct(frac) {
    const pct = frac * 100;
    const abs = Math.abs(pct);
    const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
    const sign = pct > 0 ? '+' : pct < 0 ? '\u2212' : '';
    return sign + abs.toFixed(digits) + '%';
  }

  // ---------- locating the headline ----------

  // Google Finance is an SPA: when you move from one quote to another, the previous
  // quote's header stays in the DOM (display:none) and keeps live-updating. A naive
  // querySelector therefore returns the stale hidden header. Everything below only
  // considers rendered elements.
  function isRendered(el) {
    return !!el && el.isConnected && el.getClientRects().length > 0;
  }

  const PCT_RE = /^[+\-\u2212]?\d[\d.,\s]*%$/;
  const LABEL_RE = /\)\s*([A-Z0-9]{1,4})$/;

  // Returns an array of { pctEl, labelEl, windowLabel } for every visible headline.
  function findHeadlines() {
    const found = [];
    const seen = new Set();

    const push = (labelEl, pctEl) => {
      if (!labelEl || !pctEl || seen.has(labelEl)) return;
      if (!isRendered(labelEl) || !isRendered(pctEl)) return;
      seen.add(labelEl);
      const m = labelEl.textContent.trim().match(/([A-Z0-9]{1,4})\s*$/);
      let windowLabel = m ? m[1] : null;
      if (!windowLabel) {
        // Nearest visible chart-tab strip, else URL.
        const tab = [...document.querySelectorAll('[aria-label="Stock chart tabs"] [aria-selected="true"]')]
          .find(isRendered);
        windowLabel = tab ? (tab.getAttribute('aria-label') || tab.textContent.trim()) : null;
      }
      if (!windowLabel) windowLabel = new URL(location.href).searchParams.get('window');
      found.push({ pctEl, labelEl, windowLabel: windowLabel ? windowLabel.toUpperCase() : null });
    };

    // Primary: Google's current markup (obfuscated but stable within a release).
    for (const box of document.querySelectorAll('div.DAicsd')) {
      push(box.querySelector('span.wBomed'), box.querySelector('span[jsname="vY9t3b"] > span'));
    }
    if (found.length) return found;

    // Fallback: structural search. The window label span looks like "(+259.89) 5Y"
    // and sits next to a span holding the % figure.
    for (const sp of document.querySelectorAll('span')) {
      if (sp.children.length > 1) continue;
      const t = sp.textContent.trim();
      if (!t.startsWith('(') || !LABEL_RE.test(t)) continue;
      let box = sp;
      for (let i = 0; i < 3 && box; i++) {
        box = box.parentElement;
        if (!box) break;
        const cand = [...box.querySelectorAll('span')].find(
          (x) => x !== sp && x.children.length === 0 && PCT_RE.test(x.textContent.trim())
        );
        if (cand) { push(sp, cand); break; }
      }
    }
    return found;
  }

  // ---------- inferring span length for MAX ----------

  function findChartLine() {
    const lines = [...document.querySelectorAll('svg path.line')].filter((p) => isRendered(p.ownerSVGElement));
    if (lines.length) return lines[0];
    // fallback: longest unfilled stroked path in any rendered svg
    let best = null, bestLen = 0;
    for (const p of document.querySelectorAll('svg path')) {
      if (p.getAttribute('fill') !== 'none' || !isRendered(p.ownerSVGElement)) continue;
      const len = (p.getAttribute('d') || '').length;
      if (len > bestLen) { best = p; bestLen = len; }
    }
    return best;
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  // Parse an x-axis tick label into a decimal year. Supports "2010", "Jan 2024", "2024 Jan".
  function tickToYear(text) {
    const t = text.trim();
    let m = t.match(/^((?:19|20)\d\d)$/);
    if (m) return +m[1];
    m = t.match(/^([A-Za-z]{3})[a-z]*\.?\s+((?:19|20)\d\d)$/);
    if (m && MONTHS[m[1].toLowerCase()] !== undefined) return +m[2] + MONTHS[m[1].toLowerCase()] / 12;
    m = t.match(/^((?:19|20)\d\d)\s+([A-Za-z]{3})/);
    if (m && MONTHS[m[2].toLowerCase()] !== undefined) return +m[1] + MONTHS[m[2].toLowerCase()] / 12;
    return null;
  }

  // Screen-space x of an SVG element's local point.
  function screenX(el, lx, ly) {
    const ctm = el.getCTM();
    if (!ctm) return null;
    return ctm.a * lx + ctm.c * ly + ctm.e;
  }

  // Returns the chart's time span in years, or null.
  function inferYearsFromChart() {
    const line = findChartLine();
    if (!line) return null;
    const svg = line.ownerSVGElement;
    if (!svg) return null;

    // Collect dated ticks: <text> whose content parses as a year or month+year.
    let ticks = [];
    const monthOnly = [];
    for (const txt of svg.querySelectorAll('text')) {
      const label = (txt.textContent || '').trim();
      const x = screenX(txt, +(txt.getAttribute('x') || 0), +(txt.getAttribute('y') || 0));
      if (x === null || !Number.isFinite(x)) continue;
      const yr = tickToYear(label);
      if (yr !== null) { ticks.push({ yr, x }); continue; }
      const mm = label.match(/^([A-Za-z]{3})[a-z]*\.?$/);
      if (mm && MONTHS[mm[1].toLowerCase()] !== undefined) monthOnly.push({ m: MONTHS[mm[1].toLowerCase()], x });
    }
    ticks.sort((a, b) => a.x - b.x);

    // Short histories (1-2 years) get month-only ticks like "Jan", "Apr", "Jul".
    // Only the spacing matters for a slope, so unwrap them into a running month count.
    if (ticks.length < 2 && monthOnly.length >= 2) {
      monthOnly.sort((a, b) => a.x - b.x);
      let acc = 0, prev = null;
      ticks = monthOnly.map((t) => {
        if (prev !== null) acc += ((t.m - prev) + 12) % 12 || 12;
        prev = t.m;
        return { yr: acc / 12, x: t.x };
      });
    }
    if (ticks.length < 2) return null;

    // Least-squares fit year = a + b*x over ticks that increase monotonically in year.
    const mono = ticks.filter((t, i) => i === 0 || t.yr > ticks[i - 1].yr);
    if (mono.length < 2) return null;
    const n = mono.length;
    const sx = mono.reduce((s, t) => s + t.x, 0), sy = mono.reduce((s, t) => s + t.yr, 0);
    const sxx = mono.reduce((s, t) => s + t.x * t.x, 0), sxy = mono.reduce((s, t) => s + t.x * t.yr, 0);
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-9) return null;
    const b = (n * sxy - sx * sy) / denom; // years per px
    if (!(b > 0)) return null;

    let total;
    try { total = line.getTotalLength(); } catch (e) { return null; }
    if (!(total > 0)) return null;
    const p0 = line.getPointAtLength(0);
    const p1 = line.getPointAtLength(total);
    const x0 = screenX(line, p0.x, p0.y);
    const x1 = screenX(line, p1.x, p1.y);
    if (x0 === null || x1 === null) return null;

    const years = (x1 - x0) * b;
    return Number.isFinite(years) && years > 0 ? years : null;
  }

  // ---------- rendering ----------

  function removeMark(labelEl) {
    const parent = labelEl.parentElement || document;
    parent.querySelectorAll('.' + MARK).forEach((n) => n.remove());
  }

  function render() {
    // Drop annotations that ended up on headers Google has since hidden.
    for (const n of document.querySelectorAll('.' + MARK)) {
      if (!isRendered(n.parentElement)) n.remove();
    }
    const heads = findHeadlines();
    for (const h of heads) {
      try { renderOne(h); } catch (e) { /* keep going for the others */ }
    }
  }

  function renderOne(h) {
    const { pctEl, labelEl, windowLabel } = h;

    let years = null, approx = false;
    if (windowLabel in WINDOW_YEARS) {
      // Google keeps the "5Y" label even when the ticker has traded for less than
      // five years (it just charts whatever history exists). The label is therefore
      // only trustworthy when the chart agrees with it.
      const nominal = WINDOW_YEARS[windowLabel];
      const inferred = inferYearsFromChart();
      if (inferred === null) {
        years = null;                       // can't verify the span; stay silent
      } else if (Math.abs(inferred - nominal) <= nominal * 0.06) {
        years = nominal;                    // chart confirms a full window
      } else if (inferred < nominal) {
        years = inferred; approx = true;    // young ticker: use real span
      } else {
        years = nominal;                    // chart reads longer than window; trust label
      }
    } else if (INFERRED_WINDOWS.has(windowLabel)) {
      years = inferYearsFromChart();
      approx = true;
    }

    // Annualizing less than a year of history is noise, not information.
    if (years === null || years < 1) {
      removeMark(labelEl);
      return;
    }

    const gain = parsePercent(pctEl.textContent);
    if (gain === null || gain <= -1) {
      removeMark(labelEl);
      return;
    }

    const cagr = Math.pow(1 + gain, 1 / years) - 1;
    const text = (approx ? '\u2248' : '') + fmtPct(cagr) + '/yr';
    const title = (approx ? 'Approx. ' : '') + 'annualized (CAGR) over ' +
      (approx ? years.toFixed(1) : years) + ' years, price return only';

    const existing = labelEl.parentElement && labelEl.parentElement.querySelector('.' + MARK);
    if (existing && existing.dataset.text === text) {
      // keep color in sync with sign
      syncColor(existing, pctEl, cagr);
      return;
    }
    if (existing) existing.remove();

    const span = document.createElement('span');
    span.className = MARK;
    span.dataset.text = text;
    span.title = title;
    span.textContent = ' \u00b7 ' + text;
    span.style.marginLeft = '2px';
    span.style.fontWeight = '500';
    span.style.whiteSpace = 'nowrap';
    syncColor(span, pctEl, cagr);
    labelEl.insertAdjacentElement('afterend', span);
  }

  function syncColor(span, pctEl, cagr) {
    // Reuse Google's own sentiment classes when present so the color follows the theme.
    const pos = pctEl.classList.contains('ougHge');
    const neg = pctEl.classList.contains('ymyBi');
    if (pos || neg) {
      span.classList.toggle('ougHge', cagr >= 0 && pos);
      span.classList.toggle('ymyBi', cagr < 0 && neg);
      if ((cagr >= 0 && !pos) || (cagr < 0 && !neg)) span.style.color = getComputedStyle(pctEl).color;
      else span.style.color = '';
    } else {
      span.style.color = getComputedStyle(pctEl).color;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      try { render(); } catch (e) { /* never break the page */ }
    }, 150);
  }

  // ---------- wiring ----------

  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      // ignore our own insertions
      if (m.target && m.target.classList && m.target.classList.contains(MARK)) continue;
      schedule();
      return;
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // SPA navigation (ticker changes, window tab clicks) re-renders the header,
  // which the observer catches; popstate covers back/forward.
  window.addEventListener('popstate', schedule);

  schedule();
})();
