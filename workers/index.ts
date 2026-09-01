*** Begin Patch
*** Update File: workers/index.ts
@@
-const MAX_EMAIL_SIZE=25*1024*1024;
-async function streamToArrayBuffer(stream:ReadableStream,size:number){if(size>MAX_EMAIL_SIZE||size<=0)throw new Error(`Invalid email size: ${size}`);const out=new Uint8Array(size);let n=0;const r=[...]
-type IncomingEmailMessage={raw:ReadableStream;rawSize:number;to?:string};
-function normalizeAddress(address:string|null|undefined){const normalized=address?.trim().toLowerCase();return normalized||undefined;}
-function parsedAddressList(addresses:Array<{address?:string|null}>|undefined){return addresses?.map(entry=>normalizeAddress(entry.address)).filter((address):address is string=>Boolean(address))??[[...]
-async function receiveEmail(event:IncomingEmailMessage,env:Env,ctx:ExecutionContext){const raw=await streamToArrayBuffer(event.raw,event.rawSize);const parsed=await new PostalMime().parse(raw);con[...]
+const MAX_EMAIL_SIZE=25*1024*1024;
+async function streamToArrayBuffer(stream:ReadableStream,size:number){
+  if(size>MAX_EMAIL_SIZE||size<=0)throw new Error(`Invalid email size: ${size}`);
+  const out=new Uint8Array(size);
+  let n=0;
+  const reader=(stream as ReadableStream).getReader();
+  while(true){
+    const {done,value}=await reader.read();
+    if(done)break;
+    out.set(value,n);
+    n+=value.length;
+  }
+  return out.subarray(0,n);
+}
+
+// Allow callers to optionally pass a pre-read buffer and parsed value to avoid double parsing.
+type IncomingEmailMessage={raw?:ReadableStream;rawSize?:number;rawBuffer?:Uint8Array;parsed?:any;to?:string};
+function normalizeAddress(address:string|null|undefined){const normalized=address?.trim().toLowerCase();return normalized||undefined;}
+function parsedAddressList(addresses:Array<{address?:string|null}>|undefined){return addresses?.map(entry=>normalizeAddress(entry.address)).filter((address):address is string=>Boolean(address))??[];}
+
+// Utility to map with limited concurrency.
+async function mapWithConcurrency<T,U>(items:T[], limit:number, mapper:(item:T,index:number)=>Promise<U>):Promise<U[]>{
+  const results:U[] = new Array(items.length) as U[];
+  let i = 0;
+  async function worker(){
+    while(true){
+      const idx = i++;
+      if(idx >= items.length) return;
+      try{results[idx] = await mapper(items[idx], idx);}catch(e){throw e}
+    }
+  }
+  const workers = [] as Promise<void>[];
+  const concurrency = Math.min(limit, items.length);
+  for(let w=0; w<concurrency; w++) workers.push(worker());
+  await Promise.all(workers);
+  return results;
+}
+
+async function receiveEmail(event:IncomingEmailMessage,env:Env,ctx:ExecutionContext){
+  console.time("receiveEmail");
+  let raw:Uint8Array;
+  let parsed:any;
+  if(event.rawBuffer && event.parsed){
+    raw = event.rawBuffer;
+    parsed = event.parsed;
+  } else if(event.rawBuffer){
+    raw = event.rawBuffer;
+    parsed = await new PostalMime().parse(raw);
+  } else {
+    raw = await streamToArrayBuffer(event.raw!, event.rawSize!);
+    parsed = await new PostalMime().parse(raw);
+  }
+
+  console.timeEnd("receiveEmail-parse");
+
+  const envelopeRecipient = normalizeAddress(event.to || undefined);
+  const recipients = parsedAddressList(parsed.to);
+  if(!envelopeRecipient && !recipients.length) throw new Error("received email with empty to");
+
+  const allowed = ((env.EMAIL_ADDRESSES??[]) as string[]).map(a=>normalizeAddress(a)).filter(Boolean) as string[];
+  const cc = parsedAddressList(parsed.cc);
+  const bcc = parsedAddressList(parsed.bcc);
+  const routingRecipients = envelopeRecipient ? [envelopeRecipient] : recipients;
+  const mailboxId = allowed.length ? routingRecipients.find(a=>allowed.includes(a)) : envelopeRecipient ?? recipients[0];
+  if(!mailboxId) return;
+
+  const messageId = crypto.randomUUID();
+  if(!(await env.BUCKET.head(`mailboxes/${mailboxId}.json`))) return;
+  const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));
+
+  // Upload attachments in parallel with a small concurrency limit to avoid long serial waits.
+  const attachmentData:StoredAttachment[] = [];
+  const attachments = parsed.attachments || [];
+  if(attachments.length){
+    console.time("attachments-upload");
+    const uploads = await mapWithConcurrency(attachments, 4, async (att, idx) => {
+      const id = crypto.randomUUID();
+      const filename = (att.filename||"untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
+      const key = `attachments/${messageId}/${id}/${filename}`;
+      await env.BUCKET.put(key, att.content);
+      return { id, email_id: messageId, filename, mimetype: att.mimeType, size: typeof att.content === "string" ? att.content.length : att.content?.byteLength ?? 0, content_id: att.contentId || null, disposition: att.disposition || "attachment" } as StoredAttachment;
+    });
+    attachmentData.push(...uploads);
+    console.timeEnd("attachments-upload");
+  }
+
+  const extract=(s:string)=>{const m=s.match(/<([^>]+)>/);return m?m[1]:s.trim().split(/\s+/)[0];};
+  const inReply = parsed.inReplyTo ? extract(parsed.inReplyTo) : null;
+  const refs = parsed.references ? parsed.references.split(/\s+/).filter(Boolean).map(extract) : [];
+  let threadId = resolveThreadId(messageId, refs, inReply);
+  const original = parsed.messageId ? extract(parsed.messageId) : null;
+  await stub.createEmail(Folders.INBOX, { id: messageId, subject: parsed.subject || "", sender: (parsed.from?.address||"").toLowerCase(), recipient: (recipients.length?recipients:[mailboxId]).join(", "), cc: cc.join(", ")||null, bcc: bcc.join(", ")||null, date: new Date().toISOString(), body: parsed.html||parsed.text||"", in_reply_to: inReply, email_references: refs.length?JSON.stringify(refs):null, thread_id: threadId, message_id: original, raw_headers: JSON.stringify(parsed.headers) }, attachmentData);
+
+  const agentStub = env.EMAIL_AGENT.get(env.EMAIL_AGENT.idFromName(mailboxId));
+  ctx.waitUntil(agentStub.fetch(new Request("https://agents/onNewEmail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mailboxId,emailId:messageId,sender:(parsed.from?.address||"").toLowerCase(),subject:parsed.subject||"",threadId})})).catch(e=>console.error("Auto-draft trigger failed:",(e as Error).message)));
+  console.timeEnd("receiveEmail");
+}
*** End Patch
