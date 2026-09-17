// Optional external Playwright runtime; no application dependency is added.
// PLAYWRIGHT_MODULE may point to a preinstalled Playwright package directory.
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
const reports = [];
const issues = [];
try {
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) issues.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => issues.push(`pageerror: ${error.message}`));
  // Observe the actual module Worker protocol without replacing its computation.
  await page.addInitScript(() => {
    window.presetWorkerEvidence = { requests: [], responses: [] };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => window.presetWorkerEvidence.responses.push(event.data));
      }
      postMessage(...args) {
        window.presetWorkerEvidence.requests.push(structuredClone(args[0]));
        return super.postMessage(...args);
      }
    };
  });
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    const select = page.getByRole('combobox', { name: '評価プリセット' });
    // Resolve the ID/name mapping from rendered options, not a second preset list.
    const options = await select.locator('option').evaluateAll((nodes) => nodes.map((node) => ({ id: node.value, name: node.textContent })));
    assert.equal(options.length, 3);
    const defaultId = await select.inputValue();
    for (const { id, name } of options) {
      await page.reload();
      assert.equal(await select.inputValue(), defaultId);
      await select.selectOption(id);
      await page.getByText('AIの判断', { exact: true }).click();
      await page.getByRole('button', { name: '時間制限AIに指させる', exact: true }).click();
      assert.equal(await select.isDisabled(), true);
      await page.getByText(`評価設定: ${name}`, { exact: true }).waitFor();
      assert.equal(await select.isEnabled(), true);
      const evidence = await page.evaluate(() => {
        const select = document.querySelector('#evaluation-preset');
        const details = document.querySelector('details');
        const stats = document.querySelector('[aria-labelledby="ai-search-result-title"]');
        const boxes = [select, details, stats].map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right, client: node.clientWidth, scroll: node.scrollWidth };
        });
        return { ...window.presetWorkerEvidence, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, boxes };
      });
      assert.equal(evidence.requests.length, 1);
      assert.equal(evidence.responses.length, 1);
      const request = evidence.requests[0], response = evidence.responses[0], result = response.result;
      assert.equal(request.evaluationPresetId, id);
      assert.equal(response.requestId, request.requestId);
      assert.equal(result.evaluationPresetId, id);
      assert.equal(result.selectedEvaluation, result.evaluationBreakdown.total);
      assert.deepEqual(result.evaluationBreakdown, result.iterations.at(-1).evaluationBreakdown);
      assert.deepEqual(result.principalVariation, result.iterations.at(-1).principalVariation);
      const { material, pieceSquare, kingSafety, undefendedPieceSafety, total } = result.evaluationBreakdown;
      assert.equal(total, material + pieceSquare + kingSafety + undefendedPieceSafety);
      assert.ok(evidence.documentWidth <= width, `document overflow at ${width}`);
      for (const box of evidence.boxes) {
        assert.ok(box.left >= 0 && box.right <= width + 1 && box.scroll <= box.client + 1, JSON.stringify(box));
      }
      reports.push({ width, id, result, boxes: evidence.boxes, documentWidth: evidence.documentWidth });
      await page.screenshot({ path: path.join(output, `${width}-${id}.png`), fullPage: true });
    }
    // The synchronous two-ply action and candidates also use the selection.
    for (const { id, name } of options) {
      await page.reload();
      await select.selectOption(id);
      await page.getByText('AIの判断', { exact: true }).click();
      await page.getByRole('button', { name: '2手読みAIに指させる', exact: true }).click();
      await page.getByText(`評価設定: ${name}`, { exact: true }).waitFor();
      await page.getByText('上位候補手', { exact: true }).waitFor();
    }
  }
  assert.deepEqual(issues, [], 'Browser console warnings/errors');
  console.log(JSON.stringify({ searches: reports.length, synchronousSearches: 9, issues, widths: [1440, 375, 320] }));
} finally {
  await writeFile(path.join(output, 'browser-results.json'), JSON.stringify({ reports, issues }, null, 2));
  await browser.close();
}
