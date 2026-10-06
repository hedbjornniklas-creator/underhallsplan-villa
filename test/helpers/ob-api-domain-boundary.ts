/**
 * Existing domain fixtures mock the authenticated organization under the old
 * assignments dependency. Preserve those fixtures while routing through the new
 * boundary. Real binding/HTTP denial behavior is tested independently in
 * ob-organization-bindings-server and ob-organization-api.
 */
export function obApiDomainBoundary(name: string, dependencies: Record<string, unknown>): unknown {
  if (name === '@/lib/ob/reportIdentity') {
    return { resolveObReportIdentity: async () => ({ company_name: 'Domain fixture organization' }) }
  }
  if (name === '@/lib/ob/organizationBindings') {
    const server = dependencies['@/lib/assignments/server'] as { requireOrgContext?: () => Promise<unknown> } | undefined
    const context = () => {
      if (!server?.requireOrgContext) throw new Error('Missing organization fixture')
      return server.requireOrgContext()
    }
    return { requireObContext: context, requireObAssignmentContext: context, requireObInspectionContext: context }
  }
  if (name === '@/lib/ob/organizationHttp') {
    return { obRequestOrgId: () => undefined, obOrganizationFailure: () => null }
  }
  if (name === '@/lib/organizations/administrationHttp') {
    return { readOrganizationJson: (request: Request) => request.json(), assertOrganizationSameOrigin: () => {} }
  }
  return undefined
}
