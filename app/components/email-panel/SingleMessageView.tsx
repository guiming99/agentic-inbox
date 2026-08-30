// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import { ArrowBendUpLeftIcon, ArrowBendUpRightIcon, ChatCircleIcon } from "@phosphor-icons/react";
import EmailAttachmentList from "~/components/EmailAttachmentList";
import EmailIframe from "~/components/EmailIframe";
import { formatDetailDate, rewriteInlineImages } from "~/lib/utils";
import type { Email } from "~/types";

interface SingleMessageViewProps {
	email: Email;
	mailboxId?: string;
	onReply: () => void;
	onReplyAll: () => void;
	onForward: () => void;
	onPreviewImage: (url: string, filename: string) => void;
}

export default function SingleMessageView({ email, mailboxId, onReply, onReplyAll, onForward, onPreviewImage }: SingleMessageViewProps) {
	return (
		<div className="flex flex-col h-full">
			<div className="px-4 py-4 border-b border-kumo-line md:px-6">
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-center gap-2.5 min-w-0">
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-xs font-bold text-kumo-default">{email.sender.charAt(0).toUpperCase()}</div>
						<div className="min-w-0"><div className="text-sm font-medium text-kumo-default truncate">{email.sender}</div><div className="text-xs text-kumo-subtle">To: {email.recipient}</div>{email.cc && <div className="text-xs text-kumo-subtle">Cc: {email.cc}</div>}</div>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<span className="text-xs text-kumo-subtle">{formatDetailDate(email.date)}</span>
						<Tooltip content="Reply to this message" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ArrowBendUpLeftIcon size={14} />} onClick={onReply} aria-label="Reply to this message" className="!h-6 !w-6" /></Tooltip>
						<Tooltip content="Reply all to this message" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ChatCircleIcon size={14} />} onClick={onReplyAll} aria-label="Reply all to this message" className="!h-6 !w-6" /></Tooltip>
						<Tooltip content="Forward this message" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ArrowBendUpRightIcon size={14} />} onClick={onForward} aria-label="Forward this message" className="!h-6 !w-6" /></Tooltip>
					</div>
				</div>
			</div>
			<div className="flex-1 min-h-0"><EmailIframe body={rewriteInlineImages(email.body || "", mailboxId || "", email.id, email.attachments)} /></div>
			<EmailAttachmentList mailboxId={mailboxId} emailId={email.id} attachments={email.attachments} onPreviewImage={onPreviewImage} className="px-4 py-3 border-t border-kumo-line shrink-0 md:px-6" showHeading />
		</div>
	);
}
