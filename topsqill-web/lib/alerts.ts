/** Where each kind of alert opens. Shared by server pages and the live pop-ups. */
const LINK: Record<string, (id: string) => string> = {
  conversation: (id) => `/messages?c=${id}`, profile: (id) => `/profile/${id}`, post: (id) => `/posts/${id}`,
  listing: (id) => `/listings/${id}`, lead: (id) => `/leads?lead=${id}`, job: (id) => `/jobs/${id}`,
  requirement: () => "/requirements", verification: () => "/profile/verify",
};

export const alertHref = (targetType?: string | null, targetId?: string | null) =>
  (targetType && targetId && LINK[targetType]?.(targetId)) || "/notifications";
