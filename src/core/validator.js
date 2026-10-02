// Pass/fail checklist gating export.
import { bppForColours, bmpFileSize } from './params.js';
import { usedColours } from './quantize.js';
import { smallBlobStats } from './despeckle.js';
import { checkSeamless } from './seamless.js';
import { analyze } from './analyze.js';

/**
 * state: { indices, W, H, params, seamless (bool), analysis?, binderMask? }
 * binderMask (pixels edited by the fixer) excludes binder-caused specks from
 * the min-feature check; they are still counted in the detail text.
 * Returns { checks:[{id,label,pass,skipped,detail}], ok }.
 * Skipped checks (e.g. seamless when seamless mode is off) count as passing.
 */
export function validate(state) {
  const { indices, W, H, params, seamless = false } = state;
  const checks = [];
  const add = (id, label, pass, detail, skipped = false) => checks.push({ id, label, pass, skipped, detail });

  const used = usedColours(indices);
  const bpp = bppForColours(Math.max(used, 1));
  const target = bppForColours(params.colours);
  const limit = target ? 2 ** target : 0;
  add('colours', 'Colour count fits bpp', used >= 1 && used <= limit && bpp !== null,
    `${used} colours used, limit ${limit} (${target ?? '?'}-bpp)`);
  add('hookModule', 'Width % hook module == 0', W % params.hookModule === 0,
    `${W} % ${params.hookModule} = ${W % params.hookModule}`);
  add('hooksTile', 'Hooks % tile width == 0', params.hooks % W === 0,
    `${params.hooks} % ${W} = ${params.hooks % W}`);

  const s = checkSeamless(indices, W, H);
  add('seamlessLR', 'Seamless left/right', !seamless || s.lr,
    seamless ? `${s.lrMismatch} mismatching rows` : 'not required (seamless off)', !seamless);
  add('seamlessTB', 'Seamless top/bottom', !seamless || s.tb,
    seamless ? `${s.tbMismatch} mismatching columns` : 'not required (seamless off)', !seamless);

  const a = state.analysis || analyze(indices, W, H, { lmax: params.lmax, cyclic: seamless, countBackground: !!params.countBackground });
  add('weftFloat', `Weft float <= ${params.lmax}`, a.weft.violations === 0,
    `max ${a.weft.maxFloat}, ${a.weft.violations} violations`);
  add('warpFloat', `Warp float <= ${params.lmax}`, a.warp.violations === 0,
    `max ${a.warp.maxFloat}, ${a.warp.violations} violations`);

  const small = smallBlobStats(indices, W, H, params.minFeature, seamless, state.binderMask || null);
  add('minFeature', `Min feature >= ${params.minFeature}px`, small.total === 0,
    `${small.total} smaller blobs` + (small.binderCaused ? ` (+${small.binderCaused} binder-caused, excluded)` : ''));

  const size = bmpFileSize(target || bpp || 8, W, H);
  add('fileSize', 'File size estimate', true, `${size} bytes`);

  return { checks, ok: checks.every((c) => c.pass), fileSize: size };
}

/** Export gate: blocked if any check fails, unless explicitly overridden. */
export function canExport(report, override = false) {
  return report.ok || override === true;
}
