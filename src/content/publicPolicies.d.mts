export type PublicPolicyKind='privacy'|'deletion'
export const publicPolicyKinds: readonly PublicPolicyKind[]
export function getPublicPolicy(kind:PublicPolicyKind):{title:string;fileName:string;description:string;html:string}
