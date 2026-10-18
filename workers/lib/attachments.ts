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
 * Writes are concurrent to avoid serial R2 latency when a message includes
 * multiple signature images. If any write fails, clean up all generated keys
 * after every write settles so a failed send does not leave partial records.
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

	const settled = await Promise.allSettled(entries.map(async ({ att, attachmentId, safeFilename, key }) => {
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

	return settled.map((result) => {
		if (result.status !== "fulfilled") throw result.reason;
		return result.value;
	});
}
