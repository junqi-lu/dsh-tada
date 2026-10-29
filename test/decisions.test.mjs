import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TEXT,
  decideApprovalNotification,
  decideGoalNotification,
  decideQuestionNotification,
  decideSubagentEndNotification,
  decideTurnNotification,
  decideWorkflowEndNotification,
  normalizeConfig,
} from '../index.js'
import { childSession, rootSession, zh } from './helpers.mjs'

/* ------------------------------------------------------------------ */
/* Notification decisions                                              */
/* ------------------------------------------------------------------ */

test('turn decisions cover completion, preview, subagent filtering, and toggles', () => {
  const config = normalizeConfig()
  assert.deepEqual(decideTurnNotification(rootSession, { kind: 'completed' }, 'All done', config, zh), {
    kind: 'turn-end',
    title: 'DSH · 任务完成',
    body: 'All done',
    fields: { app: 'DSH', event: '任务完成', session: '', workspace: '', detail: 'All done' },
  })
  assert.equal(decideTurnNotification(rootSession, { kind: 'completed' }, '', config, zh).body, '本轮对话已处理完毕')
  assert.equal(decideTurnNotification(childSession, { kind: 'completed' }, 'x', config, zh), null)
  assert.ok(decideTurnNotification(childSession, { kind: 'completed' }, 'x', normalizeConfig({ notifySubagentSessions: true }), zh))
  assert.equal(decideTurnNotification(rootSession, { kind: 'completed' }, 'x', normalizeConfig({ notifyOnTurnEnd: false }), zh), null)
  assert.equal(decideTurnNotification(rootSession, { kind: 'completed' }, 'x', normalizeConfig({ enabled: false }), zh), null)

  const failed = decideTurnNotification(rootSession, { kind: 'error', error: { message: 'rate limited' } }, '', config, zh)
  assert.equal(failed.title, 'DSH · 任务出错')
  assert.equal(failed.body, 'rate limited')
  assert.equal(decideTurnNotification(rootSession, { kind: 'error' }, '', config, zh).body, '任务执行出错')
  assert.equal(decideTurnNotification(rootSession, { kind: 'error' }, '', normalizeConfig({ notifyOnError: false }), zh), null)

  assert.equal(decideTurnNotification(rootSession, { kind: 'aborted', reason: { kind: 'user' } }, '', config, zh), null)
  assert.equal(decideTurnNotification(rootSession, { kind: 'aborted', reason: { kind: 'parent' } }, '', config, zh).title, 'DSH · 任务已中止')
  assert.equal(decideTurnNotification(rootSession, { kind: 'forked' }, '', config, zh), null)
  assert.equal(decideTurnNotification(rootSession, { kind: 'interrupted' }, '', config, zh), null)

  const english = decideTurnNotification(rootSession, { kind: 'completed' }, 'done', config, TEXT.en)
  assert.equal(english.title, 'DSH · Turn complete')

  // Session and Workspace titles become displayable label fields.
  const labeled = decideTurnNotification(rootSession, { kind: 'completed' }, 'All done', config, zh, {
    sessionTitle: '修复登录问题',
    workspaceTitle: 'dsh-tada',
  })
  assert.deepEqual(labeled.fields, {
    app: 'DSH',
    event: '任务完成',
    session: '修复登录问题',
    workspace: 'dsh-tada',
    detail: 'All done',
  })
})

test('approval decisions localize the display reason and keep the tool name', () => {
  const config = normalizeConfig()
  const request = { toolName: 'bash', displayReason: { en: 'Run a command', zh: '运行命令' }, reason: 'fallback' }
  assert.deepEqual(decideApprovalNotification(request, config, zh, 'zh'), {
    kind: 'approval',
    title: 'DSH · 等待审批',
    body: 'bash · 运行命令',
    fields: { app: 'DSH', event: '等待审批', session: '', workspace: '', detail: 'bash · 运行命令' },
  })
  assert.equal(decideApprovalNotification({ toolName: 'bash' }, config, zh, 'zh').body, 'bash · Agent 正在等待你的审批')
  assert.equal(
    decideApprovalNotification({ toolName: 'x', displayReason: { en: 'EN' } }, config, zh, 'zh').body,
    'x · EN',
  )
  assert.equal(decideApprovalNotification(request, normalizeConfig({ notifyOnApproval: false }), zh, 'zh'), null)
})

test('question decisions carry the header and question count', () => {
  const config = normalizeConfig()
  const request = { questions: [{ question: 'Continue?', header: 'Confirm' }, { question: 'Which one?' }] }
  assert.deepEqual(decideQuestionNotification(request, config, zh), {
    kind: 'question',
    title: 'DSH · 需要你的回答',
    body: 'Confirm · Continue? (+1)',
    fields: { app: 'DSH', event: '需要你的回答', session: '', workspace: '', detail: 'Confirm · Continue? (+1)' },
  })
  assert.equal(decideQuestionNotification({ questions: [] }, config, zh).body, 'Agent 正在等待你的回答')
  assert.equal(decideQuestionNotification(request, normalizeConfig({ notifyOnQuestion: false }), zh), null)
})

test('subagent, workflow and goal decisions respect their off-by-default toggles', () => {
  const config = normalizeConfig()
  const subagent = { provider: 'spawn', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'child done' }] }
  assert.equal(decideSubagentEndNotification(subagent, config, zh), null)
  assert.deepEqual(decideSubagentEndNotification(subagent, normalizeConfig({ notifyOnSubagentEnd: true }), zh), {
    kind: 'subagent-end',
    title: 'DSH · 子代理结束',
    body: 'child done',
    fields: { app: 'DSH', event: '子代理结束', session: '', workspace: '', detail: 'child done' },
  })
  assert.equal(
    decideSubagentEndNotification({ provider: 'spawn', stopReason: 'error' }, normalizeConfig({ notifyOnSubagentEnd: true }), zh).body,
    'spawn · error',
  )

  const workflow = { meta: { name: 'audit' } }
  assert.equal(decideWorkflowEndNotification(workflow, { stopReason: 'completed' }, config, zh), null)
  assert.deepEqual(
    decideWorkflowEndNotification(workflow, { stopReason: 'error', error: 'boom' }, normalizeConfig({ notifyOnWorkflowEnd: true }), zh),
    {
      kind: 'workflow-end',
      title: 'DSH · Workflow 结束',
      body: 'audit · error · boom',
      fields: { app: 'DSH', event: 'Workflow 结束', session: '', workspace: '', detail: 'audit · error · boom' },
    },
  )

  const goal = { change: { operation: 'complete', goal: { objective: 'ship it' } } }
  assert.equal(decideGoalNotification(goal, config, zh), null)
  assert.deepEqual(decideGoalNotification(goal, normalizeConfig({ notifyOnGoalComplete: true }), zh), {
    kind: 'goal-complete',
    title: 'DSH · 目标完成',
    body: 'ship it',
    fields: { app: 'DSH', event: '目标完成', session: '', workspace: '', detail: 'ship it' },
  })
  assert.equal(decideGoalNotification({ change: { operation: 'edit' } }, normalizeConfig({ notifyOnGoalComplete: true }), zh), null)
})
