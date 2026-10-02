import type { Register } from 'claude-code'

// Whole-prompt phrases: "deploy it", "ship it", "build it and deploy", "push to master and deploy"...
const DEPLOY_WHOLE = [
  /^(ok(ay)?,? )?(please )?(go ahead and )?(deploy|ship)( it| them| this| all)?( now| please)?$/,
  /^(build|commit)( it| them)?,? (and|then) (deploy|ship)( it| them)?$/,
  /^push( it)? to (master|main),? (and|then) (deploy|ship)( it)?$/,
  /^(deploy|ship)( it| them)? to (prod|production)$/,
  /^(proceed|continue|finish)(,)? (and|then) (deploy|ship)( it)?$/,
]
const MERGE_WHOLE = [/^(ok(ay)?,? )?(please )?(go ahead and )?merge( it| them| this)?( now| please)?$/]

// Longer prompts that end by asking for a deploy: "include the fix and deploy it".
const DEPLOY_TAIL = /\b(and|then)\s+(deploy|ship)(\s+(it|them|this))?(\s+to\s+(prod|production))?$/

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const FOOTER = [
  'Rules for this checklist:',
  '- Use the deploy procedure documented in this repo (CLAUDE.md, README, release rules, deploy scripts). If none is documented, stop and ask me; do not guess a target.',
  '- If a step is blocked (permission rule, missing gh auth, failing CI, GitHub Actions billing), stop and tell me the exact blocker and the one command or action I need to take.',
  '- Finish with a one-line verdict: "LIVE: vX.Y.Z" only if you verified it on the live endpoint, otherwise "NOT VERIFIED" and why.',
]

const DEPLOY_LIST = [
  'Standing ship checklist (the user typed a short deploy/ship request; run all of it):',
  '1. git status and branch: confirm what is being shipped and that no unrelated files are staged.',
  '2. Run the repo gates (tests, typecheck, lint) as documented; stop on failure.',
  '3. Bump the version and add the CHANGELOG entry, following the repo\'s release rules.',
  '4. Commit, push, open the PR (or use the existing one) and merge it.',
  '5. Deploy using the documented procedure.',
  '6. Poll CI / the deploy run to completion.',
  '7. Verify live: hit the health/version endpoint (or the served bundle) and confirm the new version is what is serving.',
  '8. Update the session note / HANDOFF if the repo keeps one.',
  ...FOOTER,
].join('\n')

const MERGE_LIST = [
  'Standing merge checklist (the user typed a short merge request; run all of it):',
  '1. Confirm the PR, its CI status and that the branch is up to date.',
  '2. Merge it. If the merge is blocked by a permission rule, do not retry around it: give me the exact `gh pr merge` command to run.',
  '3. Report the merge commit and the CI result on the base branch. Do not deploy unless I asked.',
  ...FOOTER,
].join('\n')

export const register: Register = on => {
  on('prompt.submit', ($, e, next) => {
    const text = normalize(e.text)

    let list: string | null = null
    if (DEPLOY_WHOLE.some(re => re.test(text))) list = DEPLOY_LIST
    else if (MERGE_WHOLE.some(re => re.test(text))) list = MERGE_LIST
    else if (text.length < 400 && DEPLOY_TAIL.test(text)) list = DEPLOY_LIST

    if (list === null) return next(e)

    $.ui.toast(`${$.plugin.name}: attached the ${list === MERGE_LIST ? 'merge' : 'ship'} checklist`)
    return next({ ...e, context: [...(e.context ?? []), list] })
  })
}
