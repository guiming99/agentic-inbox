// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Email } from "~/types";
import { Folders } from "shared/folders";
import { queryKeys } from "./keys";

interface EmailListResponse { emails: Email[]; totalCount: number; }

export function useEmails(mailboxId: string | undefined, params: Record<string, string>, options?: { enabled?: boolean; refetchInterval?: number }) {
	const queryParams = params.folder ? { ...params, threaded: "true" } : params;
	return useQuery<EmailListResponse>({ queryKey: mailboxId ? queryKeys.emails.list(mailboxId, queryParams) : ["emails", "_disabled"], queryFn: async () => { const data = await api.listEmails(mailboxId!, queryParams) as EmailListResponse | Email[]; if (data && typeof data === "object" && "emails" in data) return { emails: (data as EmailListResponse).emails ?? [], totalCount: (data as EmailListResponse).totalCount ?? 0 }; const arr = Array.isArray(data) ? data : []; return { emails: arr, totalCount: arr.length }; }, enabled: !!mailboxId && (options?.enabled ?? true), refetchInterval: options?.refetchInterval });
}

export function useEmail(mailboxId: string | undefined, emailId: string | undefined) { return useQuery<Email>({ queryKey: mailboxId && emailId ? queryKeys.emails.detail(mailboxId, emailId) : ["emails", "_disabled_detail"], queryFn: () => api.getEmail(mailboxId!, emailId!) as Promise<Email>, enabled: !!mailboxId && !!emailId }); }

export function useThreadReplies(mailboxId: string | undefined, threadId: string | undefined | null) { const qc = useQueryClient(); return useQuery<Email[]>({ queryKey: mailboxId && threadId ? queryKeys.emails.thread(mailboxId, threadId) : ["emails", "_disabled_thread"], queryFn: async ({ signal }) => { const emails = await api.getThread(mailboxId!, threadId!, { signal }) as Email[]; for (const email of emails) qc.setQueryData(queryKeys.emails.detail(mailboxId!, email.id), email); return emails; }, enabled: !!mailboxId && !!threadId }); }

function useInvalidateEmailData() { const qc = useQueryClient(); return (mailboxId: string) => { qc.invalidateQueries({ queryKey: ["emails", mailboxId] }); qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) }); }; }

export function useSendEmail() { const invalidate = useInvalidateEmailData(); return useMutation({ mutationFn: ({ mailboxId, email }: { mailboxId: string; email: unknown }) => api.sendEmail(mailboxId, email), onSuccess: (_data, { mailboxId }) => invalidate(mailboxId) }); }

export function useUpdateEmail() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ mailboxId, id, data }: { mailboxId: string; id: string; data: unknown }) => api.updateEmail(mailboxId, id, data), onMutate: async ({ mailboxId, id, data }) => { const isListQuery = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] === "emails" && query.queryKey[1] === mailboxId && typeof query.queryKey[2] === "object" && query.queryKey[2] !== null; await qc.cancelQueries({ queryKey: ["emails", mailboxId], predicate: isListQuery }); const listQueries = qc.getQueriesData<{ emails: Email[]; totalCount: number }>({ queryKey: ["emails", mailboxId], predicate: isListQuery }); for (const [key, cached] of listQueries) if (cached?.emails) qc.setQueryData(key, { ...cached, emails: cached.emails.map((e) => e.id === id ? { ...e, ...(data as Partial<Email>) } : e) }); const detailKey = queryKeys.emails.detail(mailboxId, id); const prevDetail = qc.getQueryData<Email>(detailKey); if (prevDetail) qc.setQueryData(detailKey, { ...prevDetail, ...(data as Partial<Email>) }); return { listQueries, prevDetail, detailKey }; }, onError: (_err, _vars, context) => { if (context?.listQueries) for (const [key, cached] of context.listQueries) qc.setQueryData(key, cached); if (context?.prevDetail) qc.setQueryData(context.detailKey, context.prevDetail); }, onSettled: (_data, _err, { mailboxId }) => { qc.invalidateQueries({ queryKey: ["emails", mailboxId] }); qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) }); } }); }

export function useMarkThreadRead() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ mailboxId, threadId }: { mailboxId: string; threadId: string }) => api.markThreadRead(mailboxId, threadId), onSuccess: (_data, { mailboxId }) => { qc.invalidateQueries({ queryKey: ["emails", mailboxId] }); qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) }); } }); }

/** Delete = move to Trash; Trash/Spam are permanently deleted. Drafts are permanently discarded. */
export function useDeleteEmail() { const invalidate = useInvalidateEmailData(); return useMutation({ mutationFn: async ({ mailboxId, id, permanent = false }: { mailboxId: string; id: string; permanent?: boolean }) => { if (permanent) return api.deleteEmail(mailboxId, id); const email = await api.getEmail(mailboxId, id) as Email; if (email.folder_id === Folders.TRASH || email.folder_id === Folders.SPAM || email.folder_id === Folders.DRAFT) return api.deleteEmail(mailboxId, id); return api.moveEmail(mailboxId, id, Folders.TRASH); }, onSuccess: (_data, { mailboxId }) => invalidate(mailboxId) }); }

export function useMoveEmail() { const invalidate = useInvalidateEmailData(); return useMutation({ mutationFn: ({ mailboxId, id, folderId }: { mailboxId: string; id: string; folderId: string }) => api.moveEmail(mailboxId, id, folderId), onSuccess: (_data, { mailboxId }) => invalidate(mailboxId) }); }

export function useSaveDraft() { const invalidate = useInvalidateEmailData(); return useMutation({ mutationFn: ({ mailboxId, draft }: { mailboxId: string; draft: { to?: string; cc?: string; bcc?: string; subject?: string; body: string; in_reply_to?: string; thread_id?: string; draft_id?: string } }) => api.saveDraft(mailboxId, draft), onSuccess: (_data, { mailboxId }) => invalidate(mailboxId) }); }

export function useReplyToEmail() { const invalidate = useInvalidateEmailData(); return useMutation({ mutationFn: ({ mailboxId, emailId, email }: { mailboxId: string; emailId: string; email: unknown }) => api.replyToEmail(mailboxId, emailId, email), onSuccess: (_data, { mailboxId }) => invalidate(mailboxId) }); }

export function useForwardEmail() { const invalidate = useInvalidateEmailData(); return useMutation({ mutationFn: ({ mailboxId, emailId, email }: { mailboxId: string; emailId: string; email: unknown }) => api.forwardEmail(mailboxId, emailId, email), onSuccess: (_data, { mailboxId }) => invalidate(mailboxId) }); }
