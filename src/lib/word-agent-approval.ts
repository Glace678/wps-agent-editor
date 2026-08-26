import type {
  AgentApprovalRequest,
  AgentApprovalResponse,
  AgentUserDocumentActivity,
} from '../types/document'

export function isCurrentApprovalResponse(
  request: AgentApprovalRequest,
  response: AgentApprovalResponse,
): boolean {
  return response.approvalId === request.approvalId
    && response.runId === request.runId
    && response.planId === request.planId
    && response.planVersion === request.planVersion
    && response.documentRevision === request.documentRevision
    && response.documentApiRevision === request.documentApiRevision
}

export function invalidatesApproval(
  request: AgentApprovalRequest,
  activity: AgentUserDocumentActivity,
): boolean {
  return activity.runId === request.runId
    && activity.kind === 'edit'
    && (
      activity.documentRevision !== request.documentRevision
      || (
        request.documentApiRevision !== undefined
        && activity.documentApiRevision !== undefined
        && activity.documentApiRevision !== request.documentApiRevision
      )
    )
}
