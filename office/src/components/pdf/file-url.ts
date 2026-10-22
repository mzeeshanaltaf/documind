/** A document's PDF through the BFF (DocuMind's `GET /v1/orgs/{id}/documents/{id}/file`). */
export function documentFileUrl(orgId: string, documentId: string) {
  return `/api/backend/orgs/${encodeURIComponent(orgId)}/documents/${encodeURIComponent(documentId)}/file`;
}
