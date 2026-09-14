// Refuse to build on a Node that cannot run the langium codegen.
// Without this the failure is `TypeError: Object.groupBy is not a function` thrown
// from inside a generator, after `clean` has already deleted every dist — i.e. the
// most confusing possible moment. Taking chart.chem.dev down this way on 2026-09-14
// is why this file exists.
const REQUIRED = 22;
const major = Number(process.versions.node.split('.')[0]);
if (major < REQUIRED) {
  console.error(
    `\nThis build needs Node >= ${REQUIRED} (langium codegen uses Object.groupBy).\n` +
      `You are on ${process.version}.\n\n` +
      `  nvm use            # the repo pins 22 in .nvmrc\n` +
      `  nvm install 22     # if you do not have it\n\n` +
      `Refusing to start: \`clean\` runs first, and a failed build leaves no dist at all.\n`
  );
  process.exit(1);
}
