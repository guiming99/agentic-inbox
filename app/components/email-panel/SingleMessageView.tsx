// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import { ArrowBendUpLeftIcon, ArrowBendUpRightIcon, ChatCircleIcon, EnvelopeOpenIcon, EnvelopeSimpleIcon, FolderSimpleIcon, StarIcon, TrashIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import EmailAttachmentList from "~/components/EmailAttachmentList";
import EmailIframe from "~/components/EmailIframe";
import { formatDetailDate, rewriteInlineImages } from "~/lib/utils";
import type { Email, Folder } from "~/types";

interface SingleMessageViewProps {
	email: Email;
	mailboxId?: string;
	moveToFolders?: Folder[];
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
	onToggleStar?: () => void;
	onToggleRead?: () => void;
	onMove?: (folderId: string) => void;
	onSpam?: () => void;
	onDelete?: () => void;
	onPreviewImage: (url: string, filename: string) => void;
}

function MoveMenu({ folders, onMove }: { folders: Folder[]; onMove: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const handler = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);
	return (
		<div ref={ref} className="relative">
			<Tooltip content="Move to folder" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<FolderSimpleIcon size={14} />} onClick={() => setOpen((value) => !value)} aria-label="Move to folder" className="!h-6 !w-6" /></Tooltip>
			{open && <div className="absolute top-full right-0 z-50 mt-1 min-w-[150px] rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1">
				<div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle">Move to</div>
				<div className="h-px bg-kumo-line my-1" />
				{folders.map((folder) => <button key={folder.id} type="button" className="w-full text-left px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors" onClick={() => { onMove(folder.id); setOpen(false); }}>{folder.name}</button>)}
			</div>}
		</div>
	);
}

export default function SingleMessageView({ email, mailboxId, moveToFolders = [], onReply, onReplyAll, onForward, onToggleStar, onToggleRead, onMove, onSpam, onDelete, onPreviewImage }: SingleMessageViewProps) {
	return (
		<div className="flex flex-col h-full">
			<div className="px-4 py-4 border-b border-kumo-line md:px-6">
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-2.5 min-w-0">
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-xs font-bold text-kumo-default">{email.sender.charAt(0).toUpperCase()}</div>
						<div className="min-w-0">
							<div className="text-sm font-medium text-kumo-default truncate">{email.sender}</div>
							<div className="text-xs text-kumo-subtle">To: {email.recipient}</div>
							{email.cc && <div className="text-xs text-kumo-subtle">Cc: {email.cc}</div>}
						</div>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<span className="text-xs text-kumo-subtle">{formatDetailDate(email.date)}</span>
						{onToggleStar && <Tooltip content={email.starred ? "Unstar" : "Star"} side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<StarIcon size={14} weight={email.starred ? "fill" : "regular"} className={email.starred ? "text-kumo-warning" : ""} />} onClick={onToggleStar} aria-label={email.starred ? "Unstar" : "Star"} className="!h-6 !w-6" /></Tooltip>}
						{onToggleRead && <Tooltip content={email.read ? "Mark as unread" : "Mark as read"} side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={email.read ? <EnvelopeSimpleIcon size={14} /> : <EnvelopeOpenIcon size={14} />} onClick={onToggleRead} aria-label={email.read ? "Mark as unread" : "Mark as read"} className="!h-6 !w-6" /></Tooltip>}
						{onMove && <MoveMenu folders={moveToFolders} onMove={onMove} />}
						{onSpam && <Tooltip content={email.folder_id === "spam" ? "Not spam" : "Mark as spam"} side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<WarningCircleIcon size={14} />} onClick={onSpam} aria-label={email.folder_id === "spam" ? "Not spam" : "Mark as spam"} className="!h-6 !w-6" /></Tooltip>}
						{onDelete && <Tooltip content="Delete" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<TrashIcon size={14} />} onClick={onDelete} aria-label="Delete" className="!h-6 !w-6" /></Tooltip>}
						{onReply && <Tooltip content="Reply to this message" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ArrowBendUpLeftIcon size={14} />} onClick={onReply} aria-label="Reply to this message" className="!h-6 !w-6" /></Tooltip>}
						{onReplyAll && <Tooltip content="Reply all to this message" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ChatCircleIcon size={14} />} onClick={onReplyAll} aria-label="Reply all to this message" className="!h-6 !w-6" /></Tooltip>}
						{onForward && <Tooltip content="Forward this message" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ArrowBendUpRightIcon size={14} />} onClick={onForward} aria-label="Forward this message" className="!h-6 !w-6" /></Tooltip>}
					</div>
				</div>
			</div>
			<div className="flex-1 min-h-0"><EmailIframe body={rewriteInlineImages(email.body || "", mailboxId || "", email.id, email.attachments)} /></div>
			<EmailAttachmentList mailboxId={mailboxId} emailId={email.id} attachments={email.attachments} onPreviewImage={onPreviewImage} className="px-4 py-3 border-t border-kumo-line shrink-0 md:px-6" showHeading />
		</div>
	);
}
