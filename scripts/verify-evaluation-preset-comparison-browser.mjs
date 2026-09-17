// Uses the same optional, preinstalled Playwright runtime as preset verification.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv[2] || 'http://127.0.0.1:4173/Shogi-App/';
const output = path.resolve(process.argv[3] || 'browser-evidence');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const reports = [], issues = [];
try {
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) issues.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => issues.push(`pageerror: ${error.message}`));
  await page.addInitScript(() => {
    window.comparisonEvidence = { requests: [], responses: [], terminated: 0, created: 0, active: 0, maxActive: 0 };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        const evidence = window.comparisonEvidence;
        evidence.created++; evidence.active++; evidence.maxActive = Math.max(evidence.maxActive, evidence.active);
        this.addEventListener('message', (event) => evidence.responses.push(event.data));
      }
      postMessage(...args) {
        window.comparisonEvidence.requests.push(structuredClone(args[0]));
        return super.postMessage(...args);
      }
      terminate() {
        window.comparisonEvidence.terminated++; window.comparisonEvidence.active--;
        return super.terminate();
      }
    };
  });
  const compare = page.getByRole('button', { name: '3プリセットを比較', exact: true });
  const cards = page.getByRole('region', { name: '評価プリセットの比較' }).getByRole('article');
  const boardEvidence = () => page.evaluate(() => ({
    state: { ...document.querySelector('#shogi-research-screen').dataset },
    cells: [...document.querySelectorAll('[role="gridcell"]')].map((node) => node.getAttribute('aria-label')),
    history: document.querySelector('[aria-labelledby="move-history-title"]')?.textContent,
    selectedPreset: document.querySelector('#evaluation-preset').value,
    judgment: document.querySelector('details')?.textContent,
    stats: document.querySelector('[aria-labelledby="ai-search-result-title"]')?.textContent,
  }));
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    await page.getByRole('combobox', { name: '評価プリセット' }).selectOption('material-focused');
    // Existing single-AI result must survive analysis on the resulting gote position.
    await page.getByRole('button', { name: '2手読みAIに指させる', exact: true }).click();
    const before = await boardEvidence();
    await compare.click();
    await cards.nth(2).waitFor();
    assert.deepEqual(await boardEvidence(), before);
    const evidence = await page.evaluate(() => {
      const panel = document.querySelector('[aria-labelledby="preset-comparison-title"]');
      const all = [...panel.querySelectorAll('*')];
      const boxes = [...panel.querySelectorAll('article')].map((node) => {
        const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
      const overflows = all.filter((node) => node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1).map((node) => node.tagName);
      const buttons = [...document.querySelectorAll('button')].filter((node) => {
        const r = node.getBoundingClientRect(); return r.width && r.height;
      }).map((node) => { const r = node.getBoundingClientRect(); return { text: node.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
      const overlaps = buttons.flatMap((a, i) => buttons.slice(i + 1).filter((b) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1).map((b) => [a.text, b.text]));
      return { ...window.comparisonEvidence, documentWidth: document.documentElement.scrollWidth, boxes, overflows, overlaps };
    });
    assert.equal(evidence.requests.length, 1);
    assert.equal(evidence.responses.length, 1);
    assert.equal(evidence.maxActive, 1);
    assert.equal(evidence.terminated, 1);
    const request = evidence.requests[0], response = evidence.responses[0];
    assert.equal(request.type, 'compare-evaluation-presets');
    assert.equal(request.depth, 3);
    assert.deepEqual(response.state, request.state);
    assert.equal(response.requestId, request.requestId);
    assert.equal(response.results.length, 3);
    const ids = await page.locator('#evaluation-preset option').evaluateAll((nodes) => nodes.map((node) => node.value));
    assert.deepEqual(response.results.map((result) => result.presetId), ids);
    for (const result of response.results) {
      assert.equal(result.depth, 3);
      assert.equal(result.selectedEvaluation, result.evaluationBreakdown.total);
      assert.deepEqual(result.selectedAction, result.principalVariation[0]);
    }
    assert.ok(evidence.documentWidth <= width);
    assert.deepEqual(evidence.overflows, []);
    assert.deepEqual(evidence.overlaps, []);
    if (width === 1440) assert.equal(evidence.boxes[0].top, evidence.boxes[2].top);
    else assert.ok(evidence.boxes[0].bottom <= evidence.boxes[1].top && evidence.boxes[1].bottom <= evidence.boxes[2].top);
    await page.screenshot({ path: path.join(output, `${width}-comparison.png`), fullPage: true });
    await page.getByRole('region', { name: '評価プリセットの比較' }).screenshot({ path: path.join(output, `${width}-panel.png`) });
    // Cancel in the same browser task, before a Worker reply can be delivered.
    await page.evaluate(async () => {
      [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === '3プリセットを比較').click();
      await Promise.resolve();
      [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === '比較を中止').click();
    });
    await page.getByText('比較を中止しました。', { exact: true }).waitFor();
    assert.equal(await cards.count(), 0);
    assert.deepEqual(await boardEvidence(), before);
    // Human move while comparing cancels the job and clears all result cards.
    await page.evaluate(async () => {
      [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === '3プリセットを比較').click();
      await Promise.resolve();
      document.querySelector('[data-coordinate="3三"]').click();
      await Promise.resolve();
      document.querySelector('[data-coordinate="3四"]').click();
    });
    assert.equal(await cards.count(), 0);
    assert.equal(await page.locator('#shogi-research-screen').getAttribute('data-history-count'), '2');
    await compare.click();
    await cards.nth(2).waitFor();
    const after = await page.evaluate(() => window.comparisonEvidence);
    assert.equal(after.requests.length, 4);
    assert.equal(after.responses.length, 2);
    assert.equal(after.terminated, 4);
    assert.equal(after.maxActive, 1);
    assert.equal(after.responses[1].state.history.length, 2);
    reports.push({ width, ...evidence, afterCancellation: { requests: after.requests.length, responses: after.responses.length, terminated: after.terminated } });
  }
  assert.deepEqual(issues, []);
  console.log(JSON.stringify({ widths: reports.map((r) => r.width), actualWorkerJobs: 12, issues }));
} finally {
  await writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ reports, issues }, null, 2));
  await browser.close();
}
