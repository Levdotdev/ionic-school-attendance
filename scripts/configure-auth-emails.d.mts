export const authEmailTemplates: readonly { name: string; subject: string; notification?: string }[]
export function buildAuthEmailPatch(): Promise<Record<string, string | boolean | number>>
export function applyAuthEmailConfiguration(projectRef: string, accessToken: string | undefined, options?: { checkOnly?: boolean }): Promise<{ projectRef: string; mode: string; templates: number; manualLinkingEnabled: boolean; newEmailConfirmationOnly: boolean; matching: boolean; mismatchedFields: string[] }>
