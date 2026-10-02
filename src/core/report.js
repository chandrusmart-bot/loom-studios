// Validation report (before/after) as JSON or CSV.

export function buildReport({ params, before, after, fix = null, generatedAt = null }) {
  return {
    generatedAt,
    params: { ...params },
    before, // { summary, validation }
    after,
    fix: fix && { passes: fix.passes, binders: fix.binders, converged: fix.converged },
  };
}

export function reportToJSON(report) {
  return JSON.stringify(report, null, 2);
}

const q = (v) => `"${String(v).replace(/"/g, '""')}"`;

export function reportToCSV(report) {
  const rows = [['section', 'name', 'before', 'after']];
  const b = report.before, a = report.after;
  for (const key of Object.keys(b.summary)) rows.push(['metric', key, b.summary[key], a.summary[key]]);
  for (const c of b.validation.checks) {
    const ac = a.validation.checks.find((x) => x.id === c.id);
    rows.push(['check', c.id, c.pass ? 'PASS' : 'FAIL', ac ? (ac.pass ? 'PASS' : 'FAIL') : '']);
  }
  rows.push(['check', 'overall', b.validation.ok ? 'PASS' : 'FAIL', a.validation.ok ? 'PASS' : 'FAIL']);
  return rows.map((r) => r.map(q).join(',')).join('\n') + '\n';
}
