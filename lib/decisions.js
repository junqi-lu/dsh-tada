/** Notification decisions (pure; exported for tests). */

import { clampText, extractText } from './text.js'

function labelText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The composable field set of one automatic notification. The display settings
 * decide which of these appear in the title and body (see lib/display.js); the
 * `detail` field always carries the notification's own text.
 */
function fieldsFor(config, event, detail, context) {
  return {
    app: config.appName,
    event,
    session: labelText(context?.sessionTitle),
    workspace: labelText(context?.workspaceTitle),
    detail,
  }
}

function titleFor(config, event) {
  return `${config.appName} · ${event}`
}

function pickLocalized(map, language) {
  if (!map || typeof map !== 'object') return ''
  const value = map[language] ?? map.en ?? ''
  return typeof value === 'string' ? value : ''
}

/**
 * Decide the alert for one `turn/end` reason, or null when that reason is
 * switched off, belongs to a subagent session, or is not user-visible.
 *
 * `context` carries the Session/Workspace titles resolved by the Host.
 */
export function decideTurnNotification(session, reason, preview, config, text, context) {
  if (!config.enabled || !reason || typeof reason.kind !== 'string') return null
  if (!config.notifySubagentSessions && session?.header?.origin === 'subagent') return null
  const previewBody = preview ? clampText(preview, config.bodyMaxLength) : ''
  const build = (kind, event, detail) => ({
    kind,
    title: titleFor(config, event),
    body: detail,
    fields: fieldsFor(config, event, detail, context),
  })
  switch (reason.kind) {
    case 'completed':
      if (!config.notifyOnTurnEnd) return null
      return build('turn-end', text.turnEnd, previewBody || text.turnEndBody)
    case 'error': {
      if (!config.notifyOnError) return null
      const detail = reason.error?.message ? clampText(reason.error.message, config.bodyMaxLength) : text.errorFallback
      return build('turn-error', text.turnError, detail)
    }
    case 'blocked':
      if (!config.notifyOnError) return null
      return build('turn-blocked', text.turnBlocked, previewBody || text.turnEndBody)
    case 'max-tokens':
      if (!config.notifyOnError) return null
      return build('turn-max-tokens', text.turnMaxTokens, previewBody || text.turnEndBody)
    case 'aborted':
      // A user-initiated abort (Esc) is expected; parents/hooks/disposal are not.
      if (!config.notifyOnError || reason.reason?.kind === 'user') return null
      return build('turn-aborted', text.turnAborted, text.turnEndBody)
    default:
      // 'interrupted' and 'forked' are not user-visible milestones.
      return null
  }
}

/** Decide the alert for a pending approval request. */
export function decideApprovalNotification(request, config, text, language, context) {
  if (!config.enabled || !config.notifyOnApproval || !request) return null
  const detail = pickLocalized(request.displayReason, language) || request.reason || ''
  const body = detail
    ? `${request.toolName} · ${clampText(detail, config.bodyMaxLength)}`
    : `${request.toolName} · ${text.approvalBody}`
  return {
    kind: 'approval',
    title: titleFor(config, text.approval),
    body,
    fields: fieldsFor(config, text.approval, body, context),
  }
}

/** Decide the alert for a pending user question. */
export function decideQuestionNotification(request, config, text, context) {
  if (!config.enabled || !config.notifyOnQuestion || !request) return null
  const questions = Array.isArray(request.questions) ? request.questions : []
  const first = questions[0]
  const question = typeof first?.question === 'string' ? first.question.trim() : ''
  const header = typeof first?.header === 'string' ? clampText(first.header.trim(), 60) : ''
  let body = question ? clampText(question, config.bodyMaxLength) : text.questionBody
  if (questions.length > 1) body = `${body} (+${questions.length - 1})`
  if (header) body = `${header} · ${body}`
  body = clampText(body, config.bodyMaxLength)
  return {
    kind: 'question',
    title: titleFor(config, text.question),
    body,
    fields: fieldsFor(config, text.question, body, context),
  }
}

/** Decide the alert for a finished subagent run. */
export function decideSubagentEndNotification(info, config, text, context) {
  if (!config.enabled || !config.notifyOnSubagentEnd || !info) return null
  const preview = extractText(info.lastAssistantMessage)
  const body = preview
    ? clampText(preview, config.bodyMaxLength)
    : clampText(`${info.provider ?? 'subagent'} · ${info.stopReason ?? ''}`, config.bodyMaxLength)
  return {
    kind: 'subagent-end',
    title: titleFor(config, text.subagentEnd),
    body,
    fields: fieldsFor(config, text.subagentEnd, body, context),
  }
}

/** Decide the alert for a finished workflow run. */
export function decideWorkflowEndNotification(info, result, config, text, context) {
  if (!config.enabled || !config.notifyOnWorkflowEnd || !result) return null
  const workflowName = info?.meta?.name ? String(info.meta.name) : 'workflow'
  const suffix = result.error ? ` · ${result.error}` : ''
  const body = clampText(`${workflowName} · ${result.stopReason ?? ''}${suffix}`, config.bodyMaxLength)
  return {
    kind: 'workflow-end',
    title: titleFor(config, text.workflowEnd),
    body,
    fields: fieldsFor(config, text.workflowEnd, body, context),
  }
}

/** Decide the alert for a completed goal. */
export function decideGoalNotification(payload, config, text, context) {
  if (!config.enabled || !config.notifyOnGoalComplete || !payload) return null
  const change = payload.change
  if (change?.operation !== 'complete') return null
  const body = change.goal?.objective ? clampText(change.goal.objective, config.bodyMaxLength) : text.goalCompleteBody
  return {
    kind: 'goal-complete',
    title: titleFor(config, text.goalComplete),
    body,
    fields: fieldsFor(config, text.goalComplete, body, context),
  }
}
