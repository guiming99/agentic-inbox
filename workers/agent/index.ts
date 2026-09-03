// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { AIChatAgent } from "@cloudflare/ai-chat";
import { streamText, generateText, convertToModelMessages, stepCountIs } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import type { EmailFull, EmailMetadata } from "../lib/schemas";
import { verifyDraft, isPromptInjection } from "../lib/ai";
import { getMailboxStub, stripHtmlToText, textToHtml } from "../lib/email-helpers";
import { toolListEmails, toolGetEmail, toolGetThread, toolSearchEmails, toolDraftReply, toolDraftEmail, toolMarkEmailRead, toolMoveEmail, toolDiscardDraft } from "../lib/tools";
import { Folders, FOLDER_TOOL_DESCRIPTION, MOVE_FOLDER_TOOL_DESCRIPTION } from "../../shared/folders";
import type { Env } from "../types";

function defineTool(def: { description: string; parameters: z.ZodType<any>; execute: (...args: any[]) => Promise<any> }) {
  return { description: def.description, inputSchema: def.parameters, execute: def.execute };
}

const DEFAULT_SYSTEM_PROMPT = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.

Write like a real person. Short, direct, flowing prose. Plain text only.
When asked to draft, use the appropriate draft tool. Never send email directly.
Draft bodies must contain only the email text, without meta-commentary or markdown.`;

async function getSystemPrompt(env: Env, mailboxId: string): Promise<string> {
  try {
    const obj = await env.BUCKET.get(`mailboxes/${mailboxId}.json`);
    if (obj) {
      const settings = await obj.json<Record<string, unknown>>();
      if (typeof settings.agentSystemPrompt === "string" && settings.agentSystemPrompt.trim()) return settings.agentSystemPrompt;
    }
  } catch {}
  return DEFAULT_SYSTEM_PROMPT;
}

function createEmailTools(env: Env, mailboxId: string) {
  return {
    list_emails: defineTool({ description: "List emails in a folder.", parameters: z.object({ folder: z.string().default(Folders.INBOX).describe(FOLDER_TOOL_DESCRIPTION), limit: z.number().default(20), page: z.number().default(1) }), execute: async ({ folder, limit, page }) => toolListEmails(env, mailboxId, { folder, limit, page }) }),
    get_email: defineTool({ description: "Get a single email with its full body content and attachments.", parameters: z.object({ emailId: z.string() }), execute: async ({ emailId }) => toolGetEmail(env, mailboxId, emailId) }),
    get_thread: defineTool({ description: "Get all emails in a conversation thread.", parameters: z.object({ threadId: z.string() }), execute: async ({ threadId }) => toolGetThread(env, mailboxId, threadId) }),
    search_emails: defineTool({ description: "Search for emails matching a query.", parameters: z.object({ query: z.string(), folder: z.string().optional() }), execute: async ({ query, folder }) => toolSearchEmails(env, mailboxId, { query, folder }) }),
    draft_email: defineTool({ description: "Draft a new email and save it to Drafts. Does not send.", parameters: z.object({ to: z.string().email(), subject: z.string(), body: z.string() }), execute: async ({ to, subject, body }) => toolDraftEmail(env, mailboxId, { to, subject, body, isPlainText: true }) }),
    draft_reply: defineTool({ description: "Draft a reply to an existing email and save it to Drafts. Does not send.", parameters: z.object({ originalEmailId: z.string(), to: z.string().email(), subject: z.string(), body: z.string() }), execute: async ({ originalEmailId, to, subject, body }) => toolDraftReply(env, mailboxId, { originalEmailId, to, subject, body, isPlainText: true, runVerifyDraft: false }) }),
    mark_email_read: defineTool({ description: "Mark an email as read or unread.", parameters: z.object({ emailId: z.string(), read: z.boolean() }), execute: async ({ emailId, read }) => toolMarkEmailRead(env, mailboxId, emailId, read) }),
    move_email: defineTool({ description: "Move an email to a different folder.", parameters: z.object({ emailId: z.string(), folderId: z.string().describe(MOVE_FOLDER_TOOL_DESCRIPTION) }), execute: async ({ emailId, folderId }) => toolMoveEmail(env, mailboxId, emailId, folderId) }),
    discard_draft: defineTool({ description: "Delete a draft email.", parameters: z.object({ draftId: z.string() }), execute: async ({ draftId }) => toolDiscardDraft(env, mailboxId, draftId) }),
  };
}

export class EmailAgent extends AIChatAgent<any> {
  async onChatMessage(onFinish: any) {
    const env = this.env as Env;
    const mailboxId = this.name;
    const workersai = createWorkersAI({ binding: env.AI });
    const tools = createEmailTools(env, mailboxId);
    const systemPrompt = await getSystemPrompt(env, mailboxId);

    console.log("[AI] chat start", { mailboxId, model: "@cf/zai-org/glm-4.7-flash", messageCount: this.messages.length });

    try {
      const result = streamText({
        model: workersai("@cf/zai-org/glm-4.7-flash"),
        system: systemPrompt,
        messages: await convertToModelMessages(this.messages),
        tools,
        stopWhen: stepCountIs(3),
        onFinish,
        onError: ({ error }) => {
          console.error("[AI] STREAM ERROR", {
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            cause: error instanceof Error && error.cause ? String(error.cause) : undefined,
            serialized: (() => { try { return JSON.stringify(error); } catch { return "<unserializable>"; } })(),
          });
        },
      });
      return result.toUIMessageStreamResponse();
    } catch (error) {
      console.error("[AI] STREAM SETUP ERROR", error);
      throw error;
    }
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/onNewEmail" && request.method === "POST") {
      try {
        const emailData = await request.json() as { mailboxId: string; emailId: string; sender: string; subject: string; threadId: string };
        const result = await this.handleNewEmail(emailData);
        return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
      } catch (e) {
        console.error("onNewEmail handler failed:", (e as Error).message);
        return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
    return super.onRequest(request);
  }

  async handleNewEmail(emailData: { mailboxId: string; emailId: string; sender: string; subject: string; threadId: string }) {
    // Automatic AI drafting is intentionally disabled. AI is invoked only when the user
    // explicitly asks for a reply from the existing AgentPanel chat UI.
    console.log("[AI] automatic draft skipped", { mailboxId: emailData.mailboxId, emailId: emailData.emailId });
    return { status: "auto_draft_disabled" };
  }
}
