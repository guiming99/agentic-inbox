// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file and at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared attachment storage logic.
 * Eliminates the triplicated atob → Uint8Array → R2.put pattern.
 */
import type { Env } from "../types";

export interface StoredAttachment {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id: string | null;
	disposition: string;
}

/**
 * Store base64-encoded attachments to R2 and return metadata for the DO.
 * Content-ID alone does not mean a file is an inline resource: some senders
 * add Content-ID to ordinary attachments. PostalMime's `related` flag is the
 * reliable signal for HTML-related inline parts.
 *
 * Store up to three attachments concurrently to reduce serial R2 latency
 * without decoding every large attachment into memory at once. If a write
 * fails, wait for the active batch to settle, clean up generated keys, and
 * rethrow so the request cannot continue as if storage succeeded.
 */
export async function storeAttachments(
	bucket: Env["BUCKET"],
	emailId: string,
	attachments?: {
		content: string;
		filename: string;
		type: string;
		disposition: string;
		contentId?: string;
	}[],
): Promise<StoredAttachment[]> {
	if (!attachments?.length) return [];

	const entries = attachments.map((att) => {
		const attachmentId = crypto.randomUUID();
		const safeFilename = (att.filename || "untitled").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
		return {
			att,
			attachmentId,
			safeFilename,
			key: `attachments/${emailId}/${attachmentId}/${safeFilename}`,
		};
	});

	const results: StoredAttachment[] = [];
	for (let i = 0; i < entries.length; i += 3) {
		const batch = entries.slice(i, i + 3);
		const settled = await Promise.allSettled(batch.map(async ({ att, attachmentId, safeFilename, key }) => {
			const binaryStr = atob(att.content);
			const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
			await bucket.put(key, bytes);
			return {
				id: attachmentId,
				email_id: emailId,
				filename: safeFilename,
				mimetype: att.type,
				size: bytes.byteLength,
				content_id: att.contentId || null,
				disposition: att.disposition || "attachment",
			} satisfies StoredAttachment;
		}));

		const failed = settled.find((result) => result.status === "rejected");
		if (failed?.status === "rejected") {
			try {
				await bucket.delete(entries.map((entry) => entry.key));
			} catch (cleanupError) {
				console.error("Failed to clean up partial attachment writes", cleanupError);
			}
			throw failed.reason;
		}

		for (const result of settled) {
			if (result.status === "fulfilled") results.push(result.value);
		}
	}

	return results;
}
